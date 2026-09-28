from django.apps import apps
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxLengthValidator, MinLengthValidator, MinValueValidator
from django.db import models
from django.db.models import Q

from .validators import (
    validate_article_url,
    validate_https_url,
    validate_image_urls,
    validate_latitude,
    validate_longitude,
)


class ValidatedModel(models.Model):
    """Apply the same validation to ordinary ORM saves and portal ModelForms."""

    class Meta:
        abstract = True

    def clean_fields(self, exclude=None):
        # Normalize text before field and unique validation. Never turn JSON data into text.
        for field in self._meta.fields:
            if isinstance(field, (models.CharField, models.TextField)):
                value = getattr(self, field.name)
                if isinstance(value, str):
                    setattr(self, field.name, value.strip())
        super().clean_fields(exclude=exclude)

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)


class Activity(ValidatedModel):
    class Category(models.TextChoices):
        LATEST = "latest", "最新活动"
        NEWS = "news", "资讯信息"
        PAST = "past", "往期回顾"

    title = models.CharField("标题", max_length=160)
    summary = models.CharField("摘要", max_length=500)
    category = models.CharField("分类", max_length=12, choices=Category.choices)
    starts_at = models.DateTimeField("活动时间", null=True, blank=True)
    location = models.CharField("地点", max_length=250, blank=True)
    content = models.TextField("正文", validators=[MaxLengthValidator(20000)])
    article_url = models.URLField(
        "公众号原文", max_length=1000, blank=True, validators=[validate_article_url]
    )
    published = models.BooleanField("已发布", default=False)
    is_example = models.BooleanField("示例内容", default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-pk"]
        constraints = [
            models.CheckConstraint(
                condition=Q(category__in=["latest", "news", "past"]),
                name="content_activity_category_valid",
            )
        ]

    def __str__(self):
        return self.title


class Category(ValidatedModel):
    name = models.CharField("分类名称", max_length=80, unique=True)

    class Meta:
        ordering = ["pk"]

    def __str__(self):
        return self.name


class Area(ValidatedModel):
    name = models.CharField("区域名称", max_length=80, unique=True)

    class Meta:
        ordering = ["pk"]

    def __str__(self):
        return self.name


class Merchant(ValidatedModel):
    name = models.CharField("商家名称", max_length=160)
    logo_url = models.URLField(
        "Logo 网址", max_length=1000, blank=True, validators=[validate_https_url]
    )
    category = models.ForeignKey(
        Category, verbose_name="分类", on_delete=models.PROTECT, related_name="merchants"
    )
    area = models.ForeignKey(
        Area, verbose_name="区域", on_delete=models.PROTECT, related_name="merchants"
    )
    discount_summary = models.CharField("优惠摘要", max_length=300)
    intro = models.TextField("商家介绍", validators=[MaxLengthValidator(10000)])
    discount_terms = models.TextField("优惠使用条件", validators=[MaxLengthValidator(5000)])
    image_urls = models.JSONField(
        "图片网址列表", default=list, blank=True, validators=[validate_image_urls]
    )
    address = models.CharField("地址", max_length=500)
    latitude = models.FloatField("纬度", validators=[validate_latitude])
    longitude = models.FloatField("经度", validators=[validate_longitude])
    phone = models.CharField("联系电话", max_length=50, blank=True)
    opening_hours = models.CharField("营业时间", max_length=500, blank=True)
    published = models.BooleanField("已上架", default=False)
    featured = models.BooleanField("首页精选", default=False)
    is_example = models.BooleanField("示例商家", default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["pk"]
        constraints = [
            models.CheckConstraint(
                condition=Q(latitude__gte=-90, latitude__lte=90),
                name="content_merchant_latitude_valid",
            ),
            models.CheckConstraint(
                condition=Q(longitude__gte=-180, longitude__lte=180),
                name="content_merchant_longitude_valid",
            ),
        ]

    def __str__(self):
        return self.name

    def clean(self):
        super().clean()
        # JSONField(blank=True) skips field validators for {}; an empty object is not an image list.
        validate_image_urls(self.image_urls)


class Banner(ValidatedModel):
    class LinkType(models.TextChoices):
        NONE = "none", "不跳转"
        MERCHANT = "merchant", "商家"
        POST = "post", "论坛帖子"

    title = models.CharField("标题", max_length=160)
    image_url = models.URLField("图片网址", max_length=1000, validators=[validate_https_url])
    link_type = models.CharField(
        "跳转类型", max_length=12, choices=LinkType.choices, default=LinkType.NONE
    )
    link_id = models.PositiveBigIntegerField(
        "目标编号", null=True, blank=True, validators=[MinValueValidator(1)]
    )
    published = models.BooleanField("已发布", default=False)
    sort_order = models.PositiveIntegerField("排序", default=0)

    class Meta:
        ordering = ["sort_order", "pk"]
        constraints = [
            models.CheckConstraint(
                condition=Q(link_type__in=["none", "merchant", "post"]),
                name="content_banner_link_type_valid",
            )
        ]

    def clean(self):
        super().clean()
        if self.link_type == "none":
            if self.link_id is not None:
                raise ValidationError("不跳转的轮播图不能填写目标编号。")
        elif self.link_id is None:
            raise ValidationError("请选择有效的跳转目标编号。")
        elif self.link_type == "merchant":
            target = Merchant.objects.filter(pk=self.link_id)
            if not target.exists() or (
                self.published and not target.filter(published=True).exists()
            ):
                raise ValidationError("商家跳转目标不存在或尚未上架。")
        if self.published and self.link_type == "post":
            try:
                post_model = apps.get_model("forum", "Post")
            except LookupError:
                raise ValidationError("论坛暂不可用，请先保存为草稿。") from None
            if not post_model.objects.filter(
                pk=self.link_id, status="approved", deleted=False, board__is_active=True
            ).exists():
                raise ValidationError("帖子跳转目标不存在或尚未公开。")

    def __str__(self):
        return self.title


class HandbookSection(ValidatedModel):
    title = models.CharField("章节标题", max_length=160)
    content = models.TextField("章节正文", validators=[MaxLengthValidator(20000)])
    published = models.BooleanField("已发布", default=False)
    sort_order = models.PositiveIntegerField("排序", default=0)

    class Meta:
        ordering = ["sort_order", "pk"]

    def __str__(self):
        return self.title


class SupportSettings(ValidatedModel):
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    website_url = models.URLField(
        "官方网站", max_length=1000, blank=True, validators=[validate_https_url]
    )
    assistant_wechat = models.CharField("小助手微信号", max_length=100, blank=True)

    class Meta:
        constraints = [models.CheckConstraint(condition=Q(id=1), name="content_support_singleton")]

    def clean(self):
        super().clean()
        if self.pk != 1:
            raise ValidationError("官方联系方式仅允许一份配置。")

    def __str__(self):
        return "官方联系方式"


class Feedback(ValidatedModel):
    class Category(models.TextChoices):
        SUGGESTION = "suggestion", "功能建议"
        BUG = "bug", "使用问题"
        MERCHANT = "merchant", "商家信息"

    class Status(models.TextChoices):
        NEW = "new", "待处理"
        RESOLVED = "resolved", "已处理"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="feedback_entries"
    )
    category = models.CharField("反馈类型", max_length=12, choices=Category.choices)
    content = models.TextField(
        "反馈内容", validators=[MinLengthValidator(10), MaxLengthValidator(1000)]
    )
    contact = models.CharField("联系方式", max_length=100, blank=True)
    status = models.CharField("处理状态", max_length=12, choices=Status.choices, default=Status.NEW)
    resolution_note = models.TextField(
        "处理备注", blank=True, validators=[MaxLengthValidator(2000)]
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-pk"]
        constraints = [
            models.CheckConstraint(
                condition=Q(category__in=["suggestion", "bug", "merchant"]),
                name="content_feedback_category_valid",
            ),
            models.CheckConstraint(
                condition=Q(status__in=["new", "resolved"]), name="content_feedback_status_valid"
            ),
        ]

    def __str__(self):
        return f"反馈 #{self.pk or '新建'}"
