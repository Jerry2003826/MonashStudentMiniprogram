from dataclasses import dataclass

from django.contrib import messages
from django.core.exceptions import ValidationError
from django.core.paginator import Paginator
from django.db import IntegrityError, transaction
from django.http import Http404, HttpResponseBadRequest
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_GET, require_http_methods, require_POST

from apps.content.forms import (
    ActivityForm,
    AreaForm,
    BannerForm,
    CategoryForm,
    FeedbackResolveForm,
    HandbookSectionForm,
    MerchantForm,
    SupportSettingsForm,
)
from apps.content.models import Feedback
from apps.core.models import AuditLog

from .views import context, portal_required


@dataclass(frozen=True)
class Resource:
    key: str
    title: str
    description: str
    form: type
    label_field: str
    publishable: bool = False
    singleton: bool = False

    @property
    def model(self):
        return self.form._meta.model


RESOURCES = {
    item.key: item
    for item in [
        Resource(
            "activities",
            "活动与资讯",
            "维护最新活动、校园资讯与往期回顾。",
            ActivityForm,
            "title",
            True,
        ),
        Resource(
            "merchants",
            "优惠商家",
            "维护商家资料、位置、折扣与上架状态。",
            MerchantForm,
            "name",
            True,
        ),
        Resource(
            "categories",
            "商家分类",
            "维护商家分类名称。保存后用作商家筛选项。",
            CategoryForm,
            "name",
        ),
        Resource("areas", "商家地区", "维护区域名称。保存后用作商家筛选项。", AreaForm, "name"),
        Resource(
            "banners", "首页轮播", "管理首页图片、跳转目标和显示顺序。", BannerForm, "title", True
        ),
        Resource(
            "handbook",
            "新生手册",
            "维护新生手册章节与显示顺序。",
            HandbookSectionForm,
            "title",
            True,
        ),
        Resource(
            "contact",
            "联系设置",
            "维护官网与小助手微信号。保存后立即生效。",
            SupportSettingsForm,
            "",
            singleton=True,
        ),
    ]
}


def resource_for(key):
    if key not in RESOURCES:
        raise Http404
    return RESOURCES[key]


def label_for(resource, record):
    return getattr(record, resource.label_field) if resource.label_field else "官方联系方式"


def add_validation_error(form, error):
    if hasattr(error, "message_dict"):
        for name, errors in error.message_dict.items():
            form.add_error(name if name in form.fields else None, errors)
    else:
        form.add_error(None, error)


def save_form(request, form, action, target_type):
    try:
        with transaction.atomic():
            record = form.save()
            AuditLog.objects.create(
                actor=request.user,
                action=action,
                target_type=target_type,
                target_id=record.pk,
                details={"fields": form.changed_data},
            )
        return record
    except ValidationError as error:
        add_validation_error(form, error)
    except IntegrityError:
        form.add_error(None, "保存失败，可能已有同名记录或数据已发生变化。请检查后重试。")
    return None


@portal_required("content.manage")
@require_GET
def content_index(request):
    resources = [
        {"resource": resource, "count": resource.model.objects.count()}
        for resource in RESOURCES.values()
    ]
    return render(request, "portal/content_index.html", context(request, resources=resources))


@portal_required("content.manage")
@require_GET
def content_list(request, resource_key):
    resource = resource_for(resource_key)
    if resource.singleton:
        record = resource.model.objects.first()
        if record:
            return redirect("portal:content_edit", resource_key=resource.key, record_id=record.pk)
        return redirect("portal:content_new", resource_key=resource.key)
    records = resource.model.objects.all()
    query = request.GET.get("q", "").strip()[:100]
    if query:
        records = records.filter(**{f"{resource.label_field}__icontains": query})
    status = request.GET.get("status", "all")
    if resource.publishable and status in {"published", "draft"}:
        records = records.filter(published=status == "published")
    else:
        status = "all"
    page = Paginator(records.order_by("-pk"), 20).get_page(request.GET.get("page"))
    entries = [{"record": record, "label": label_for(resource, record)} for record in page]
    return render(
        request,
        "portal/content_list.html",
        context(
            request,
            resource=resource,
            entries=entries,
            page=page,
            query=query,
            status=status,
        ),
    )


@portal_required("content.manage")
@require_http_methods(["GET", "POST"])
def content_edit(request, resource_key, record_id=None):
    resource = resource_for(resource_key)
    if resource.singleton and record_id is None:
        existing = resource.model.objects.first()
        if existing:
            return redirect("portal:content_edit", resource_key=resource.key, record_id=existing.pk)
    record = get_object_or_404(resource.model, pk=record_id) if record_id is not None else None
    form = resource.form(request.POST if request.method == "POST" else None, instance=record)
    if request.method == "POST" and form.is_valid():
        saved = save_form(
            request,
            form,
            "content.update" if record else "content.create",
            f"content.{resource.key}",
        )
        if saved:
            messages.success(
                request,
                "内容已保存。"
                + (
                    "当前已发布。"
                    if resource.publishable and saved.published
                    else "当前为草稿或已下架。"
                    if resource.publishable
                    else ""
                ),
            )
            return redirect("portal:content_edit", resource_key=resource.key, record_id=saved.pk)
    return render(
        request,
        "portal/content_form.html",
        context(
            request,
            resource=resource,
            record=record,
            form=form,
        ),
        status=422 if request.method == "POST" and form.errors else 200,
    )


@portal_required("content.manage")
@require_POST
def content_publish(request, resource_key, record_id):
    resource = resource_for(resource_key)
    if not resource.publishable:
        raise Http404
    published = request.POST.get("published")
    if published not in {"true", "false"}:
        return HttpResponseBadRequest("请明确选择发布或下架。")
    try:
        with transaction.atomic():
            record = get_object_or_404(resource.model.objects.select_for_update(), pk=record_id)
            record.published = published == "true"
            record.save()
            AuditLog.objects.create(
                actor=request.user,
                action="content.publish",
                target_type=f"content.{resource.key}",
                target_id=record.pk,
                details={"published": record.published},
            )
    except ValidationError as error:
        messages.error(request, "无法修改发布状态：" + "；".join(error.messages))
    except IntegrityError:
        messages.error(request, "数据已发生变化，请刷新后重试。")
    else:
        messages.success(
            request, "内容已发布。" if record.published else "内容已下架，原始记录保留。"
        )
    return redirect("portal:content_list", resource_key=resource.key)


@portal_required("content.manage")
@require_GET
def feedback_list(request):
    status = request.GET.get("status", "new")
    if status not in {"new", "resolved"}:
        status = "new"
    records = (
        Feedback.objects.select_related("user").filter(status=status).order_by("-created_at", "-pk")
    )
    page = Paginator(records, 20).get_page(request.GET.get("page"))
    return render(request, "portal/feedback.html", context(request, page=page, status=status))


@portal_required("content.manage")
@require_http_methods(["GET", "POST"])
def feedback_edit(request, record_id):
    record = get_object_or_404(Feedback.objects.select_related("user"), pk=record_id)
    form = FeedbackResolveForm(request.POST if request.method == "POST" else None, instance=record)
    if request.method == "POST" and form.is_valid():
        saved = save_form(request, form, "feedback.resolve", "feedback")
        if saved:
            messages.success(request, "反馈处理状态与备注已保存。")
            return redirect("portal:feedback")
    return render(
        request,
        "portal/feedback_form.html",
        context(request, record=record, form=form),
        status=422 if request.method == "POST" and form.errors else 200,
    )
