from django.contrib import messages
from django.core.paginator import Paginator
from django.shortcuts import redirect, render
from django.urls import reverse
from django.views.decorators.http import require_GET, require_POST

from apps.core.errors import ServiceError
from apps.forum.models import Comment, Post, Report
from apps.forum.services import (
    moderate_comment,
    moderate_post,
    resolve_report,
    set_post_pinned,
)

from .forms import ForumReviewForm, PinPostForm, ReportResolveForm
from .views import context, portal_required


def forum_url(kind, status):
    return f"{reverse('portal:forum')}?kind={kind}&status={status}"


@portal_required("content.manage")
@require_GET
def forum_index(request):
    kind = request.GET.get("kind", "posts")
    if kind not in {"posts", "comments", "reports"}:
        kind = "posts"
    if kind == "reports":
        allowed_statuses = {"new", "resolved"}
        status = request.GET.get("status", "new")
        records = Report.objects.select_related("user")
    else:
        allowed_statuses = {"pending", "approved", "rejected"}
        status = request.GET.get("status", "pending")
        records = (
            Post.objects.select_related("author", "board", "reviewer")
            if kind == "posts"
            else Comment.objects.select_related("author", "post", "reviewer")
        ).filter(deleted=False)
    if status not in allowed_statuses:
        status = "new" if kind == "reports" else "pending"
    focus_id = request.GET.get("item", "")
    if focus_id.isascii() and focus_id.isdecimal() and 0 < len(focus_id) <= 15:
        records = records.filter(pk=int(focus_id))
    else:
        focus_id = ""
    page = Paginator(records.filter(status=status).order_by("-created_at", "-pk"), 20).get_page(
        request.GET.get("page")
    )
    entries = [{"record": record} for record in page]
    if kind == "reports":
        targets = {}
        for target_type, model in (("post", Post), ("comment", Comment)):
            ids = [
                entry["record"].target_id
                for entry in entries
                if entry["record"].target_type == target_type
            ]
            targets.update(
                {(target_type, item.pk): item for item in model.objects.filter(pk__in=ids)}
            )
        for entry in entries:
            report = entry["record"]
            target = targets.get((report.target_type, report.target_id))
            entry["target_preview"] = (
                target.content[:600] if target and not target.deleted else "目标内容已移除。"
            )
            entry["target_title"] = getattr(target, "title", "")
            if target and not target.deleted:
                target_kind = "posts" if report.target_type == "post" else "comments"
                entry["target_url"] = forum_url(target_kind, target.status) + f"&item={target.pk}"
    return render(
        request,
        "portal/forum.html",
        context(
            request,
            entries=entries,
            page=page,
            kind=kind,
            status=status,
            focus_id=focus_id,
        ),
    )


@portal_required("content.manage")
@require_POST
def forum_review(request, kind, record_id):
    if kind not in {"posts", "comments"}:
        from django.http import Http404

        raise Http404
    form = ForumReviewForm(request.POST)
    if not form.is_valid():
        messages.error(request, "请选择批准或拒绝，备注最多 1000 字。")
    else:
        action = moderate_post if kind == "posts" else moderate_comment
        try:
            action(
                request.user, record_id, form.cleaned_data["decision"], form.cleaned_data["note"]
            )
        except ServiceError as exc:
            messages.error(request, exc.message)
        else:
            messages.success(
                request, "审核结果已保存。批准的内容可以公开展示，拒绝的内容不会公开。"
            )
    return redirect(forum_url(kind, "pending"))


@portal_required("content.manage")
@require_POST
def forum_pin(request, record_id):
    form = PinPostForm(request.POST)
    if not form.is_valid():
        messages.error(request, "请明确选择置顶或取消置顶。")
    else:
        try:
            set_post_pinned(request.user, record_id, form.cleaned_data["pinned"] == "true")
        except ServiceError as exc:
            messages.error(request, exc.message)
        else:
            messages.success(request, "帖子置顶状态已更新。")
    return redirect(forum_url("posts", "approved"))


@portal_required("content.manage")
@require_POST
def forum_resolve_report(request, record_id):
    form = ReportResolveForm(request.POST)
    if not form.is_valid():
        messages.error(request, "处理备注最多 1000 字。")
    else:
        try:
            resolve_report(request.user, record_id, form.cleaned_data["note"])
        except ServiceError as exc:
            messages.error(request, exc.message)
        else:
            messages.success(
                request, "举报已标记为已处理。该操作不会自动改变被举报内容的审核状态。"
            )
    return redirect(forum_url("reports", "new"))
