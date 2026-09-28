from django import forms
from django.db import models

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
from .validators import validate_image_urls


def https_formfield(db_field, **kwargs):
    if isinstance(db_field, models.URLField):
        kwargs.setdefault("assume_scheme", "https")
    return db_field.formfield(**kwargs)


class ActivityForm(forms.ModelForm):
    class Meta:
        model = Activity
        formfield_callback = https_formfield
        fields = [
            "title",
            "summary",
            "category",
            "starts_at",
            "location",
            "content",
            "article_url",
            "published",
            "is_example",
        ]
        help_texts = {"starts_at": "墨尔本当地时间（包含夏令时）。"}
        widgets = {
            "starts_at": forms.DateTimeInput(
                attrs={"type": "datetime-local"}, format="%Y-%m-%dT%H:%M"
            )
        }


class CategoryForm(forms.ModelForm):
    class Meta:
        model = Category
        fields = ["name"]


class AreaForm(forms.ModelForm):
    class Meta:
        model = Area
        fields = ["name"]


class MerchantForm(forms.ModelForm):
    image_urls = forms.CharField(
        label="商家图片网址",
        required=False,
        widget=forms.Textarea(attrs={"rows": 5}),
        help_text="每行一个 HTTPS 图片网址，最多 9 张。没有图片可留空。",
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if not self.is_bound:
            self.initial["image_urls"] = "\n".join(self.instance.image_urls or [])

    def clean_image_urls(self):
        urls = [
            value.strip() for value in self.cleaned_data["image_urls"].splitlines() if value.strip()
        ]
        validate_image_urls(urls)
        return urls

    class Meta:
        model = Merchant
        formfield_callback = https_formfield
        fields = [
            "name",
            "logo_url",
            "category",
            "area",
            "discount_summary",
            "intro",
            "discount_terms",
            "image_urls",
            "address",
            "latitude",
            "longitude",
            "phone",
            "opening_hours",
            "published",
            "featured",
            "is_example",
        ]
        help_texts = {
            "latitude": "十进制纬度，范围 -90 至 90。",
            "longitude": "十进制经度，范围 -180 至 180。",
        }


class BannerForm(forms.ModelForm):
    class Meta:
        model = Banner
        formfield_callback = https_formfield
        fields = ["title", "image_url", "link_type", "link_id", "published", "sort_order"]


class HandbookSectionForm(forms.ModelForm):
    class Meta:
        model = HandbookSection
        fields = ["title", "content", "published", "sort_order"]


class SupportSettingsForm(forms.ModelForm):
    class Meta:
        model = SupportSettings
        formfield_callback = https_formfield
        fields = ["website_url", "assistant_wechat"]


class FeedbackResolveForm(forms.ModelForm):
    class Meta:
        model = Feedback
        fields = ["status", "resolution_note"]
