import re
import secrets
from datetime import timedelta

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone
from django.utils.crypto import constant_time_compare, salted_hmac

from apps.core.errors import ServiceError
from apps.core.permissions import require_staff

from .models import LoginChallenge, LoginRateLimit

CHALLENGE_TTL_SECONDS = 300
CHALLENGE_SESSION_KEY = "portal_pairing"


def digest(purpose, value):
    return salted_hmac(f"portal.{purpose}", value, algorithm="sha256").hexdigest()


def rate_limit(scope, identity, limit, seconds):
    """Conditional DB update prevents parallel requests exceeding a window's limit."""
    now = timezone.now()
    window = int(now.timestamp()) // seconds
    key = digest("rate", f"{scope}:{identity}:{window}")
    LoginRateLimit.objects.filter(expires_at__lt=now).delete()
    bucket, _ = LoginRateLimit.objects.get_or_create(
        key=key,
        defaults={"expires_at": now + timedelta(seconds=seconds * 2)},
    )
    changed = LoginRateLimit.objects.filter(pk=bucket.pk, hits__lt=limit).update(hits=F("hits") + 1)
    if not changed:
        raise ServiceError(429, "RATE_LIMITED", "操作过于频繁，请稍后再试")


def _client_ip(request):
    # Forwarded headers are not trusted input unless a deployment config verifies them.
    return request.META.get("REMOTE_ADDR", "unknown")


def _clear_challenge_session(request):
    request.session.pop(CHALLENGE_SESSION_KEY, None)


def create_challenge(request):
    if not request.session.session_key:
        request.session.create()
    rate_limit("create-session", request.session.session_key, 5, 60)
    rate_limit("create-ip", _client_ip(request), 20, 60)
    now = timezone.now()
    previous = request.session.get(CHALLENGE_SESSION_KEY, {})
    if previous.get("id") and previous.get("secret"):
        LoginChallenge.objects.filter(
            pk=previous["id"],
            browser_digest=digest("browser", previous["secret"]),
            consumed_at__isnull=True,
        ).update(expires_at=now)
    LoginChallenge.objects.filter(expires_at__lte=now).delete()
    browser_secret = secrets.token_urlsafe(32)
    for _ in range(10):
        code = f"{secrets.randbelow(1_000_000):06d}"
        if code == previous.get("code"):
            continue
        try:
            with transaction.atomic():
                challenge = LoginChallenge.objects.create(
                    code_digest=digest("code", code),
                    browser_digest=digest("browser", browser_secret),
                    expires_at=now + timedelta(seconds=CHALLENGE_TTL_SECONDS),
                )
            break
        except IntegrityError:
            continue
    else:
        raise ServiceError(503, "INTERNAL_ERROR", "暂时无法生成确认码，请稍后重试")
    request.session[CHALLENGE_SESSION_KEY] = {
        "id": str(challenge.pk),
        "secret": browser_secret,
        "code": code,
    }
    request.session.set_expiry(CHALLENGE_TTL_SECONDS + 60)
    return challenge


def browser_challenge(request):
    pairing = request.session.get(CHALLENGE_SESSION_KEY, {})
    if not pairing.get("id") or not pairing.get("secret"):
        return None
    try:
        challenge = LoginChallenge.objects.filter(pk=pairing["id"]).first()
    except (ValueError, TypeError, ValidationError):
        return None
    if not challenge or not constant_time_compare(
        challenge.browser_digest, digest("browser", pairing["secret"])
    ):
        return None
    if challenge.expires_at <= timezone.now() or challenge.consumed_at:
        return None
    return challenge


def confirm_challenge(user, code, request):
    require_staff(user, "portal.access")
    rate_limit("confirm-user", user.pk, 6, 300)
    rate_limit("confirm-ip", _client_ip(request), 30, 300)
    if not isinstance(code, str) or not re.fullmatch(r"[0-9]{6}", code):
        raise ServiceError(422, "VALIDATION_ERROR", "请输入六位数字确认码")
    now = timezone.now()
    with transaction.atomic():
        challenge = (
            LoginChallenge.objects.select_for_update()
            .filter(
                code_digest=digest("code", code),
                expires_at__gt=now,
                approved_at__isnull=True,
                consumed_at__isnull=True,
            )
            .first()
        )
        if challenge is None:
            raise ServiceError(422, "VALIDATION_ERROR", "确认码无效、已使用或已过期")
        # Conditional update also protects one-time confirmation on SQLite local runs.
        updated = LoginChallenge.objects.filter(
            pk=challenge.pk, approved_at__isnull=True, consumed_at__isnull=True
        ).update(approved_by=user, approved_at=now)
        if not updated:
            raise ServiceError(422, "VALIDATION_ERROR", "确认码无效、已使用或已过期")


def consume_challenge(request):
    pairing = request.session.get(CHALLENGE_SESSION_KEY, {})
    challenge = browser_challenge(request)
    if challenge is None:
        _clear_challenge_session(request)
        raise ServiceError(410, "VALIDATION_ERROR", "确认码已失效，请重新生成")
    rate_limit("poll", str(challenge.pk), 60, 60)
    with transaction.atomic():
        challenge = (
            LoginChallenge.objects.select_for_update(of=("self",))
            .select_related("approved_by")
            .filter(pk=challenge.pk)
            .first()
        )
        now = timezone.now()
        if (
            challenge is None
            or challenge.expires_at <= now
            or challenge.consumed_at
            or not constant_time_compare(
                challenge.browser_digest, digest("browser", pairing["secret"])
            )
        ):
            raise ServiceError(410, "VALIDATION_ERROR", "确认码已失效，请重新生成")
        if challenge.approved_by_id is None:
            return None
        # Approval is not a permission snapshot: demotion or disablement applies now.
        require_staff(challenge.approved_by, "portal.access")
        updated = LoginChallenge.objects.filter(
            pk=challenge.pk, consumed_at__isnull=True, expires_at__gt=now
        ).update(consumed_at=now)
        if not updated:
            raise ServiceError(410, "VALIDATION_ERROR", "确认码已失效，请重新生成")
        _clear_challenge_session(request)
        return challenge.approved_by
