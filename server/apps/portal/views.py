from functools import wraps

from django.contrib import messages
from django.contrib.auth import login, logout
from django.http import JsonResponse
from django.shortcuts import redirect, render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST

from apps.core.errors import ServiceError
from apps.core.models import Application
from apps.core.permissions import require_staff
from apps.core.services import (
    create_staff_account,
    dev_login_user,
    is_dev_login_request,
    list_staff_accounts,
    review_application,
    update_staff_account,
)

from .forms import ReviewForm, StaffCreateForm, StaffEditForm
from .pairing import CHALLENGE_SESSION_KEY, browser_challenge, consume_challenge, create_challenge


def portal_required(capability="portal.access"):
    def decorator(view):
        @wraps(view)
        @never_cache
        @csrf_protect
        def protected(request, *args, **kwargs):
            if not request.user.is_authenticated:
                if request.session.get("_auth_user_id"):
                    logout(request)
                return redirect("portal:login")
            try:
                staff = require_staff(request.user, "portal.access")
            except ServiceError:
                logout(request)
                return render(request, "portal/denied.html", status=403)
            try:
                if capability != "portal.access":
                    require_staff(request.user, capability)
            except ServiceError:
                return render(request, "portal/denied.html", {"staff": staff}, status=403)
            request.portal_staff = staff
            return view(request, *args, **kwargs)

        return protected

    return decorator


def context(request, **values):
    return {"staff": getattr(request, "portal_staff", None), **values}


@never_cache
@ensure_csrf_cookie
@require_GET
def login_page(request):
    if request.user.is_authenticated:
        try:
            require_staff(request.user, "portal.access")
            return redirect("portal:index")
        except ServiceError:
            logout(request)
    challenge = browser_challenge(request)
    pairing = request.session.get(CHALLENGE_SESSION_KEY, {})
    return render(
        request,
        "portal/login.html",
        {
            "pairing_code": pairing.get("code") if challenge else None,
            "pairing_remaining": max(
                0, int((challenge.expires_at - timezone.now()).total_seconds())
            )
            if challenge
            else 0,
            "dev_login_enabled": is_dev_login_request(request),
        },
    )


@never_cache
@csrf_protect
@require_POST
def begin_pairing(request):
    if request.user.is_authenticated:
        return redirect("portal:index")
    try:
        create_challenge(request)
    except ServiceError as exc:
        messages.error(request, exc.message)
    return redirect("portal:login")


@never_cache
@csrf_protect
@require_POST
def poll_pairing(request):
    try:
        user = consume_challenge(request)
    except ServiceError as exc:
        return JsonResponse({"code": exc.code, "message": exc.message}, status=exc.status)
    if user is None:
        return JsonResponse({"state": "pending"})
    # Django login cycles an anonymous session key and rotates its CSRF token.
    login(request, user, backend="django.contrib.auth.backends.ModelBackend")
    request.session.set_expiry(8 * 60 * 60)
    return JsonResponse({"state": "authenticated", "redirect": reverse("portal:index")})


@never_cache
@csrf_protect
@require_POST
def dev_login(request):
    try:
        user = dev_login_user(request, request.POST.get("username"))
        require_staff(user, "portal.access")
    except ServiceError as exc:
        return render(request, "portal/denied.html", status=exc.status)
    login(request, user, backend="django.contrib.auth.backends.ModelBackend")
    request.session.set_expiry(8 * 60 * 60)
    messages.info(request, "当前为本地演示登录，不代表生产微信认证。")
    return redirect("portal:index")


@portal_required()
@require_POST
def logout_view(request):
    logout(request)
    return redirect("portal:login")


@portal_required()
@require_GET
def index(request):
    return render(request, "portal/index.html", context(request))


@portal_required("membership.review")
@require_GET
def applications(request):
    status = request.GET.get("status", "pending")
    if status not in ("pending", "approved", "rejected"):
        status = "pending"
    applications = (
        Application.objects.filter(status=status)
        .select_related("user", "reviewer")
        .order_by("-submitted_at")[:100]
    )
    return render(
        request,
        "portal/applications.html",
        context(request, applications=applications, status=status),
    )


@portal_required("membership.review")
@require_POST
def review(request, application_id):
    form = ReviewForm(request.POST)
    if not form.is_valid():
        messages.error(request, "必须明确选择批准或拒绝，备注最多 1000 字。")
        return redirect("portal:applications")
    try:
        review_application(
            request.user, application_id, form.cleaned_data["decision"], form.cleaned_data["note"]
        )
    except ServiceError as exc:
        messages.error(request, exc.message)
    else:
        messages.success(
            request,
            "已批准会员申请。"
            if form.cleaned_data["decision"] == "approved"
            else "已拒绝会员申请。",
        )
    return redirect("portal:applications")


@portal_required("accounts.manage")
@require_GET
def accounts(request):
    return render(
        request,
        "portal/accounts.html",
        context(
            request,
            accounts=list_staff_accounts(request.user),
            create_form=StaffCreateForm(initial={"role": "reviewer"}),
        ),
    )


@portal_required("accounts.manage")
@require_POST
def account_create(request):
    form = StaffCreateForm(request.POST)
    if not form.is_valid():
        messages.error(request, "请输入有效的微信用户编号并选择角色。")
        return redirect("portal:accounts")
    try:
        create_staff_account(request.user, form.cleaned_data["user_id"], form.cleaned_data["role"])
    except ServiceError as exc:
        messages.error(request, exc.message)
    else:
        messages.success(request, "管理员账号已创建。对方仍需使用自己的微信确认登录。")
    return redirect("portal:accounts")


@portal_required("accounts.manage")
@require_POST
def account_update(request, account_id):
    form = StaffEditForm(request.POST)
    if not form.is_valid():
        messages.error(request, "请选择有效角色。")
        return redirect("portal:accounts")
    try:
        update_staff_account(
            request.user,
            account_id,
            role=form.cleaned_data["role"],
            is_active=form.cleaned_data["is_active"],
        )
    except ServiceError as exc:
        messages.error(request, exc.message)
    else:
        messages.success(request, "账号权限已更新，下次请求立即生效。")
    return redirect("portal:accounts")
