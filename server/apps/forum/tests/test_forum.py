import io
import json
from datetime import timedelta

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.core.errors import ServiceError
from apps.core.models import AuditLog, Membership, StaffAccount, User
from apps.core.services import issue_token
from apps.forum import services
from apps.forum.models import Board, Comment, Like, Post, Report

pytestmark = pytest.mark.django_db


@pytest.fixture
def users():
    result = {}
    for name in [
        "owner",
        "editor",
        "reviewer",
        "member",
        "other",
        "nonmember",
        "expired",
        "banned",
    ]:
        user = User.objects.create_user(username=f"forum-{name}", nickname=name, password=None)
        if name in ["owner", "editor", "reviewer"]:
            StaffAccount.objects.create(user=user, role=name)
        if name != "nonmember":
            Membership.objects.create(
                user=user,
                email=f"{name}@student.monash.edu",
                approved_at=timezone.now() - timedelta(days=40),
                expires_at=timezone.now() + timedelta(days=-1 if name == "expired" else 30),
            )
        if name == "banned":
            user.banned_until = timezone.now() + timedelta(days=1)
            user.save(update_fields=["banned_until"])
        result[name] = user
    return result


@pytest.fixture
def boards():
    return {
        "general": Board.objects.create(name="学习交流", intro="交流学习经验"),
        "staff": Board.objects.create(name="官方公告", staff_only=True),
        "inactive": Board.objects.create(name="暂停板块", is_active=False),
    }


@pytest.fixture
def post(users, boards):
    return Post.objects.create(
        author=users["other"],
        board=boards["general"],
        title="公开帖子",
        content="公开正文",
        status="approved",
        reviewer=users["editor"],
        reviewed_at=timezone.now(),
    )


@pytest.fixture
def api(client):
    def invoke(method, path, body=None, user=None, header=None):
        headers = {}
        if user is not None:
            headers["HTTP_AUTHORIZATION"] = f"Bearer {issue_token(user)}"
        if header is not None:
            headers["HTTP_AUTHORIZATION"] = header
        return getattr(client, method)(
            f"/api/v1/forum{path}",
            data=json.dumps(body) if body is not None else None,
            content_type="application/json",
            **headers,
        )

    return invoke


def payload(board, **overrides):
    return {
        "board_id": board.pk,
        "title": "新的帖子",
        "content": "新正文",
        "image_ids": [],
        **overrides,
    }


def assert_error(response, status, code):
    assert response.status_code == status, response.content
    assert response.json()["code"] == code, response.content


def test_public_reads_optional_bearer_and_reject_invalid_headers(api, users, boards, post, client):
    assert api("get", "/boards").status_code == 200
    assert {row["name"] for row in api("get", "/boards").json()} == {"学习交流", "官方公告"}
    for header in ["", "Bearer invalid", "Basic invalid", "Bearer"]:
        assert_error(api("get", "/posts", header=header), 401, "UNAUTHORIZED")
    assert api("get", f"/posts/{post.pk}").json()["moderation_status"] == "approved"
    # An authenticated browser cookie is not a substitute for the API Bearer token.
    client.force_login(users["owner"])
    assert_error(api("post", "/posts", payload(boards["general"])), 401, "UNAUTHORIZED")
    assert_error(api("get", "/posts?author=me"), 401, "UNAUTHORIZED")


@pytest.mark.parametrize(
    "role,code",
    [
        ("nonmember", "MEMBERSHIP_REQUIRED"),
        ("expired", "MEMBERSHIP_REQUIRED"),
        ("banned", "USER_BANNED"),
    ],
)
def test_write_permissions_apply_to_posts_comments_likes_and_reports(
    api, users, boards, post, role, code
):
    actor = users[role]
    actions = [
        ("post", "/posts", payload(boards["general"])),
        ("post", f"/posts/{post.pk}/comments", {"content": "回复"}),
        ("put", f"/posts/{post.pk}/like", None),
        ("delete", f"/posts/{post.pk}/like", None),
        ("post", "/reports", {"target_type": "post", "target_id": post.pk, "reason": "other"}),
    ]
    for method, path, body in actions:
        assert_error(api(method, path, body, user=actor), 403, code)


def test_member_posts_pending_and_public_list_never_leaks_private_content(api, users, boards):
    response = api("post", "/posts", payload(boards["general"]), user=users["member"])
    assert response.status_code == 200, response.content
    result = response.json()
    assert result["moderation_status"] == "pending"
    assert result["images"] == []
    assert result["is_mine"] is True
    post_id = result["id"]
    for actor in [None, users["member"], users["other"], users["owner"], users["editor"]]:
        assert api("get", "/posts", user=actor).json()["items"] == []
    for actor in [None, users["other"], users["reviewer"]]:
        assert_error(api("get", f"/posts/{post_id}", user=actor), 404, "NOT_FOUND")
    for actor in [users["member"], users["owner"], users["editor"]]:
        assert api("get", f"/posts/{post_id}", user=actor).status_code == 200
    own = api("get", "/posts?author=me", user=users["member"]).json()["items"]
    assert [row["id"] for row in own] == [post_id]
    assert own[0]["moderation_status"] == "pending"
    services.moderate_post(users["editor"], post_id, "rejected", "请调整内容")
    own = api("get", "/posts?author=me", user=users["member"]).json()["items"]
    assert own[0]["moderation_status"] == "rejected"
    assert own[0]["review_note"] == "请调整内容"
    services.moderate_post(users["owner"], post_id, "approved", "审核记录", pinned=True)
    public = api("get", "/posts").json()["items"][0]
    assert public["id"] == post_id
    assert public["is_pinned"] is True
    assert public["review_note"] == ""


@pytest.mark.parametrize(
    "role,allowed", [("owner", True), ("editor", True), ("reviewer", False), ("member", False)]
)
def test_staff_board_requires_content_role_and_membership(api, users, boards, role, allowed):
    response = api("post", "/posts", payload(boards["staff"]), user=users[role])
    if allowed:
        assert response.status_code == 200, response.content
        assert response.json()["moderation_status"] == "pending"
    else:
        assert_error(response, 403, "FORBIDDEN")
    Membership.objects.filter(user=users[role]).delete()
    assert_error(
        api("post", "/posts", payload(boards["staff"]), user=users[role]),
        403,
        "MEMBERSHIP_REQUIRED",
    )


def test_validation_rejects_images_privileged_fields_and_blank_content(api, users, boards):
    for overrides in [
        {"image_ids": [1]},
        {"title": "  "},
        {"content": "  "},
        {"title": "长" * 51},
        {"status": "approved"},
        {"is_pinned": True},
    ]:
        assert_error(
            api("post", "/posts", payload(boards["general"], **overrides), user=users["member"]),
            422,
            "VALIDATION_ERROR",
        )
    assert_error(
        api("post", "/posts", payload(boards["inactive"]), user=users["member"]),
        422,
        "VALIDATION_ERROR",
    )
    response = api("post", "/images", user=users["member"])
    assert_error(response, 422, "VALIDATION_ERROR")
    assert "图片上传尚未开放" in response.json()["message"]
    assert Post.objects.count() == 0


def test_public_list_search_board_pagination_and_pinning(api, users, boards):
    rows = [
        Post.objects.create(
            author=users["other"],
            board=boards["general"],
            title=f"搜索 {index}",
            content="正文",
            status="approved",
        )
        for index in range(12)
    ]
    services.set_post_pinned(users["editor"], rows[0].pk, True)
    first = api("get", f"/posts?board={boards['general'].pk}&q=搜索").json()
    assert len(first["items"]) == 10
    assert first["items"][0]["id"] == rows[0].pk
    second = api(
        "get", f"/posts?board={boards['general'].pk}&q=搜索&cursor={first['next_cursor']}"
    ).json()
    assert len(second["items"]) == 2
    assert second["next_cursor"] is None
    assert len({item["id"] for item in first["items"] + second["items"]}) == 12
    assert api("get", "/posts?q=不存在").json() == {"items": [], "next_cursor": None}
    for query in ["cursor=-1", "cursor=1.5", "author=someone", "board=-1"]:
        assert_error(api("get", f"/posts?{query}"), 422, "VALIDATION_ERROR")


def test_comments_visibility_and_counts_include_only_approved(api, users, post):
    approved = Comment.objects.create(
        post=post, author=users["other"], content="公开", status="approved"
    )
    own_pending = Comment.objects.create(post=post, author=users["member"], content="本人待审")
    own_rejected = Comment.objects.create(
        post=post,
        author=users["member"],
        content="本人被拒",
        status="rejected",
        review_note="修改说明",
    )
    hidden = Comment.objects.create(post=post, author=users["owner"], content="他人待审")
    Comment.objects.create(
        post=post, author=users["member"], content="删除", status="approved", deleted=True
    )
    expected = [
        (None, {approved.pk}),
        (users["member"], {approved.pk, own_pending.pk, own_rejected.pk}),
        (users["editor"], {approved.pk, own_pending.pk, own_rejected.pk, hidden.pk}),
    ]
    for actor, ids in expected:
        comments = api("get", f"/posts/{post.pk}/comments", user=actor).json()["items"]
        assert {row["id"] for row in comments} == ids
        assert api("get", f"/posts/{post.pk}", user=actor).json()["comment_count"] == 1
        assert api("get", "/posts", user=actor).json()["items"][0]["comment_count"] == 1
        # Exercise the unannotated fallback as used by mutation responses.
        assert services.post_data(post, actor, detail=True)["comment_count"] == 1
    services.moderate_comment(users["editor"], own_pending.pk, "approved")
    assert api("get", f"/posts/{post.pk}").json()["comment_count"] == 2


def test_create_comment_pending_reply_to_author_and_moderation(api, users, post):
    response = api(
        "post",
        f"/posts/{post.pk}/comments",
        {"content": " 回复作者 ", "reply_to_user_id": post.author_id},
        user=users["member"],
    )
    assert response.status_code == 200, response.content
    comment = response.json()
    assert comment["content"] == "回复作者"
    assert comment["moderation_status"] == "pending"
    assert comment["reply_to"]["id"] == post.author_id
    assert api("get", f"/posts/{post.pk}/comments").json()["items"] == []
    services.moderate_comment(users["editor"], comment["id"], "approved")
    assert len(api("get", f"/posts/{post.pk}/comments").json()["items"]) == 1


def test_reply_target_requires_participation_in_this_visible_thread(api, users, post, boards):
    unrelated = Post.objects.create(
        author=users["owner"],
        board=boards["general"],
        title="另一帖子",
        content="正文",
        status="approved",
    )
    Comment.objects.create(
        post=unrelated, author=users["reviewer"], content="另一帖参与者", status="approved"
    )
    Comment.objects.create(post=post, author=users["editor"], content="不可见评论")
    for target in [users["reviewer"].pk, users["editor"].pk, 999999]:
        assert_error(
            api(
                "post",
                f"/posts/{post.pk}/comments",
                {"content": "回复", "reply_to_user_id": target},
                user=users["member"],
            ),
            422,
            "VALIDATION_ERROR",
        )
    Comment.objects.create(
        post=post, author=users["reviewer"], content="本帖公开参与者", status="approved"
    )
    assert (
        api(
            "post",
            f"/posts/{post.pk}/comments",
            {"content": "回复", "reply_to_user_id": users["reviewer"].pk},
            user=users["member"],
        ).status_code
        == 200
    )


@pytest.mark.parametrize("hidden", ["pending", "rejected", "deleted", "inactive_board"])
def test_hidden_parent_blocks_comments_likes_and_reports(api, users, boards, hidden):
    post = Post.objects.create(
        author=users["member"],
        board=boards["general"],
        title="待隐藏",
        content="正文",
        status="approved",
    )
    comment = Comment.objects.create(
        post=post, author=users["member"], content="评论", status="approved"
    )
    if hidden == "deleted":
        post.deleted = True
    elif hidden == "inactive_board":
        post.board = boards["inactive"]
    else:
        post.status = hidden
    post.save()
    actions = [
        ("get", f"/posts/{post.pk}/comments", None),
        ("post", f"/posts/{post.pk}/comments", {"content": "不应发布"}),
        ("put", f"/posts/{post.pk}/like", None),
        ("delete", f"/posts/{post.pk}/like", None),
        ("delete", f"/comments/{comment.pk}", None),
        ("post", "/reports", {"target_type": "post", "target_id": post.pk, "reason": "other"}),
        (
            "post",
            "/reports",
            {"target_type": "comment", "target_id": comment.pk, "reason": "other"},
        ),
    ]
    for method, path, body in actions:
        assert_error(api(method, path, body, user=users["member"]), 404, "NOT_FOUND")
    assert Like.objects.count() == 0
    assert Report.objects.count() == 0


def test_only_author_or_content_manager_can_soft_delete_even_if_membership_expired(
    api, users, boards, post
):
    assert_error(api("delete", f"/posts/{post.pk}", user=users["member"]), 403, "FORBIDDEN")
    assert_error(api("delete", f"/posts/{post.pk}", user=users["reviewer"]), 403, "FORBIDDEN")
    expired_post = Post.objects.create(
        author=users["expired"], board=boards["general"], title="本人过期", content="正文"
    )
    assert api("delete", f"/posts/{expired_post.pk}", user=users["expired"]).status_code == 200
    expired_post.refresh_from_db()
    assert expired_post.deleted is True
    Membership.objects.filter(user=users["editor"]).delete()
    assert api("delete", f"/posts/{post.pk}", user=users["editor"]).status_code == 200
    post.refresh_from_db()
    assert post.deleted is True
    assert_error(api("get", f"/posts/{post.pk}", user=users["other"]), 404, "NOT_FOUND")


def test_comment_delete_permissions_do_not_require_current_membership(api, users, post):
    comment = Comment.objects.create(post=post, author=users["expired"], content="本人内容")
    assert_error(api("delete", f"/comments/{comment.pk}", user=users["member"]), 403, "FORBIDDEN")
    assert api("delete", f"/comments/{comment.pk}", user=users["expired"]).status_code == 200
    comment.refresh_from_db()
    assert comment.deleted is True
    assert_error(api("delete", f"/comments/{comment.pk}", user=users["editor"]), 404, "NOT_FOUND")


def test_likes_are_idempotent_and_unique_in_database(api, users, post):
    for _ in range(2):
        assert api("put", f"/posts/{post.pk}/like", user=users["member"]).json() == {
            "liked": True,
            "like_count": 1,
        }
    assert api("get", f"/posts/{post.pk}", user=users["member"]).json()["liked"] is True
    assert api("get", f"/posts/{post.pk}").json()["liked"] is False
    with pytest.raises(IntegrityError), transaction.atomic():
        Like.objects.create(user=users["member"], post=post)
    for _ in range(2):
        assert api("delete", f"/posts/{post.pk}/like", user=users["member"]).json() == {
            "liked": False,
            "like_count": 0,
        }


def test_reports_only_public_targets_and_duplicate_requests_are_idempotent(api, users, post):
    own_pending = Comment.objects.create(post=post, author=users["member"], content="本人待审")
    assert_error(
        api(
            "post",
            "/reports",
            {"target_type": "comment", "target_id": own_pending.pk, "reason": "ad"},
            user=users["member"],
        ),
        404,
        "NOT_FOUND",
    )
    body = {"target_type": "post", "target_id": post.pk, "reason": "ad", "detail": "说明"}
    assert api("post", "/reports", body, user=users["member"]).status_code == 200
    assert (
        api("post", "/reports", {**body, "reason": "other"}, user=users["member"]).status_code
        == 200
    )
    assert Report.objects.count() == 1
    report = Report.objects.get()
    assert report.reason == "ad"
    with pytest.raises(IntegrityError), transaction.atomic():
        Report.objects.create(
            user=users["member"], target_type="post", target_id=post.pk, reason="other"
        )


def test_report_daily_limit_and_repeat_do_not_consume_quota(api, users, boards):
    posts = [
        Post.objects.create(
            author=users["other"],
            board=boards["general"],
            title=f"报告 {index}",
            content="正文",
            status="approved",
        )
        for index in range(services.REPORT_DAILY_LIMIT + 1)
    ]

    def report(post):
        return api(
            "post",
            "/reports",
            {"target_type": "post", "target_id": post.pk, "reason": "other"},
            user=users["member"],
        )

    for row in posts[:-1]:
        assert report(row).status_code == 200
    assert_error(report(posts[-1]), 429, "RATE_LIMITED")
    assert report(posts[0]).status_code == 200
    assert Report.objects.count() == services.REPORT_DAILY_LIMIT


def test_publish_cooldowns_and_daily_limits_include_deleted_content(api, users, boards, post):
    created = api("post", "/posts", payload(boards["general"]), user=users["member"])
    assert created.status_code == 200
    assert_error(
        api("post", "/posts", payload(boards["general"]), user=users["member"]), 429, "RATE_LIMITED"
    )
    assert api("delete", f"/posts/{created.json()['id']}", user=users["member"]).status_code == 200
    assert_error(
        api("post", "/posts", payload(boards["general"]), user=users["member"]), 429, "RATE_LIMITED"
    )
    first_comment = api(
        "post", f"/posts/{post.pk}/comments", {"content": "评论"}, user=users["member"]
    )
    assert first_comment.status_code == 200
    assert_error(
        api("post", f"/posts/{post.pk}/comments", {"content": "第二条"}, user=users["member"]),
        429,
        "RATE_LIMITED",
    )
    old_enough = timezone.now() - timedelta(minutes=1)
    Post.objects.filter(author=users["member"]).update(created_at=old_enough)
    for index in range(services.POST_DAILY_LIMIT - 1):
        Post.objects.create(
            author=users["member"],
            board=boards["general"],
            title=f"既有{index}",
            content="正文",
            deleted=True,
        )
    Post.objects.filter(author=users["member"]).update(created_at=old_enough)
    assert_error(
        api("post", "/posts", payload(boards["general"]), user=users["member"]), 429, "RATE_LIMITED"
    )
    for index in range(services.COMMENT_DAILY_LIMIT - 1):
        Comment.objects.create(
            author=users["member"], post=post, content=f"既有{index}", deleted=True
        )
    Comment.objects.filter(author=users["member"]).update(created_at=old_enough)
    assert_error(
        api(
            "post", f"/posts/{post.pk}/comments", {"content": "超过每日限额"}, user=users["member"]
        ),
        429,
        "RATE_LIMITED",
    )


def test_content_moderation_permission_validation_and_audit(users, boards, post):
    pending = Post.objects.create(
        author=users["member"], board=boards["general"], title="待审", content="正文"
    )
    comment = Comment.objects.create(author=users["member"], post=post, content="待审评论")
    report = Report.objects.create(
        user=users["member"], target_type="post", target_id=post.pk, reason="other"
    )
    for action in [
        lambda: services.moderate_post(users["reviewer"], pending.pk, "approved"),
        lambda: services.moderate_comment(users["member"], comment.pk, "approved"),
        lambda: services.resolve_report(users["reviewer"], report.pk, "已处理"),
    ]:
        with pytest.raises(ServiceError) as exc:
            action()
        assert exc.value.code == "FORBIDDEN"
    for action in [
        lambda: services.moderate_post(users["editor"], pending.pk, "rejected", ""),
        lambda: services.moderate_comment(users["editor"], comment.pk, "pending"),
        lambda: services.resolve_report(users["editor"], report.pk, ""),
    ]:
        with pytest.raises(ServiceError) as exc:
            action()
        assert exc.value.code == "VALIDATION_ERROR"
    services.moderate_post(users["editor"], pending.pk, "approved", pinned=True)
    services.set_post_pinned(users["owner"], pending.pk, False)
    services.moderate_post(users["editor"], pending.pk, "rejected", "请修改")
    pending.refresh_from_db()
    assert pending.is_pinned is False
    with pytest.raises(ServiceError):
        services.set_post_pinned(users["editor"], pending.pk, True)
    services.moderate_comment(users["editor"], comment.pk, "approved")
    resolved = services.resolve_report(users["editor"], report.pk, "已核实并处理")
    assert resolved.status == "resolved"
    services.resolve_report(users["owner"], report.pk, "重复处理")
    assert AuditLog.objects.filter(action="forum.report.resolve").count() == 1
    assert AuditLog.objects.filter(action="forum.post.review").count() == 2
    assert AuditLog.objects.filter(action="forum.comment.review").count() == 1


def test_disabled_content_staff_cannot_moderate(users, post):
    StaffAccount.objects.filter(user=users["editor"]).update(is_active=False)
    with pytest.raises(ServiceError) as exc:
        services.moderate_post(users["editor"], post.pk, "rejected", "说明")
    assert exc.value.code == "FORBIDDEN"


def test_seed_requires_explicit_development_mode_and_never_grants_membership(settings):
    settings.DEBUG = True
    settings.ENABLE_DEV_LOGIN = False
    with pytest.raises(CommandError):
        call_command("seed_forum", stdout=io.StringIO())
    settings.ENABLE_DEV_LOGIN = True
    call_command("seed_demo", stdout=io.StringIO())
    call_command("seed_forum", stdout=io.StringIO())
    assert Post.objects.count() == 6
    assert Post.objects.filter(status="approved").count() == 6
    assert Membership.objects.count() == 0
    original = Post.objects.first()
    original.content = "人工修改后的内容"
    original.status = "rejected"
    original.save()
    Board.objects.filter(pk=original.board_id).update(is_active=False)
    call_command("seed_forum", stdout=io.StringIO())
    original.refresh_from_db()
    assert original.content == "人工修改后的内容"
    assert original.status == "rejected"
    assert original.board.is_active is False
    assert Post.objects.count() == 6
    settings.DEBUG = False
    with pytest.raises(CommandError):
        call_command("seed_forum", stdout=io.StringIO())
