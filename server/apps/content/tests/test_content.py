import io
import json
import math
from datetime import datetime, timedelta

import pytest
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.core.management.base import CommandError
from django.utils import timezone

from apps.content.forms import FeedbackResolveForm, MerchantForm, SupportSettingsForm
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
from apps.content.services import straight_line_distance
from apps.core.models import AuditLog, User
from apps.core.services import issue_token

pytestmark = pytest.mark.django_db


@pytest.fixture
def user():
    return User.objects.create_user(
        username="content-student", openid="content-student-id", password=None
    )


@pytest.fixture
def api(client):
    def invoke(method, path, body=None, token=None):
        headers = {"HTTP_AUTHORIZATION": f"Bearer {token}"} if token else {}
        return getattr(client, method)(
            f"/api/v1{path}",
            data=json.dumps(body) if body is not None else None,
            content_type="application/json",
            **headers,
        )

    return invoke


@pytest.fixture
def merchants():
    category = Category.objects.create(name="餐饮")
    other_category = Category.objects.create(name="生活服务")
    area = Area.objects.create(name="Clayton")
    other_area = Area.objects.create(name="City")
    result = []
    for index in range(8):
        result.append(
            Merchant.objects.create(
                name=f"Cafe {index}",
                category=category if index % 2 else other_category,
                area=area if index % 2 else other_area,
                discount_summary="测试优惠",
                intro="介绍",
                discount_terms="使用条件",
                address="测试地址",
                latitude=0,
                longitude=10 - index,
                published=True,
                featured=index == 0,
            )
        )
    return result


def create_activity(title="示例活动", **overrides):
    fields = {
        "title": title,
        "category": "latest",
        "summary": "校园资讯内容",
        "content": "活动正文",
        "published": True,
        "is_example": True,
    }
    fields.update(overrides)
    return Activity.objects.create(**fields)


def test_activities_are_public_filtered_paginated_and_unpublished_hidden(api):
    entries = [create_activity(title=f"Activity {index}") for index in range(8)]
    news = create_activity(title="News note", category="news")
    hidden = create_activity(title="Secret draft", published=False)
    first = api("get", "/activities?category=latest&q=ACTIVITY").json()
    assert len(first["items"]) == 6 and first["next_cursor"] == "6"
    second = api(
        "get", f"/activities?category=latest&q=ACTIVITY&cursor={first['next_cursor']}"
    ).json()
    assert [item["id"] for item in first["items"] + second["items"]] == [
        row.pk for row in reversed(entries)
    ]
    assert second["next_cursor"] is None
    assert api("get", "/activities?category=news").json()["items"][0]["id"] == news.pk
    assert api("get", "/activities?q=no-match").json() == {"items": [], "next_cursor": None}
    assert api("get", f"/activities/{hidden.pk}").status_code == 404
    detail = api("get", f"/activities/{entries[0].pk}").json()
    assert detail["content"] == "活动正文"
    assert (
        detail["starts_at"] is None
        and detail["article_url"] is None
        and detail["is_example"] is True
    )


@pytest.mark.parametrize(
    "query",
    [
        "category=invalid",
        "cursor=-1",
        "cursor=01",
        "cursor=1.1",
        "cursor=9007199254740992",
        "limit=0",
        "limit=101",
        "q=" + "x" * 201,
        "q=one&q=two",
        "published=false",
    ],
)
def test_activity_query_validation(api, query):
    response = api("get", f"/activities?{query}")
    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"


def test_merchant_filters_and_normal_listing_are_public(api, merchants):
    filters = api("get", "/merchants/filters").json()
    assert [row["name"] for row in filters["categories"]] == ["餐饮", "生活服务"]
    assert [row["name"] for row in filters["areas"]] == ["Clayton", "City"]
    first = api("get", "/merchants").json()
    assert first["next_cursor"] == "6"
    assert all(row["distance_m"] is None for row in first["items"])
    assert first["items"][0]["latitude"] == 0
    target = merchants[1]
    filtered = api("get", f"/merchants?category={target.category_id}&area={target.area_id}").json()
    assert len(filtered["items"]) == 4
    assert all(row["category"]["id"] == target.category_id for row in filtered["items"])
    assert api("get", "/merchants?q=CAFE%202").json()["items"][0]["id"] == merchants[2].pk
    assert api("get", "/merchants?category=999999").json() == {"items": [], "next_cursor": None}


def test_distance_sort_orders_all_matches_before_paging(api, merchants):
    first = api("get", "/merchants?latitude=0&longitude=0&sort=distance").json()
    second = api("get", "/merchants?latitude=0&longitude=0&sort=distance&cursor=6").json()
    assert [row["id"] for row in first["items"] + second["items"]] == [
        row.pk for row in reversed(merchants)
    ]
    assert first["items"][0]["distance_m"] == pytest.approx(333584.78, abs=0.1)
    assert second["next_cursor"] is None
    natural = api("get", "/merchants?latitude=0&longitude=0").json()
    assert natural["items"][0]["id"] == merchants[0].pk
    assert natural["items"][0]["distance_m"] > 0


def test_distance_equal_ties_use_stable_id_order_and_antipodes_are_finite(api, merchants):
    for merchant in merchants:
        merchant.longitude = 0
        merchant.save()
    response = api("get", "/merchants?latitude=0&longitude=0&sort=distance&limit=100").json()
    assert [row["id"] for row in response["items"]] == [row.pk for row in merchants]
    assert all(row["distance_m"] == 0 for row in response["items"])
    assert math.isfinite(straight_line_distance((0, 0), (0, 180)))


@pytest.mark.parametrize(
    "query",
    [
        "category=-1",
        "area=0",
        "area=NaN",
        "sort=random",
        "sort=distance",
        "latitude=0",
        "longitude=0",
        "latitude=NaN&longitude=0",
        "latitude=91&longitude=0",
        "latitude=0&longitude=181",
        "latitude=1e999&longitude=0",
        "cursor=01",
        "cursor=-1",
        "limit=1000",
        "latitude=0&latitude=10&longitude=0",
        "is_example=false",
    ],
)
def test_merchant_query_validation(api, query):
    response = api("get", f"/merchants?{query}")
    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"


def test_unpublishing_merchant_hides_list_detail_featured_and_banner(api, merchants):
    merchant = merchants[0]
    banner = Banner.objects.create(
        title="商家介绍",
        image_url="https://images.example.org/banner.jpg",
        link_type="merchant",
        link_id=merchant.pk,
        published=True,
    )
    home = api("get", "/home").json()
    assert home["banners"][0]["id"] == banner.pk
    assert home["featured_merchants"][0]["id"] == merchant.pk
    assert api("get", f"/merchants/{merchant.pk}").json()["intro"] == "介绍"
    merchant.published = False
    merchant.save()
    home = api("get", "/home").json()
    assert home["banners"] == home["featured_merchants"] == []
    assert api("get", f"/merchants/{merchant.pk}").status_code == 404
    assert merchant.pk not in [
        row["id"] for row in api("get", "/merchants?limit=100").json()["items"]
    ]


def test_banner_sort_order_and_drafts(api):
    low = Banner.objects.create(
        title="后", image_url="https://images.example.org/last.jpg", published=True, sort_order=20
    )
    high = Banner.objects.create(
        title="前", image_url="https://images.example.org/first.jpg", published=True, sort_order=1
    )
    Banner.objects.create(
        title="草稿", image_url="https://images.example.org/draft.jpg", published=False
    )
    assert [item["id"] for item in api("get", "/home").json()["banners"]] == [high.pk, low.pk]
    with pytest.raises(ValidationError):
        Banner.objects.create(
            title="无效目标",
            image_url="https://images.example.org/a.jpg",
            link_type="merchant",
            link_id=999999,
            published=True,
        )


def test_post_banner_requires_public_post_and_disappears_after_moderation(api, user):
    from apps.forum.models import Board, Post

    board = Board.objects.create(name="新闻", is_active=True)
    post = Post.objects.create(
        author=user, board=board, title="公开帖子", content="正文", status="pending"
    )
    banner = Banner(
        title="帖子介绍",
        image_url="https://images.example.org/post.jpg",
        link_type="post",
        link_id=post.pk,
        published=True,
    )
    with pytest.raises(ValidationError):
        banner.save()
    post.status = "approved"
    post.save()
    banner.save()
    assert api("get", "/home").json()["banners"][0]["id"] == banner.pk
    for field, value in [("status", "rejected"), ("deleted", True)]:
        post.status, post.deleted = "approved", False
        setattr(post, field, value)
        post.save()
        assert api("get", "/home").json()["banners"] == []
    post.status, post.deleted = "approved", False
    post.save()
    board.is_active = False
    board.save()
    assert api("get", "/home").json()["banners"] == []


def test_support_defaults_null_and_only_published_handbook(api):
    assert api("get", "/support").json() == {
        "handbook": [],
        "website_url": None,
        "assistant_wechat": None,
    }
    hidden = HandbookSection.objects.create(title="草稿", content="未发布正文")
    published = HandbookSection.objects.create(
        title="正式章节", content="已审阅正文", published=True
    )
    SupportSettings.objects.create(
        website_url="https://society.example.org", assistant_wechat="assistant-demo"
    )
    content = api("get", "/support").json()
    assert content["handbook"] == [
        {"id": published.pk, "title": "正式章节", "content": "已审阅正文"}
    ]
    assert all(row["id"] != hidden.pk for row in content["handbook"])
    assert content["website_url"] == "https://society.example.org"
    assert content["assistant_wechat"] == "assistant-demo"
    with pytest.raises(ValidationError):
        SupportSettings.objects.create(pk=2)


@pytest.mark.parametrize(
    "url",
    [
        "http://mp.weixin.qq.com/s/test",
        "https://mp.weixin.qq.com.evil.test/s/test",
        "https://mp.weixin.qq.com@evil.test/s/test",
        "https://user:secret@mp.weixin.qq.com/s/test",
        "https://example.org/article",
        "https://mp.weixin.qq.com/",
        "https://mp.weixin.qq.com/profile",
        "javascript:alert(1)",
    ],
)
def test_activity_article_urls_reject_unsafe_or_unapproved_sources(url):
    with pytest.raises(ValidationError):
        create_activity(article_url=url)


def test_valid_article_link_and_blank_optional_urls():
    activity = create_activity(article_url="https://mp.weixin.qq.com/s/official-article")
    assert activity.article_url.startswith("https://mp.weixin.qq.com/")
    assert create_activity().article_url == ""
    form = SupportSettingsForm(data={"website_url": "http://example.org", "assistant_wechat": ""})
    assert not form.is_valid() and "website_url" in form.errors


@pytest.mark.parametrize(
    "field,value",
    [
        ("latitude", float("nan")),
        ("latitude", 91),
        ("longitude", float("inf")),
        ("longitude", -181),
        ("logo_url", "http://images.example.org/logo.png"),
        ("image_urls", {}),
        ("image_urls", ["http://images.example.org/a.jpg"]),
        ("image_urls", ["https://images.example.org/a.jpg"] * 10),
    ],
)
def test_merchant_model_save_enforces_url_json_and_coordinate_validation(merchants, field, value):
    merchant = merchants[0]
    setattr(merchant, field, value)
    with pytest.raises(ValidationError):
        merchant.save()


def test_merchant_image_form_uses_lines_preserves_list_and_rejects_invalid_urls(merchants):
    merchant = merchants[0]
    merchant.image_urls = [
        "https://images.example.org/one.jpg",
        "https://images.example.org/two.jpg",
    ]
    merchant.save()
    form = MerchantForm(instance=merchant)
    assert (
        form.initial["image_urls"]
        == "https://images.example.org/one.jpg\nhttps://images.example.org/two.jpg"
    )
    data = {field: getattr(merchant, field) for field in MerchantForm.Meta.fields}
    data.update(
        category=merchant.category_id,
        area=merchant.area_id,
        image_urls="https://images.example.org/new.jpg\n\nhttps://images.example.org/second.jpg",
    )
    form = MerchantForm(data=data, instance=merchant)
    assert form.is_valid(), form.errors
    saved = form.save()
    assert saved.image_urls == [
        "https://images.example.org/new.jpg",
        "https://images.example.org/second.jpg",
    ]
    data["image_urls"] = "http://images.example.org/insecure.jpg"
    bad = MerchantForm(data=data, instance=saved)
    assert not bad.is_valid() and "image_urls" in bad.errors


def test_feedback_authentication_persistence_and_no_public_listing(api, user):
    body = {
        "category": "suggestion",
        "content": "希望增加更多经过审核的校园信息内容。",
        "contact": " student ",
    }
    assert api("post", "/feedback", body).status_code == 401
    result = api("post", "/feedback", body, token=issue_token(user))
    assert result.status_code == 200
    row = Feedback.objects.get(pk=result.json()["id"])
    assert row.user_id == user.pk and row.contact == "student"
    assert row.status == "new"
    assert api("get", "/feedback").status_code in {404, 405}
    assert AuditLog.objects.filter(action="feedback.create", target_id=row.pk).count() == 1


def test_feedback_repeated_identical_requests_return_same_id_and_new_content_rate_limits(api, user):
    token = issue_token(user)
    body = {"category": "bug", "content": "点击活动详情时有时会出现空白页面。"}
    first = api("post", "/feedback", body, token=token)
    second = api("post", "/feedback", {**body, "content": f"  {body['content']}  "}, token=token)
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    assert Feedback.objects.count() == 1
    blocked = api(
        "post",
        "/feedback",
        {**body, "content": "另一条反馈：商家名称似乎有个错别字。"},
        token=token,
    )
    assert blocked.status_code == 429 and blocked.json()["code"] == "RATE_LIMITED"
    assert AuditLog.objects.filter(action="feedback.create").count() == 1


def test_feedback_ten_per_user_daily_limit_does_not_block_other_users(api, user):
    now = timezone.now()
    for index in range(10):
        row = Feedback.objects.create(
            user=user, category="bug", content=f"测试反馈内容达到字数要求 {index}"
        )
        Feedback.objects.filter(pk=row.pk).update(created_at=now - timedelta(minutes=index + 2))
    body = {"category": "bug", "content": "第十一条新的反馈，应当受到次数限制。"}
    assert api("post", "/feedback", body, token=issue_token(user)).status_code == 429
    other = User.objects.create_user(username="other-feedback", password=None)
    assert api("post", "/feedback", body, token=issue_token(other)).status_code == 200


@pytest.mark.parametrize(
    "body",
    [
        {"category": "invalid", "content": "这是一条字数足够的测试反馈。"},
        {"category": "bug", "content": "太短了"},
        {"category": "bug", "content": " " * 20},
        {"category": "bug", "content": "字" * 1001},
        {"category": "bug", "content": "这是一条字数足够的测试反馈。", "contact": "x" * 101},
        {"category": "bug", "content": "这是一条字数足够的测试反馈。", "status": "resolved"},
        {"category": "bug", "content": "这是一条字数足够的测试反馈。", "user_id": 123},
    ],
)
def test_feedback_rejects_invalid_or_privileged_fields(api, user, body):
    response = api("post", "/feedback", body, token=issue_token(user))
    assert response.status_code == 422 and response.json()["code"] == "VALIDATION_ERROR"
    assert not Feedback.objects.exists()


def test_feedback_management_form_only_changes_resolution_fields(user):
    entry = Feedback.objects.create(
        user=user, category="bug", content="这是一条真实长度的测试反馈。"
    )
    form = FeedbackResolveForm(
        data={
            "status": "resolved",
            "resolution_note": "已经处理",
            "user": 999,
            "content": "篡改原始反馈内容",
        },
        instance=entry,
    )
    assert form.is_valid(), form.errors
    form.save()
    entry.refresh_from_db()
    assert entry.status == "resolved" and entry.resolution_note == "已经处理"
    assert entry.user_id == user.pk and entry.content == "这是一条真实长度的测试反馈。"


def test_seed_content_is_development_only_idempotent_and_preserves_edits(settings):
    settings.DEBUG = True
    settings.ENABLE_DEV_LOGIN = False
    with pytest.raises(CommandError):
        call_command("seed_content", stdout=io.StringIO())
    settings.ENABLE_DEV_LOGIN = True
    call_command("seed_content", stdout=io.StringIO())
    assert Activity.objects.count() == 3 and Merchant.objects.count() == 1
    assert all(row.is_example for row in Activity.objects.all())
    merchant = Merchant.objects.get()
    assert merchant.is_example and "示例" in merchant.name
    merchant.discount_summary = "本地已编辑的说明"
    merchant.published = False
    merchant.save()
    support = SupportSettings.objects.get()
    assert support.website_url == support.assistant_wechat == ""
    support.assistant_wechat = "approved-contact"
    support.save()
    call_command("seed_content", stdout=io.StringIO())
    merchant.refresh_from_db()
    support.refresh_from_db()
    assert merchant.discount_summary == "本地已编辑的说明" and not merchant.published
    assert support.assistant_wechat == "approved-contact"
    assert Activity.objects.count() == 3 and Merchant.objects.count() == 1
    settings.DEBUG = False
    with pytest.raises(CommandError):
        call_command("seed_content", stdout=io.StringIO())


@pytest.mark.parametrize(
    "instant, expected",
    [
        ("2026-09-27T15:00:00+00:00", "2026-09-28T01:00:00+10:00"),
        ("2026-12-01T13:30:00+00:00", "2026-12-02T00:30:00+11:00"),
    ],
)
def test_activity_dates_keep_melbourne_calendar_day_across_dst(api, instant, expected):
    activity = create_activity(starts_at=datetime.fromisoformat(instant))
    detail = api("get", f"/activities/{activity.pk}").json()
    listing = api("get", "/activities").json()
    assert detail["starts_at"] == expected
    assert listing["items"][0]["starts_at"] == expected
