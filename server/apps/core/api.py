import logging

from django.conf import settings
from django.http import Http404, JsonResponse
from ninja import NinjaAPI
from ninja.errors import AuthenticationError, ValidationError
from ninja.security import HttpBearer

from . import services
from .errors import ServiceError
from .membership_config import allowed_email_domains
from .models import Application
from .permissions import require_staff
from .schemas import (
    ApplicationInput,
    CreateStaffInput,
    DevLoginInput,
    EmailCodeInput,
    LoginOutput,
    MembershipConfigOutput,
    MeOutput,
    ProfileInput,
    ReviewInput,
    StaffOutput,
    UpdateStaffInput,
    WechatLoginInput,
)

logger = logging.getLogger(__name__)


class BearerAuth(HttpBearer):
    def authenticate(self, request, token):
        return services.authenticate_token(token)


api = NinjaAPI(
    title="学生会会员、内容与管理 API",
    version="1.0.0",
    auth=BearerAuth(),
    docs_url="/docs" if settings.DEBUG else None,
    openapi_url="/openapi.json" if settings.DEBUG else None,
)


@api.exception_handler(ServiceError)
def service_error(request, exc):
    return api.create_response(
        request, {"code": exc.code, "message": exc.message}, status=exc.status
    )


@api.exception_handler(AuthenticationError)
def authentication_error(request, exc):
    return api.create_response(
        request, {"code": "UNAUTHORIZED", "message": "登录已失效，请重新登录"}, status=401
    )


@api.exception_handler(ValidationError)
def validation_error(request, exc):
    # Do not echo request input, verification codes or unknown privileged fields.
    return api.create_response(
        request, {"code": "VALIDATION_ERROR", "message": "请求字段或格式不正确"}, status=422
    )


@api.exception_handler(Http404)
def not_found(request, exc):
    return api.create_response(
        request, {"code": "NOT_FOUND", "message": "接口或内容不存在"}, status=404
    )


@api.exception_handler(Exception)
def internal_error(request, exc):
    logger.error("Core API request failed (%s)", type(exc).__name__)
    return api.create_response(
        request, {"code": "INTERNAL_ERROR", "message": "服务暂时不可用，请稍后重试"}, status=500
    )


def healthz(request):
    return JsonResponse({"status": "ok"})


@api.get("/health", auth=None)
def health(request):
    return {"status": "ok"}


def _login(code):
    user = services.exchange_wechat_code(code)
    return {"token": services.issue_token(user), "me": services.build_me(user)}


@api.post("/auth/wechat-login", auth=None, response=LoginOutput)
def wechat_login(request, body: WechatLoginInput):
    return _login(body.code)


@api.post("/auth/wechat", auth=None, response=LoginOutput)
def wechat_login_alias(request, body: WechatLoginInput):
    return _login(body.code)


@api.post("/auth/dev-login", auth=None, response=LoginOutput)
def dev_login(request, body: DevLoginInput):
    user = services.dev_login_user(request, body.username)
    return {"token": services.issue_token(user), "me": services.build_me(user)}


@api.get("/me", response=MeOutput)
def me(request):
    return services.build_me(request.auth)


@api.patch("/me", response=MeOutput)
def update_profile(request, body: ProfileInput):
    user = services.update_nickname(request.auth, body.nickname, request=request)
    return services.build_me(user)


@api.put("/me", response=MeOutput)
def update_profile_compat(request, body: ProfileInput):
    user = services.update_nickname(request.auth, body.nickname, request=request)
    return services.build_me(user)


@api.get("/membership/config", auth=None, response=MembershipConfigOutput)
def membership_config(request):
    return {"allowed_email_domains": allowed_email_domains()}


@api.post("/membership/email-code")
def email_code(request, body: EmailCodeInput):
    services.send_email_code(request.auth, body.email)
    return {"sent": True}


@api.post("/membership/applications", response=MeOutput)
def membership_application(request, body: ApplicationInput):
    services.submit_application(request.auth, body.email, body.code)
    return services.build_me(request.auth)


@api.post("/membership/verify", response=MeOutput)
def verify_email_compat(request, body: ApplicationInput):
    # Compatibility never restores the retired auto-membership flow.
    services.submit_application(request.auth, body.email, body.code)
    return services.build_me(request.auth)


@api.get("/membership/card", response=MeOutput)
def membership_card(request):
    services.require_active_member(request.auth)
    return services.build_me(request.auth)


@api.get("/staff/applications")
def applications(request, status: str = "pending", cursor: int = 0, limit: int = 50):
    require_staff(request.auth, "membership.review")
    if (
        status not in {"pending", "approved", "rejected", "all"}
        or cursor < 0
        or not 1 <= limit <= 100
    ):
        raise ServiceError(422, "VALIDATION_ERROR", "筛选或分页参数无效")
    query = Application.objects.select_related("user").all()
    if status != "all":
        query = query.filter(status=status)
    rows = list(query[cursor : cursor + limit + 1])
    return {
        "items": [
            {
                **services.application_data(row),
                "user_id": row.user_id,
                "nickname": row.user.nickname,
                "reviewer_id": row.reviewer_id,
            }
            for row in rows[:limit]
        ],
        "next_cursor": str(cursor + limit) if len(rows) > limit else None,
    }


@api.post("/staff/applications/{application_id}/review")
def review(request, application_id: int, body: ReviewInput):
    result = services.review_application(request.auth, application_id, body.decision, body.note)
    return services.application_data(result)


@api.get("/staff/accounts")
def staff_accounts(request):
    return {
        "items": [
            services.staff_account_data(account)
            for account in services.list_staff_accounts(request.auth)
        ]
    }


@api.post("/staff/accounts", response=StaffOutput)
def create_account(request, body: CreateStaffInput):
    account = services.create_staff_account(request.auth, body.user_id, body.role)
    return services.staff_account_data(account)


@api.patch("/staff/accounts/{account_id}", response=StaffOutput)
def update_account(request, account_id: int, body: UpdateStaffInput):
    if not body.model_fields_set or any(
        getattr(body, field) is None for field in body.model_fields_set
    ):
        raise ServiceError(422, "VALIDATION_ERROR", "请提供明确的角色或启用状态")
    account = services.update_staff_account(request.auth, account_id, body.role, body.is_active)
    return services.staff_account_data(account)
