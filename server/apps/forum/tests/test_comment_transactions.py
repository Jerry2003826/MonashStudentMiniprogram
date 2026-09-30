"""Comment safety checks release locks and revalidate before saving."""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier, Event

import pytest
from django.contrib.auth.models import AnonymousUser
from django.db import close_old_connections, connection, connections
from django.utils import timezone

from apps.core.errors import ServiceError
from apps.core.models import AuditLog, Membership, StaffAccount, User
from apps.forum import services
from apps.forum.models import Board, Comment, Like, Post

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture
def thread():
    users = {}
    for role in ["author", "post_author", "stranger", "editor", "owner", "reviewer"]:
        user = User.objects.create_user(username=f"comment-{role}", password=None)
        Membership.objects.create(
            user=user,
            email=f"{role}@student.monash.edu",
            approved_at=timezone.now() - timedelta(days=1),
            expires_at=timezone.now() + timedelta(days=30),
        )
        if role in ["editor", "owner", "reviewer"]:
            StaffAccount.objects.create(user=user, role=role)
        users[role] = user
    board = Board.objects.create(name="Comment transaction board")
    post = Post.objects.create(
        board=board,
        author=users["post_author"],
        title="公开帖子",
        content="正文",
        status="approved",
    )
    return users, post


def test_remote_check_runs_without_transaction_and_save_rechecks_under_locks(thread, monkeypatch):
    users, post = thread
    request = object()
    phases = []
    require_writer = services.require_writer
    interactive_post = services.interactive_post

    def writer(actor):
        assert connection.in_atomic_block
        phases.append("writer")
        return require_writer(actor)

    def parent(post_id, lock=False):
        assert connection.in_atomic_block and lock
        phases.append("post")
        return interactive_post(post_id, lock=lock)

    def safety(actor, content, scene, **kwargs):
        assert not connection.in_atomic_block
        assert actor.pk == users["author"].pk
        assert (content, scene, kwargs) == ("回复", 2, {"request": request})
        assert not Comment.objects.exists()
        phases.append("safety")
        return "review"

    monkeypatch.setattr(services, "require_writer", writer)
    monkeypatch.setattr(services, "interactive_post", parent)
    monkeypatch.setattr(services.wechat_safety, "check_text", safety)
    comment = services.create_comment(users["author"], post.pk, " 回复 ", request=request)

    assert phases == ["writer", "post", "safety", "writer", "post"]
    assert comment.content == "回复"
    assert comment.status == "pending"
    assert not connection.in_atomic_block


@pytest.mark.parametrize(
    "change,code",
    [
        ("inactive_user", "FORBIDDEN"),
        ("banned_user", "USER_BANNED"),
        ("expired_membership", "MEMBERSHIP_REQUIRED"),
        ("deleted_membership", "MEMBERSHIP_REQUIRED"),
        ("pending_post", "NOT_FOUND"),
        ("rejected_post", "NOT_FOUND"),
        ("deleted_post", "NOT_FOUND"),
        ("inactive_board", "NOT_FOUND"),
        ("moved_to_inactive_board", "NOT_FOUND"),
    ],
)
def test_comment_revalidates_changes_during_remote_check(thread, monkeypatch, change, code):
    users, post = thread
    actor = users["author"]

    def safety(*args, **kwargs):
        assert not connection.in_atomic_block
        if change == "inactive_user":
            User.objects.filter(pk=actor.pk).update(is_active=False)
        elif change == "banned_user":
            User.objects.filter(pk=actor.pk).update(banned_until=timezone.now() + timedelta(days=1))
        elif change == "expired_membership":
            Membership.objects.filter(user=actor).update(
                expires_at=timezone.now() - timedelta(seconds=1)
            )
        elif change == "deleted_membership":
            Membership.objects.filter(user=actor).delete()
        elif change == "deleted_post":
            Post.objects.filter(pk=post.pk).update(deleted=True)
        elif change in ["pending_post", "rejected_post"]:
            Post.objects.filter(pk=post.pk).update(status=change.removesuffix("_post"))
        elif change == "inactive_board":
            Board.objects.filter(pk=post.board_id).update(is_active=False)
        else:
            inactive = Board.objects.create(name="Inactive", is_active=False)
            Post.objects.filter(pk=post.pk).update(board=inactive)
        return "pass"

    monkeypatch.setattr(services.wechat_safety, "check_text", safety)
    with pytest.raises(ServiceError) as error:
        services.create_comment(actor, post.pk, "不应保存")
    assert error.value.code == code
    assert not Comment.objects.exists()


@pytest.mark.parametrize("change", ["deleted", "pending", "rejected", "moved", "lost_staff"])
def test_reply_participation_and_permissions_revalidated_after_check(thread, monkeypatch, change):
    users, post = thread
    actor = users["editor"] if change == "lost_staff" else users["author"]
    participant = Comment.objects.create(
        post=post,
        author=users["stranger"],
        content="参与者",
        status="pending" if change == "lost_staff" else "approved",
    )

    def safety(*args, **kwargs):
        assert not connection.in_atomic_block
        if change == "deleted":
            services.delete_comment(users["stranger"], participant.pk)
        elif change == "moved":
            elsewhere = Post.objects.create(
                board=post.board,
                author=post.author,
                title="另一帖",
                content="正文",
                status="approved",
            )
            Comment.objects.filter(pk=participant.pk).update(post=elsewhere)
        elif change == "lost_staff":
            StaffAccount.objects.filter(user=actor).update(is_active=False)
        else:
            Comment.objects.filter(pk=participant.pk).update(status=change)
        return "pass"

    monkeypatch.setattr(services.wechat_safety, "check_text", safety)
    with pytest.raises(ServiceError) as error:
        services.create_comment(actor, post.pk, "回复", participant.author_id)
    assert error.value.code == "VALIDATION_ERROR"
    assert not Comment.objects.filter(author=actor).exists()


@pytest.mark.parametrize("limit", ["cooldown", "daily"])
def test_publication_limits_rechecked_after_remote_check(thread, monkeypatch, limit):
    users, post = thread
    actor = users["author"]
    monkeypatch.setattr(services, "COMMENT_DAILY_LIMIT", 2)
    if limit == "daily":
        monkeypatch.setattr(services, "COMMENT_COOLDOWN_SECONDS", 0)

    def another_comment():
        Comment.objects.create(post=post, author=actor, content="另一个请求")

    if limit == "daily":
        another_comment()

    def safety(*args, **kwargs):
        assert not connection.in_atomic_block
        another_comment()
        return "pass"

    monkeypatch.setattr(services.wechat_safety, "check_text", safety)
    with pytest.raises(ServiceError) as error:
        services.create_comment(actor, post.pk, "不应保存")
    assert error.value.code == "RATE_LIMITED"
    assert not Comment.objects.filter(content="不应保存").exists()
    assert Comment.objects.count() == (2 if limit == "daily" else 1)


def test_remote_failure_does_not_create_a_comment(thread, monkeypatch):
    users, post = thread

    def safety(*args, **kwargs):
        assert not connection.in_atomic_block
        raise ServiceError(503, "INTERNAL_ERROR", "内容安全服务暂时不可用")

    monkeypatch.setattr(services.wechat_safety, "check_text", safety)
    with pytest.raises(ServiceError) as error:
        services.create_comment(users["author"], post.pk, "回复")
    assert error.value.status == 503
    assert not Comment.objects.exists()


@pytest.mark.parametrize("parent_state", ["approved", "pending", "rejected", "deleted", "inactive"])
@pytest.mark.parametrize(
    "role,allowed",
    [
        ("author", True),
        ("editor", True),
        ("owner", True),
        ("stranger", False),
        ("post_author", False),
        ("reviewer", False),
        ("anonymous", False),
    ],
)
def test_comment_deletion_depends_on_owner_or_staff_not_parent_visibility(
    thread, parent_state, role, allowed
):
    users, post = thread
    comment = Comment.objects.create(post=post, author=users["author"], content="撤回内容")
    if parent_state == "deleted":
        Post.objects.filter(pk=post.pk).update(deleted=True)
    elif parent_state == "inactive":
        Board.objects.filter(pk=post.board_id).update(is_active=False)
    else:
        Post.objects.filter(pk=post.pk).update(status=parent_state)
    # Membership and publishing bans never stop an author from withdrawing content.
    Membership.objects.all().update(expires_at=timezone.now() - timedelta(days=1))
    User.objects.filter(pk=users["author"].pk).update(
        banned_until=timezone.now() + timedelta(days=1)
    )
    actor = AnonymousUser() if role == "anonymous" else users[role]
    if allowed:
        services.delete_comment(actor, comment.pk)
        audit = AuditLog.objects.get(action="forum.comment.delete", target_id=comment.pk)
        assert audit.actor_id == actor.pk
        assert audit.target_type == "forum_comment"
        with pytest.raises(ServiceError) as error:
            services.delete_comment(actor, comment.pk)
        assert error.value.code == "NOT_FOUND"
        assert AuditLog.objects.filter(action="forum.comment.delete").count() == 1
    else:
        with pytest.raises(ServiceError) as error:
            services.delete_comment(actor, comment.pk)
        assert error.value.code == ("UNAUTHORIZED" if role == "anonymous" else "FORBIDDEN")
        assert not AuditLog.objects.exists()
    comment.refresh_from_db()
    assert comment.deleted is allowed


def test_comment_deletion_and_audit_remain_atomic(thread, monkeypatch):
    users, post = thread
    comment = Comment.objects.create(post=post, author=users["author"], content="撤回内容")
    Post.objects.filter(pk=post.pk).update(deleted=True)

    def audit_failure(*args, **kwargs):
        assert connection.in_atomic_block
        raise RuntimeError("Audit unavailable")

    monkeypatch.setattr(AuditLog.objects, "create", audit_failure)
    with pytest.raises(RuntimeError, match="Audit unavailable"):
        services.delete_comment(users["author"], comment.pk)
    comment.refresh_from_db()
    assert comment.deleted is False


def independent_connection(action):
    close_old_connections()
    worker_connection = connections["default"]
    try:
        with worker_connection.cursor() as cursor:
            cursor.execute("SET lock_timeout = '3s'")
            cursor.execute("SET statement_timeout = '5s'")
        return action()
    finally:
        worker_connection.close()
        close_old_connections()


@pytest.mark.skipif(connection.vendor != "postgresql", reason="Requires PostgreSQL row locking")
def test_slow_remote_check_releases_author_and_post_locks(thread, monkeypatch):
    users, post = thread
    entered = Event()
    resume = Event()

    def safety(*args, **kwargs):
        assert not connection.in_atomic_block
        entered.set()
        assert resume.wait(timeout=10)
        return "pass"

    monkeypatch.setattr(services.wechat_safety, "check_text", safety)
    with ThreadPoolExecutor(max_workers=2) as executor:
        creating = executor.submit(
            independent_connection,
            lambda: services.create_comment(users["author"], post.pk, "慢速检测"),
        )
        try:
            assert entered.wait(timeout=10)
            liking = executor.submit(
                independent_connection,
                lambda: services.set_like(users["author"], post.pk, True),
            )
            assert liking.result(timeout=10)["liked"] is True
        finally:
            resume.set()
        assert creating.result(timeout=10).status == "pending"
    assert Like.objects.filter(user=users["author"], post=post).count() == 1


@pytest.mark.skipif(connection.vendor != "postgresql", reason="Requires PostgreSQL row locking")
def test_concurrent_comments_recheck_cooldown_after_both_remote_checks(thread, monkeypatch):
    users, post = thread
    checked = Barrier(2, timeout=10)

    def safety(*args, **kwargs):
        assert not connection.in_atomic_block
        checked.wait()
        return "pass"

    def create():
        try:
            services.create_comment(users["author"], post.pk, "并发回复")
            return "created"
        except ServiceError as error:
            return error.code

    monkeypatch.setattr(services.wechat_safety, "check_text", safety)
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(independent_connection, create) for _ in range(2)]
        assert sorted(future.result(timeout=20) for future in futures) == [
            "RATE_LIMITED",
            "created",
        ]
    assert Comment.objects.filter(author=users["author"]).count() == 1
