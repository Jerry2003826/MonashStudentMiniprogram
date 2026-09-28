import pytest

from apps.content.models import (
    Activity,
    Area,
    Banner,
    Category,
    Feedback,
    HandbookSection,
    Merchant,
    SupportSettings,
)
from apps.core.models import AuditLog, StaffAccount
from apps.forum.models import Board, Comment, Post, Report

from .test_portal import browser, post

pytestmark = pytest.mark.django_db


def activity_data(**extra):
    return {
        "title": "迎新活动",
        "summary": "欢迎新同学参加校园导览",
        "category": "latest",
        "starts_at": "2026-12-10T18:00",
        "location": "Clayton",
        "content": "在图书馆集合。",
        "article_url": "https://mp.weixin.qq.com/s/welcome",
        **extra,
    }


def activity():
    data = activity_data()
    data.pop("starts_at")
    return Activity.objects.create(**data)


def feedback(user):
    return Feedback.objects.create(
        user=user,
        category="suggestion",
        content="希望可以补充更多校区周边的优惠商家。",
        contact="wechat-contact",
    )


def forum_records(user):
    board = Board.objects.create(name="校园生活")
    item = Post.objects.create(
        author=user, board=board, title="新生求助", content="想了解校园图书馆的开放时间。"
    )
    comment = Comment.objects.create(author=user, post=item, content="我也想知道。")
    report = Report.objects.create(
        user=user, target_type="post", target_id=item.pk, reason="other", detail="请管理员核查。"
    )
    return item, comment, report


@pytest.mark.parametrize("role", ["owner", "editor"])
def test_content_workspace_and_all_form_pages_are_available(identities, role):
    client = browser(identities[role])
    home = client.get("/manage/").content.decode()
    assert "内容维护功能尚未接入" not in home
    for label in ("内容管理", "论坛审核", "用户反馈"):
        assert label in home
    for resource in (
        "activities",
        "merchants",
        "categories",
        "areas",
        "banners",
        "handbook",
        "contact",
    ):
        response = client.get(f"/manage/content/{resource}/new/")
        assert response.status_code == 200, resource
    for path in ("content", "forum", "feedback"):
        assert client.get(f"/manage/{path}/").status_code == 200


def test_reviewer_has_no_content_navigation_or_direct_url_access(identities):
    client = browser(identities["reviewer"])
    home = client.get("/manage/").content.decode()
    assert "会员申请审核" in home
    for path in ("/manage/content/", "/manage/forum/", "/manage/feedback/"):
        assert f'href="{path}"' not in home
        assert client.get(path).status_code == 403
    for path in ("/manage/content/activities/new/", "/manage/content/unknown/new/"):
        assert post(client, path, activity_data()).status_code == 403
    assert not Activity.objects.exists()


def test_reviewer_cannot_write_any_direct_management_url(identities):
    client = browser(identities["reviewer"])
    entry = activity()
    note = feedback(identities["student"])
    item, comment, report = forum_records(identities["student"])
    requests = [
        (f"/manage/content/activities/{entry.pk}/edit/", activity_data(title="被改写")),
        (f"/manage/content/activities/{entry.pk}/publish/", {"published": "true"}),
        (f"/manage/feedback/{note.pk}/", {"status": "resolved", "resolution_note": "处理"}),
        (f"/manage/forum/posts/{item.pk}/review/", {"decision": "approved"}),
        (f"/manage/forum/comments/{comment.pk}/review/", {"decision": "approved"}),
        (f"/manage/forum/posts/{item.pk}/pin/", {"pinned": "true"}),
        (f"/manage/forum/reports/{report.pk}/resolve/", {"note": "完成"}),
    ]
    for path, data in requests:
        assert post(client, path, data).status_code == 403, path
    entry.refresh_from_db()
    item.refresh_from_db()
    assert entry.title == "迎新活动" and not entry.published
    assert item.status == "pending" and not item.is_pinned


def test_editor_demotion_and_disablement_affect_existing_session(identities):
    client = browser(identities["editor"])
    assert client.get("/manage/content/").status_code == 200
    StaffAccount.objects.filter(user=identities["editor"]).update(role="reviewer")
    assert client.get("/manage/content/").status_code == 403
    assert post(client, "/manage/content/activities/new/", activity_data()).status_code == 403
    StaffAccount.objects.filter(user=identities["editor"]).update(role="editor", is_active=False)
    assert client.get("/manage/forum/").status_code == 403
    assert "_auth_user_id" not in client.session


def test_all_new_write_endpoints_require_csrf(identities):
    client = browser(identities["editor"])
    entry = activity()
    note = feedback(identities["student"])
    item, comment, report = forum_records(identities["student"])
    paths = [
        "/manage/content/activities/new/",
        f"/manage/content/activities/{entry.pk}/edit/",
        f"/manage/content/activities/{entry.pk}/publish/",
        f"/manage/feedback/{note.pk}/",
        f"/manage/forum/posts/{item.pk}/review/",
        f"/manage/forum/comments/{comment.pk}/review/",
        f"/manage/forum/posts/{item.pk}/pin/",
        f"/manage/forum/reports/{report.pk}/resolve/",
    ]
    for path in paths:
        assert (
            client.post(path, {"published": "true", "decision": "approved"}).status_code == 403
        ), path
    assert not AuditLog.objects.filter(action__startswith="content.").exists()


def test_activity_draft_publish_edit_and_soft_unpublish(identities):
    client = browser(identities["editor"])
    assert post(client, "/manage/content/activities/new/", activity_data()).status_code == 302
    entry = Activity.objects.get()
    assert not entry.published
    assert client.get(f"/manage/content/activities/{entry.pk}/publish/").status_code == 405
    assert post(client, f"/manage/content/activities/{entry.pk}/publish/", {}).status_code == 400
    assert (
        post(
            client, f"/manage/content/activities/{entry.pk}/publish/", {"published": "true"}
        ).status_code
        == 302
    )
    entry.refresh_from_db()
    assert entry.published
    response = post(
        client,
        f"/manage/content/activities/{entry.pk}/edit/",
        activity_data(
            title="已更新的活动", published="on", user_id=identities["owner"].pk, is_superuser="on"
        ),
    )
    assert response.status_code == 302
    entry.refresh_from_db()
    assert entry.title == "已更新的活动" and entry.published
    post(client, f"/manage/content/activities/{entry.pk}/publish/", {"published": "false"})
    entry.refresh_from_db()
    assert not entry.published and Activity.objects.count() == 1
    identities["editor"].refresh_from_db()
    assert not identities["editor"].is_superuser
    assert (
        AuditLog.objects.filter(
            actor=identities["editor"], target_type="content.activities"
        ).count()
        == 4
    )


@pytest.mark.parametrize(
    "change",
    [
        {"title": ""},
        {"category": "unknown"},
        {"article_url": "https://evil.example/article"},
        {"article_url": "http://mp.weixin.qq.com/s/a"},
        {"starts_at": "not-a-date"},
    ],
)
def test_invalid_activity_form_preserves_errors_and_does_not_save(identities, change):
    client = browser(identities["editor"])
    response = post(client, "/manage/content/activities/new/", activity_data(**change))
    assert response.status_code == 422
    assert b'role="alert"' in response.content
    assert not Activity.objects.exists()


def test_every_content_resource_can_be_created_and_edited(identities):
    client = browser(identities["editor"])
    assert post(client, "/manage/content/categories/new/", {"name": "餐饮"}).status_code == 302
    assert post(client, "/manage/content/areas/new/", {"name": "Clayton"}).status_code == 302
    merchant_data = {
        "name": "校园咖啡",
        "logo_url": "https://example.org/logo.jpg",
        "category": Category.objects.get().pk,
        "area": Area.objects.get().pk,
        "discount_summary": "会员九折",
        "intro": "校园附近咖啡店",
        "discount_terms": "到店出示有效会员卡",
        "image_urls": "https://example.org/photo.jpg",
        "address": "1 Campus Road",
        "latitude": "-37.91",
        "longitude": "145.13",
        "phone": "",
        "opening_hours": "9:00-17:00",
        "published": "on",
    }
    assert post(client, "/manage/content/merchants/new/", merchant_data).status_code == 302
    merchant = Merchant.objects.get()
    assert merchant.image_urls == ["https://example.org/photo.jpg"] and merchant.published
    assert (
        post(
            client,
            "/manage/content/banners/new/",
            {
                "title": "商家轮播",
                "image_url": "https://example.org/banner.jpg",
                "link_type": "merchant",
                "link_id": merchant.pk,
                "sort_order": 0,
                "published": "on",
            },
        ).status_code
        == 302
    )
    assert (
        post(
            client,
            "/manage/content/handbook/new/",
            {"title": "到校指南", "content": "先领取学生卡。", "sort_order": 1, "published": "on"},
        ).status_code
        == 302
    )
    assert (
        post(
            client,
            "/manage/content/contact/new/",
            {"website_url": "https://example.org/", "assistant_wechat": "mcss"},
        ).status_code
        == 302
    )
    assert Banner.objects.get().published and HandbookSection.objects.get().published
    assert SupportSettings.objects.get().assistant_wechat == "mcss"
    assert client.get("/manage/content/contact/new/").url == "/manage/content/contact/1/edit/"
    for resource, instance in [
        ("categories", Category.objects.get()),
        ("areas", Area.objects.get()),
        ("merchants", merchant),
        ("banners", Banner.objects.get()),
        ("handbook", HandbookSection.objects.get()),
    ]:
        assert client.get(f"/manage/content/{resource}/{instance.pk}/edit/").status_code == 200


def test_unknown_resource_and_nonpublishable_models_cannot_be_mutated(identities):
    client = browser(identities["editor"])
    category = Category.objects.create(name="购物")
    assert post(client, "/manage/content/users/new/", {"is_superuser": "on"}).status_code == 404
    assert (
        post(
            client, f"/manage/content/categories/{category.pk}/publish/", {"published": "false"}
        ).status_code
        == 404
    )
    assert client.post(f"/manage/content/categories/{category.pk}/delete/").status_code == 404
    assert Category.objects.filter(pk=category.pk).exists()


def test_duplicate_category_and_invalid_banner_target_return_form_errors(identities):
    client = browser(identities["editor"])
    Category.objects.create(name="餐饮")
    assert post(client, "/manage/content/categories/new/", {"name": "餐饮"}).status_code == 422
    result = post(
        client,
        "/manage/content/banners/new/",
        {
            "title": "失效跳转",
            "image_url": "https://example.org/banner.jpg",
            "link_type": "merchant",
            "link_id": 9999,
            "sort_order": 0,
            "published": "on",
        },
    )
    assert result.status_code == 422 and not Banner.objects.exists()


def test_feedback_status_notes_audit_and_whitelist(identities):
    client = browser(identities["editor"])
    note = feedback(identities["student"])
    assert client.get("/manage/feedback/").status_code == 200
    result = post(
        client,
        f"/manage/feedback/{note.pk}/",
        {
            "status": "resolved",
            "resolution_note": "已补充商家资料",
            "content": "试图改原始反馈",
            "user": identities["editor"].pk,
        },
    )
    assert result.status_code == 302
    note.refresh_from_db()
    assert note.status == "resolved" and note.resolution_note == "已补充商家资料"
    assert note.user_id == identities["student"].pk and "希望" in note.content
    assert AuditLog.objects.filter(action="feedback.resolve", target_id=note.pk).exists()
    assert post(client, f"/manage/feedback/{note.pk}/", {"status": "unknown"}).status_code == 422


def test_forum_review_pin_reject_comment_and_report_updates(identities):
    client = browser(identities["editor"])
    item, comment, report = forum_records(identities["student"])
    assert client.get("/manage/forum/").status_code == 200
    assert client.get("/manage/forum/?kind=comments").status_code == 200
    reports_page = client.get("/manage/forum/?kind=reports")
    assert reports_page.status_code == 200
    assert f"?kind=posts&amp;status=pending&amp;item={item.pk}" in reports_page.content.decode()
    focused = client.get(f"/manage/forum/?kind=posts&status=pending&item={item.pk}")
    assert focused.context["page"].paginator.count == 1
    review_url = f"/manage/forum/posts/{item.pk}/review/"
    post(client, review_url, {"note": "未选择"})
    item.refresh_from_db()
    assert item.status == "pending"
    post(client, review_url, {"decision": "approved", "note": "核对通过"})
    item.refresh_from_db()
    assert item.status == "approved" and item.reviewer == identities["editor"]
    post(client, f"/manage/forum/posts/{item.pk}/pin/", {"pinned": "true"})
    item.refresh_from_db()
    assert item.is_pinned
    post(
        client,
        f"/manage/forum/comments/{comment.pk}/review/",
        {"decision": "approved", "note": "评论通过"},
    )
    comment.refresh_from_db()
    assert comment.status == "approved" and comment.review_note == "评论通过"
    post(client, review_url, {"decision": "rejected", "note": "撤回内容"})
    item.refresh_from_db()
    assert item.status == "rejected" and not item.is_pinned
    post(client, f"/manage/forum/reports/{report.pk}/resolve/", {"note": "已核查并撤回"})
    report.refresh_from_db()
    assert report.status == "resolved" and report.resolution_note == "已核查并撤回"


def test_content_and_forum_text_is_escaped(identities):
    client = browser(identities["editor"])
    entry = activity()
    entry.title = '<script>alert("unsafe")</script>'
    entry.save()
    listing = client.get("/manage/content/activities/").content.decode()
    assert "&lt;script&gt;" in listing and '<script>alert("unsafe")' not in listing
    item, _, _ = forum_records(identities["student"])
    item.content = '<img src=x onerror="alert(1)">'
    item.save()
    listing = client.get("/manage/forum/").content.decode()
    assert "&lt;img" in listing and "<img src=x" not in listing
