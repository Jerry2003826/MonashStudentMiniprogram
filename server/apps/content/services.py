import math
import re
from datetime import timedelta

from django.apps import apps
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.core import wechat_safety
from apps.core.errors import ServiceError
from apps.core.models import AuditLog, User

from .models import (
    Activity,
    Area,
    Banner,
    Category,
    Feedback,
    HandbookSection,
    Merchant,
    SupportSettings,
)

PAGE_SIZE = 6
EARTH_RADIUS_METRES = 6_371_000
FEEDBACK_COOLDOWN = timedelta(seconds=60)
FEEDBACK_WINDOW = timedelta(hours=24)
FEEDBACK_DAILY_LIMIT = 10


def _invalid(message):
    return ServiceError(422, "VALIDATION_ERROR", message)


def _query(query, allowed):
    if set(query) - set(allowed):
        raise _invalid("包含不支持的查询参数")
    if hasattr(query, "getlist") and any(len(query.getlist(key)) != 1 for key in query):
        raise _invalid("查询参数不能重复")
    return query


def _integer(value, label, *, minimum=0, maximum=9_007_199_254_740_991):
    if not isinstance(value, str) or len(value) > 16 or not re.fullmatch(r"0|[1-9][0-9]*", value):
        raise _invalid(f"{label}无效")
    result = int(value)
    if not minimum <= result <= maximum:
        raise _invalid(f"{label}超出有效范围")
    return result


def _pagination(query):
    return (
        _integer(query.get("cursor", "0"), "分页游标"),
        _integer(query.get("limit", str(PAGE_SIZE)), "每页数量", minimum=1, maximum=100),
    )


def _keyword(query):
    value = query.get("q", "")
    if not isinstance(value, str) or len(value) > 200:
        raise _invalid("搜索关键词最多 200 字")
    return value.strip()


def _page(rows, offset, limit, serialize):
    selected = list(rows[offset : offset + limit + 1])
    return {
        "items": [serialize(row) for row in selected[:limit]],
        "next_cursor": str(offset + limit) if len(selected) > limit else None,
    }


def activity_summary(activity):
    return {
        "id": activity.pk,
        "title": activity.title,
        "summary": activity.summary,
        "category": activity.category,
        "starts_at": timezone.localtime(activity.starts_at).isoformat()
        if activity.starts_at
        else None,
        "location": activity.location,
        "is_example": activity.is_example,
    }


def list_activities(query):
    _query(query, {"category", "q", "cursor", "limit"})
    offset, limit = _pagination(query)
    category = query.get("category")
    if category is not None and category not in Activity.Category.values:
        raise _invalid("请选择有效的活动分类")
    queryset = Activity.objects.filter(published=True)
    if category:
        queryset = queryset.filter(category=category)
    keyword = _keyword(query)
    if keyword:
        queryset = queryset.filter(Q(title__icontains=keyword) | Q(summary__icontains=keyword))
    return _page(queryset, offset, limit, activity_summary)


def get_activity(activity_id):
    activity = Activity.objects.filter(pk=activity_id, published=True).first()
    if not activity:
        raise ServiceError(404, "NOT_FOUND", "这条活动不存在或已下架")
    return {
        **activity_summary(activity),
        "content": activity.content,
        "article_url": activity.article_url or None,
    }


def merchant_summary(merchant):
    return {
        "id": merchant.pk,
        "name": merchant.name,
        "logo_url": merchant.logo_url,
        "category": {"id": merchant.category_id, "name": merchant.category.name},
        "area": {"id": merchant.area_id, "name": merchant.area.name},
        "discount_summary": merchant.discount_summary,
        "is_example": merchant.is_example,
    }


def merchant_filters():
    return {
        "categories": list(Category.objects.values("id", "name")),
        "areas": list(Area.objects.values("id", "name")),
    }


def _coordinates(query):
    latitude, longitude = query.get("latitude"), query.get("longitude")
    if latitude is None and longitude is None:
        if query.get("sort") == "distance":
            raise _invalid("附近排序需要当前位置")
        return None
    pattern = r"[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?"
    if any(
        not isinstance(value, str) or len(value) > 64 or not re.fullmatch(pattern, value.strip())
        for value in [latitude, longitude]
    ):
        raise _invalid("请同时提供有效的经纬度")
    lat, lon = float(latitude), float(longitude)
    if (
        not math.isfinite(lat)
        or not math.isfinite(lon)
        or not -90 <= lat <= 90
        or not -180 <= lon <= 180
    ):
        raise _invalid("经纬度超出有效范围")
    return lat, lon


def straight_line_distance(origin, destination):
    latitude, longitude = origin
    target_latitude, target_longitude = destination
    lat_difference = math.radians(target_latitude - latitude)
    lon_difference = math.radians(target_longitude - longitude)
    a = (
        math.sin(lat_difference / 2) ** 2
        + math.cos(math.radians(latitude))
        * math.cos(math.radians(target_latitude))
        * math.sin(lon_difference / 2) ** 2
    )
    return 2 * EARTH_RADIUS_METRES * math.asin(math.sqrt(max(0, min(1, a))))


def list_merchants(query):
    _query(query, {"category", "area", "q", "cursor", "limit", "latitude", "longitude", "sort"})
    offset, limit = _pagination(query)
    if "sort" in query and query["sort"] != "distance":
        raise _invalid("不支持的商家排序方式")
    origin = _coordinates(query)
    queryset = Merchant.objects.filter(published=True).select_related("category", "area")
    for field in ["category", "area"]:
        if field in query:
            identifier = _integer(query[field], "商家筛选条件", minimum=1)
            queryset = queryset.filter(**{f"{field}_id": identifier})
    keyword = _keyword(query)
    if keyword:
        queryset = queryset.filter(name__icontains=keyword)

    def located_summary(merchant):
        return {
            **merchant_summary(merchant),
            "latitude": merchant.latitude,
            "longitude": merchant.longitude,
            "distance_m": straight_line_distance(origin, (merchant.latitude, merchant.longitude))
            if origin
            else None,
        }

    if query.get("sort") == "distance":
        # Sort every match before paginating; sorting a single page can hide closer merchants.
        rows = [located_summary(merchant) for merchant in queryset]
        rows.sort(key=lambda row: (row["distance_m"], row["id"]))
        return _page(rows, offset, limit, lambda row: row)
    return _page(queryset, offset, limit, located_summary)


def get_merchant(merchant_id):
    merchant = (
        Merchant.objects.filter(pk=merchant_id, published=True)
        .select_related("category", "area")
        .first()
    )
    if not merchant:
        raise ServiceError(404, "NOT_FOUND", "商家不存在或已下架")
    return {
        **merchant_summary(merchant),
        "intro": merchant.intro,
        "discount_terms": merchant.discount_terms,
        "image_urls": merchant.image_urls,
        "address": merchant.address,
        "latitude": merchant.latitude,
        "longitude": merchant.longitude,
        "phone": merchant.phone,
        "opening_hours": merchant.opening_hours,
    }


def home_content():
    published_merchants = Merchant.objects.filter(published=True)
    valid_target = Q(link_type="none") | Q(
        link_type="merchant", link_id__in=published_merchants.values("pk")
    )
    try:
        post_model = apps.get_model("forum", "Post")
    except LookupError:
        pass
    else:
        public_posts = post_model.objects.filter(
            status="approved", deleted=False, board__is_active=True
        )
        valid_target |= Q(link_type="post", link_id__in=public_posts.values("pk"))
    banners = Banner.objects.filter(published=True).filter(valid_target)
    return {
        "banners": list(banners.values("id", "title", "image_url", "link_type", "link_id")),
        "featured_merchants": [
            merchant_summary(merchant)
            for merchant in published_merchants.filter(featured=True).select_related(
                "category", "area"
            )
        ],
    }


def support_content():
    support = SupportSettings.objects.filter(pk=1).first()
    return {
        "handbook": list(
            HandbookSection.objects.filter(published=True).values("id", "title", "content")
        ),
        "website_url": support.website_url or None if support else None,
        "assistant_wechat": support.assistant_wechat or None if support else None,
    }


def submit_feedback(user, category, content, contact="", *, request=None):
    if not user or not user.is_authenticated:
        raise ServiceError(401, "UNAUTHORIZED", "请先登录再提交反馈")
    if not all(isinstance(value, str) for value in [category, content, contact]):
        raise _invalid("反馈字段格式不正确")
    candidate = Feedback(
        user=user, category=category, content=content.strip(), contact=contact.strip()
    )
    try:
        candidate.full_clean()
    except ValidationError as exc:
        raise _invalid("；".join(exc.messages)) from None
    with transaction.atomic():
        active_user = User.objects.select_for_update().filter(pk=user.pk, is_active=True).first()
        if active_user is None:
            raise ServiceError(401, "UNAUTHORIZED", "账号已失效，请重新登录")
        now = timezone.now()
        recent = Feedback.objects.filter(user=active_user, created_at__gte=now - FEEDBACK_WINDOW)
        duplicate = recent.filter(
            category=candidate.category, content=candidate.content, contact=candidate.contact
        ).first()
        if duplicate:
            return duplicate
        latest = recent.first()
        if latest and now - latest.created_at < FEEDBACK_COOLDOWN:
            raise ServiceError(429, "RATE_LIMITED", "请等待 60 秒后再提交新的反馈")
        if recent.count() >= FEEDBACK_DAILY_LIMIT:
            raise ServiceError(429, "RATE_LIMITED", "24 小时内反馈次数已达上限，请稍后再试")
        wechat_safety.check_text(
            active_user, f"{candidate.content}\n{candidate.contact}".strip(), 2, request=request
        )
        candidate.save()
        AuditLog.objects.create(
            actor=active_user,
            action="feedback.create",
            target_type="feedback",
            target_id=candidate.pk,
            details={"category": candidate.category},
        )
        return candidate
