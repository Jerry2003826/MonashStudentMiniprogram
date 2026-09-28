import calendar
import hashlib
import logging
import secrets
from datetime import timedelta
from urllib.parse import urlsplit

import httpx
from django.conf import settings
from django.core.exceptions import DisallowedHost, ValidationError
from django.core.mail import send_mail
from django.core.validators import validate_email
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.crypto import constant_time_compare, salted_hmac
from django.views.decorators.debug import sensitive_variables

from . import wechat_safety
from .errors import ServiceError
from .models import (
    Application,
    AuditLog,
    AuthToken,
    EmailCode,
    EmailThrottle,
    Membership,
    StaffAccount,
    User,
)
from .permissions import require_staff

logger = logging.getLogger(__name__)
TOKEN_LIFETIME = timedelta(days=30)
CODE_LIFETIME = timedelta(minutes=10)
RENEWAL_WINDOW = timedelta(days=30)


def is_dev_login_request(request) -> bool:
    if not (settings.DEBUG and settings.ENABLE_DEV_LOGIN):
        return False
    if request.META.get("REMOTE_ADDR") not in {"127.0.0.1", "::1"}:
        return False
    try:
        host = urlsplit(f"http://{request.get_host()}").hostname
    except (DisallowedHost, ValueError):
        return False
    return host in {"localhost", "127.0.0.1", "::1"}


def dev_login_user(request, username: str) -> User:
    if not (settings.DEBUG and settings.ENABLE_DEV_LOGIN):
        raise ServiceError(404, "NOT_FOUND", "接口不存在")
    if not is_dev_login_request(request):
        raise ServiceError(403, "FORBIDDEN", "演示登录只允许本机请求和本机域名")
    if username not in {"demo-owner", "demo-reviewer", "demo-editor", "demo-student"}:
        raise ServiceError(422, "VALIDATION_ERROR", "请选择有效演示账号")
    user = User.objects.filter(username=username, openid=f"dev:{username}", is_active=True).first()
    if user is None:
        raise ServiceError(404, "NOT_FOUND", "演示账号尚未创建，请先运行 seed_demo")
    if user.has_usable_password():
        raise ServiceError(403, "FORBIDDEN", "演示账号配置异常")
    return user


def normalize_email(email: str) -> str:
    email = email.strip().lower()
    try:
        validate_email(email)
    except ValidationError as exc:
        raise ServiceError(422, "VALIDATION_ERROR", "邮箱格式不正确") from exc
    if email.rsplit("@", 1)[-1] not in settings.MEMBERSHIP_ALLOWED_EMAIL_DOMAINS:
        raise ServiceError(422, "EMAIL_DOMAIN_NOT_ALLOWED", "请使用允许的学生邮箱")
    return email


def membership_state(membership, now=None):
    now = now or timezone.now()
    if membership is None:
        return "none"
    if membership.revoked_at:
        return "revoked"
    return "active" if membership.expires_at > now else "expired"


def application_data(application):
    if application is None:
        return None
    return {
        "id": application.pk,
        "email": application.email,
        "status": application.status,
        "submitted_at": application.submitted_at.isoformat(),
        "reviewed_at": application.reviewed_at.isoformat() if application.reviewed_at else None,
        "review_note": application.review_note,
    }


def build_me(user):
    membership = Membership.objects.filter(user=user).first()
    application = Application.objects.filter(user=user).first()
    staff = StaffAccount.objects.filter(user=user, is_active=True, user__is_active=True).first()
    now = timezone.now()
    state = membership_state(membership, now)
    return {
        "id": user.pk,
        "nickname": user.nickname,
        "avatar_url": user.avatar_url or None,
        "banned_until": user.banned_until.isoformat() if user.banned_until else None,
        "staff_role": staff.role if staff else None,
        "membership": {
            "state": state,
            "member_no": f"{membership.pk:06d}" if membership else None,
            "email": membership.email if membership else None,
            "expires_at": membership.expires_at.isoformat() if membership else None,
            "renewable": bool(
                membership
                and not membership.revoked_at
                and membership.expires_at <= now + RENEWAL_WINDOW
            ),
            "application": application_data(application),
        },
    }


@transaction.atomic
def update_nickname(actor, nickname, *, request=None):
    if not isinstance(nickname, str) or not 1 <= len(nickname.strip()) <= 20:
        raise ServiceError(422, "VALIDATION_ERROR", "昵称需要 1–20 字")
    user = User.objects.select_for_update().filter(pk=actor.pk, is_active=True).first()
    if user is None:
        raise ServiceError(401, "UNAUTHORIZED", "登录已失效，请重新登录")
    nickname = nickname.strip()
    result = wechat_safety.check_text(user, nickname, 1, request=request, nickname=nickname)
    if result == "review":
        # Nicknames are immediately visible and currently have no manual queue.
        raise ServiceError(422, "CONTENT_RISKY", "该昵称需要进一步审核，请更换昵称；原昵称已保留")
    user.nickname = nickname
    user.save(update_fields=["nickname"])
    return user


@sensitive_variables("code", "response", "data")
def exchange_wechat_code(code: str) -> User:
    if not settings.WECHAT_APPID or not settings.WECHAT_APPSECRET:
        raise ServiceError(503, "INTERNAL_ERROR", "微信登录尚未配置，请联系管理员")
    try:
        response = httpx.get(
            "https://api.weixin.qq.com/sns/jscode2session",
            params={
                "appid": settings.WECHAT_APPID,
                "secret": settings.WECHAT_APPSECRET,
                "js_code": code,
                "grant_type": "authorization_code",
            },
            timeout=8.0,
            follow_redirects=False,
        )
        response.raise_for_status()
        data = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        # Never log the exception/URL: query parameters include the app secret and login code.
        logger.warning("WeChat login upstream failed (%s)", type(exc).__name__)
        raise ServiceError(503, "INTERNAL_ERROR", "微信登录服务暂时不可用，请重试") from None
    if not isinstance(data, dict) or data.get("errcode", 0) != 0:
        raise ServiceError(401, "UNAUTHORIZED", "微信登录凭据无效或已过期，请重新登录")
    openid = data.get("openid")
    if (
        not isinstance(openid, str)
        or not openid
        or len(openid) > 128
        or not isinstance(data.get("session_key"), str)
        or not data["session_key"]
    ):
        raise ServiceError(503, "INTERNAL_ERROR", "微信登录服务返回了无效数据")
    # Only identities returned by WeChat reach this lookup. Session keys are not stored or returned.
    username = "wx-" + hashlib.sha256(openid.encode()).hexdigest()[:40]
    try:
        with transaction.atomic():
            user = User.objects.filter(openid=openid).first()
            if user is None:
                user = User.objects.create_user(username=username, openid=openid, password=None)
    except IntegrityError:
        user = User.objects.get(openid=openid)
    if not user.is_active:
        raise ServiceError(403, "FORBIDDEN", "账号已停用")
    return user


@sensitive_variables("token")
def issue_token(user) -> str:
    if not User.objects.filter(pk=user.pk, is_active=True).exists():
        raise ServiceError(403, "FORBIDDEN", "账号已停用")
    token = secrets.token_urlsafe(32)
    AuthToken.objects.create(
        user=user,
        token_hash=hashlib.sha256(token.encode()).hexdigest(),
        expires_at=timezone.now() + TOKEN_LIFETIME,
    )
    return token


@sensitive_variables("raw")
def authenticate_token(raw: str):
    if not isinstance(raw, str) or not 20 <= len(raw) <= 256:
        return None
    token = (
        AuthToken.objects.select_related("user")
        .filter(
            token_hash=hashlib.sha256(raw.encode()).hexdigest(),
            expires_at__gt=timezone.now(),
            user__is_active=True,
        )
        .first()
    )
    return token.user if token else None


def _code_digest(user_id, email, code):
    return salted_hmac(
        "membership.email-code", f"{user_id}:{email}:{code}", algorithm="sha256"
    ).hexdigest()


def _lock_email(email):
    EmailThrottle.objects.get_or_create(email=email)
    return EmailThrottle.objects.select_for_update().get(email=email)


@sensitive_variables("code")
def send_email_code(user, email: str) -> None:
    email = normalize_email(email)
    if settings.EMAIL_BACKEND == "django.core.mail.backends.smtp.EmailBackend" and (
        not settings.EMAIL_HOST or not settings.DEFAULT_FROM_EMAIL
    ):
        raise ServiceError(503, "INTERNAL_ERROR", "验证码邮件服务尚未配置")
    with transaction.atomic():
        User.objects.select_for_update().get(pk=user.pk)
        _lock_email(email)
        now = timezone.now()
        recent = EmailCode.objects.filter(email=email).order_by("-created_at").first()
        if recent and now - recent.created_at < timedelta(seconds=60):
            raise ServiceError(429, "RATE_LIMITED", "验证码发送太频繁，请 60 秒后再试")
        since = now - timedelta(hours=24)
        if (
            EmailCode.objects.filter(email=email, created_at__gte=since).count() >= 10
            or EmailCode.objects.filter(user=user, created_at__gte=since).count() >= 10
        ):
            raise ServiceError(429, "RATE_LIMITED", "24 小时内验证码发送次数已达上限")
        code = f"{secrets.randbelow(1_000_000):06d}"
        # A newly sent code invalidates every previous outstanding code for this address.
        EmailCode.objects.filter(email=email, used_at__isnull=True).update(used_at=now)
        EmailCode.objects.create(
            user=user,
            email=email,
            code_hash=_code_digest(user.pk, email, code),
            expires_at=now + CODE_LIFETIME,
        )
        try:
            delivered = send_mail(
                "学生会会员申请验证码",
                f"你的验证码是 {code}，10 分钟内有效。验证邮箱后仍需等待管理员审核。"
                "如果不是你发起的申请，请忽略此邮件。",
                settings.DEFAULT_FROM_EMAIL,
                [email],
                fail_silently=False,
            )
            if delivered != 1:
                raise RuntimeError("mail_not_accepted")
        except Exception:
            logger.warning("Membership verification email delivery failed")
            raise ServiceError(503, "INTERNAL_ERROR", "验证码邮件发送失败，请稍后重试") from None


def _check_application_eligibility(user, email, now):
    memberships = list(Membership.objects.filter(Q(user=user) | Q(email=email)))
    for membership in memberships:
        if membership.revoked_at:
            raise ServiceError(409, "MEMBERSHIP_REVOKED", "会员资格已取消，请联系学生会")
        if membership.user_id != user.pk or membership.email != email:
            raise ServiceError(409, "ALREADY_MEMBER", "该邮箱或微信账号已绑定其他会员资格")
        if membership.expires_at > now + RENEWAL_WINDOW:
            raise ServiceError(409, "RENEWAL_NOT_OPEN", "到期前 30 天才能申请续期")
    if Application.objects.filter(Q(user=user) | Q(email=email), status="pending").exists():
        raise ServiceError(422, "VALIDATION_ERROR", "已有待审核的会员申请，请等待处理")


@sensitive_variables("code")
def submit_application(user, email: str, code: str) -> Application:
    email = normalize_email(email)
    failure = None
    result = None
    with transaction.atomic():
        User.objects.select_for_update().get(pk=user.pk)
        _lock_email(email)
        now = timezone.now()
        _check_application_eligibility(user, email, now)
        challenge = (
            EmailCode.objects.select_for_update()
            .filter(
                user=user,
                email=email,
                used_at__isnull=True,
            )
            .order_by("-created_at")
            .first()
        )
        if challenge is None or challenge.expires_at <= now or challenge.attempts >= 5:
            failure = ServiceError(422, "CODE_INVALID", "验证码错误、已过期或已作废")
        elif not constant_time_compare(challenge.code_hash, _code_digest(user.pk, email, code)):
            challenge.attempts += 1
            challenge.save(update_fields=["attempts"])
            failure = ServiceError(422, "CODE_INVALID", "验证码错误、已过期或已作废")
        else:
            challenge.used_at = now
            challenge.save(update_fields=["used_at"])
            result = Application.objects.create(user=user, email=email)
            AuditLog.objects.create(
                actor=user,
                action="membership.apply",
                target_type="application",
                target_id=result.pk,
            )
    # Raising after the atomic block preserves the invalid-attempt counter.
    if failure:
        raise failure
    return result


def add_calendar_year(value):
    next_year = value.year + 1
    day = min(value.day, calendar.monthrange(next_year, value.month)[1])
    return value.replace(year=next_year, day=day)


def review_application(actor, application_id: int, decision: str, note: str = "") -> Application:
    if decision not in {"approved", "rejected"} or len(note) > 1000:
        raise ServiceError(422, "VALIDATION_ERROR", "审核结果或备注无效")
    with transaction.atomic():
        require_staff(actor, "membership.review")
        application = Application.objects.select_for_update().filter(pk=application_id).first()
        if not application:
            raise ServiceError(404, "NOT_FOUND", "申请不存在")
        if application.user_id == actor.pk:
            raise ServiceError(403, "FORBIDDEN", "不能审核自己的会员申请")
        if application.status != "pending":
            raise ServiceError(422, "VALIDATION_ERROR", "申请已经处理，不能重复审核")
        User.objects.select_for_update().get(pk=application.user_id)
        _lock_email(application.email)
        now = timezone.now()
        if decision == "approved":
            existing = (
                Membership.objects.select_for_update().filter(user_id=application.user_id).first()
            )
            other = Membership.objects.filter(email=application.email).exclude(
                user_id=application.user_id
            )
            if other.exists() or (existing and existing.email != application.email):
                raise ServiceError(409, "ALREADY_MEMBER", "邮箱已属于其他会员，不能自动转移")
            if existing and existing.revoked_at:
                raise ServiceError(409, "MEMBERSHIP_REVOKED", "已取消的会员不能通过申请恢复")
            expires_at = add_calendar_year(max(existing.expires_at, now) if existing else now)
            if existing:
                existing.expires_at = expires_at
                existing.save(update_fields=["expires_at"])
            else:
                Membership.objects.create(
                    user_id=application.user_id,
                    email=application.email,
                    approved_at=now,
                    expires_at=expires_at,
                )
        changed = Application.objects.filter(pk=application.pk, status="pending").update(
            status=decision,
            reviewed_at=now,
            reviewer=actor,
            review_note=note.strip(),
        )
        if changed != 1:
            raise ServiceError(422, "VALIDATION_ERROR", "申请已经处理，不能重复审核")
        AuditLog.objects.create(
            actor=actor,
            action="membership.review",
            target_type="application",
            target_id=application.pk,
            details={"decision": decision},
        )
        application.refresh_from_db()
        return application


def require_active_member(user) -> Membership:
    membership = Membership.objects.filter(user=user).first()
    if membership_state(membership) != "active":
        raise ServiceError(403, "MEMBERSHIP_REQUIRED", "需要管理员批准且未过期的会员资格")
    return membership


def staff_account_data(account):
    return {
        "id": account.pk,
        "user_id": account.user_id,
        "nickname": account.user.nickname,
        "role": account.role,
        "is_active": account.is_active,
    }


def list_staff_accounts(actor):
    require_staff(actor, "accounts.manage")
    return StaffAccount.objects.select_related("user").order_by("pk")


def create_staff_account(actor, user_id: int, role: str) -> StaffAccount:
    with transaction.atomic():
        require_staff(actor, "accounts.manage")
        if role not in StaffAccount.Role.values:
            raise ServiceError(422, "VALIDATION_ERROR", "角色无效")
        user = User.objects.select_for_update().filter(pk=user_id, is_active=True).first()
        if user is None:
            raise ServiceError(404, "NOT_FOUND", "用户不存在或已停用；请先让用户完成微信登录")
        if StaffAccount.objects.filter(user=user).exists():
            raise ServiceError(422, "VALIDATION_ERROR", "该用户已有管理账号")
        account = StaffAccount.objects.create(user=user, role=role)
        AuditLog.objects.create(
            actor=actor,
            action="staff.create",
            target_type="staff_account",
            target_id=account.pk,
            details={"role": role},
        )
        return account


def update_staff_account(actor, account_id: int, role=None, is_active=None) -> StaffAccount:
    if role is not None and role not in StaffAccount.Role.values:
        raise ServiceError(422, "VALIDATION_ERROR", "角色无效")
    if is_active is not None and type(is_active) is not bool:
        raise ServiceError(422, "VALIDATION_ERROR", "启用状态无效")
    with transaction.atomic():
        # Serialize changes across existing owners so concurrent changes cannot remove all owners.
        list(StaffAccount.objects.select_for_update().filter(role="owner").order_by("pk"))
        require_staff(actor, "accounts.manage")
        account = (
            StaffAccount.objects.select_for_update()
            .select_related("user")
            .filter(pk=account_id)
            .first()
        )
        if account is None:
            raise ServiceError(404, "NOT_FOUND", "管理账号不存在")
        new_role = role if role is not None else account.role
        new_active = is_active if is_active is not None else account.is_active
        removing_owner = (
            account.role == "owner"
            and account.is_active
            and (new_role != "owner" or not new_active)
        )
        if (
            removing_owner
            and not StaffAccount.objects.filter(
                role="owner",
                is_active=True,
                user__is_active=True,
            )
            .exclude(pk=account.pk)
            .exists()
        ):
            raise ServiceError(422, "VALIDATION_ERROR", "不能停用或降级最后一位负责人")
        if account.user_id == actor.pk and (new_role != account.role or not new_active):
            raise ServiceError(403, "FORBIDDEN", "不能修改自己的角色或停用自己")
        before = {"role": account.role, "is_active": account.is_active}
        account.role = new_role
        account.is_active = new_active
        account.save(update_fields=["role", "is_active", "updated_at"])
        if not new_active:
            AuthToken.objects.filter(user_id=account.user_id).delete()
        AuditLog.objects.create(
            actor=actor,
            action="staff.update",
            target_type="staff_account",
            target_id=account.pk,
            details={"before": before, "after": {"role": new_role, "is_active": new_active}},
        )
        return account
