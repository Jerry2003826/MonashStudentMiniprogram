import hashlib
import io
import json
import re
from datetime import datetime, timedelta
from unittest.mock import Mock

import httpx
import pytest
from django.core import mail
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import Client
from django.utils import timezone

from apps.core import services
from apps.core.errors import ServiceError
from apps.core.models import (
    Application,
    AuditLog,
    AuthToken,
    EmailCode,
    Membership,
    StaffAccount,
    User,
)
from apps.core.permissions import require_staff

pytestmark = pytest.mark.django_db


@pytest.fixture
def identities():
    users = {}
    for role in ["owner", "reviewer", "editor", "student", "other"]:
        user = User.objects.create_user(
            username=role, openid=f"real-{role}", password=None, nickname=role
        )
        if role in {"owner", "reviewer", "editor"}:
            StaffAccount.objects.create(user=user, role=role)
        users[role] = user
    return users


@pytest.fixture
def api(client):
    def invoke(method, path, body=None, user=None, token=None, **kwargs):
        headers = (
            {"HTTP_AUTHORIZATION": f"Bearer {token or services.issue_token(user)}"}
            if user or token
            else {}
        )
        return getattr(client, method)(
            f"/api/v1{path}",
            data=json.dumps(body) if body is not None else None,
            content_type="application/json",
            **headers,
            **kwargs,
        )

    return invoke


def send_and_read_code(api, user, email="student@student.monash.edu"):
    response = api("post", "/membership/email-code", {"email": email}, user=user)
    assert response.status_code == 200, response.content
    code = re.search(r"验证码是 ([0-9]{6})", mail.outbox[-1].body).group(1)
    return code


def apply(api, user, email="student@student.monash.edu"):
    code = send_and_read_code(api, user, email)
    response = api("post", "/membership/applications", {"email": email, "code": code}, user=user)
    assert response.status_code == 200, response.content
    return response.json()["membership"]["application"]["id"]


def test_wechat_login_only_uses_verified_server_identity(api, settings, monkeypatch):
    settings.WECHAT_APPID = "test-app"
    settings.WECHAT_APPSECRET = "private-app-secret"
    upstream = Mock(
        return_value=httpx.Response(
            200,
            json={"openid": "verified-openid", "session_key": "private-session"},
            request=httpx.Request("GET", "https://api.weixin.qq.com/"),
        )
    )
    monkeypatch.setattr(services.httpx, "get", upstream)
    result = api("post", "/auth/wechat-login", {"code": "temporary-code"})
    assert result.status_code == 200
    payload = result.json()
    assert payload["me"]["membership"]["state"] == "none"
    assert payload["me"]["membership"]["application"] is None
    assert payload["me"]["staff_role"] is None
    assert "private-session" not in result.content.decode()
    assert "private-app-secret" not in result.content.decode()
    user = User.objects.get(openid="verified-openid")
    assert not user.has_usable_password()
    assert (
        AuthToken.objects.get().token_hash == hashlib.sha256(payload["token"].encode()).hexdigest()
    )
    assert AuthToken.objects.get().token_hash != payload["token"]
    assert api("get", "/me", token=payload["token"]).status_code == 200
    upstream.assert_called_with(
        "https://api.weixin.qq.com/sns/jscode2session",
        params={
            "appid": "test-app",
            "secret": "private-app-secret",
            "js_code": "temporary-code",
            "grant_type": "authorization_code",
        },
        timeout=8.0,
        follow_redirects=False,
    )
    assert api("post", "/auth/wechat", {"code": "another-code"}).json()["me"]["id"] == user.pk
    assert User.objects.count() == 1


@pytest.mark.parametrize(
    "upstream,status",
    [
        ({"errcode": 40029, "errmsg": "invalid code"}, 401),
        ({"openid": "identity-without-session"}, 503),
        ({"openid": "", "session_key": "value"}, 503),
        (["bad", "shape"], 401),
    ],
)
def test_wechat_invalid_responses_never_create_identity(
    api, settings, monkeypatch, upstream, status
):
    settings.WECHAT_APPID = "test-app"
    settings.WECHAT_APPSECRET = "test-secret"
    monkeypatch.setattr(
        services.httpx,
        "get",
        lambda *args, **kwargs: httpx.Response(
            200, json=upstream, request=httpx.Request("GET", "https://api.weixin.qq.com/")
        ),
    )
    assert api("post", "/auth/wechat", {"code": "code"}).status_code == status
    assert User.objects.count() == AuthToken.objects.count() == 0


def test_wechat_timeout_does_not_leak_url_or_credentials(api, settings, monkeypatch, caplog):
    settings.WECHAT_APPID = "test-app"
    settings.WECHAT_APPSECRET = "secret-marker"

    def fail(*args, **kwargs):
        raise httpx.ReadTimeout("https://upstream?secret=secret-marker&code=code-marker")

    monkeypatch.setattr(services.httpx, "get", fail)
    response = api("post", "/auth/wechat", {"code": "code-marker"})
    assert response.status_code == 503
    assert "secret-marker" not in caplog.text + response.content.decode()
    assert "code-marker" not in caplog.text + response.content.decode()


def test_missing_wechat_config_fails_and_client_cannot_supply_openid(api, settings, monkeypatch):
    settings.WECHAT_APPID = settings.WECHAT_APPSECRET = ""
    upstream = Mock()
    monkeypatch.setattr(services.httpx, "get", upstream)
    assert api("post", "/auth/wechat", {"code": "code"}).status_code == 503
    assert api("post", "/auth/wechat", {"code": "code", "openid": "owner"}).status_code == 422
    upstream.assert_not_called()
    assert User.objects.count() == 0


def test_bearer_required_expired_token_rejected_and_no_cookie_fallback(api, identities, client):
    client.force_login(identities["owner"])
    assert api("get", "/staff/accounts").status_code == 401
    token = services.issue_token(identities["student"])
    AuthToken.objects.filter(user=identities["student"]).update(
        expires_at=timezone.now() - timedelta(seconds=1)
    )
    assert api("get", "/me", token=token).status_code == 401
    assert api("get", "/me", token="mock-token").status_code == 401


def test_profile_update_cannot_set_permissions_or_membership(api, identities):
    student = identities["student"]
    response = api("patch", "/me", {"nickname": "  学生甲  "}, user=student)
    assert response.status_code == 200
    assert response.json()["nickname"] == "学生甲"
    for extra in ["is_staff", "is_superuser", "staff_role", "openid", "membership"]:
        response = api("patch", "/me", {"nickname": "attempt", extra: "owner"}, user=student)
        assert response.status_code == 422
    student.refresh_from_db()
    assert student.nickname == "学生甲"
    assert not student.is_staff and not student.is_superuser


def test_email_validation_cooldown_and_hash_storage(api, identities):
    student = identities["student"]
    assert (
        api(
            "post", "/membership/email-code", {"email": "person@gmail.com"}, user=student
        ).status_code
        == 422
    )
    code = send_and_read_code(api, student, "Student@STUDENT.monash.edu")
    stored = EmailCode.objects.get()
    assert stored.email == "student@student.monash.edu"
    assert stored.code_hash != code and len(stored.code_hash) == 64
    assert (
        api("post", "/membership/email-code", {"email": stored.email}, user=student).status_code
        == 429
    )
    assert (
        api(
            "post", "/membership/email-code", {"email": stored.email}, user=identities["other"]
        ).status_code
        == 429
    )


def test_ten_codes_per_user_per_24_hours(api, identities):
    student = identities["student"]
    for number in range(10):
        send_and_read_code(api, student, f"student{number}@student.monash.edu")
    response = api(
        "post", "/membership/email-code", {"email": "eleventh@student.monash.edu"}, user=student
    )
    assert response.status_code == 429
    assert EmailCode.objects.count() == 10


def test_ten_codes_per_email_independent_of_user(api, identities):
    email = "student@student.monash.edu"
    now = timezone.now()
    for number in range(10):
        record = EmailCode.objects.create(
            user=identities["student"],
            email=email,
            code_hash="hash",
            expires_at=now + timedelta(minutes=10),
        )
        EmailCode.objects.filter(pk=record.pk).update(
            created_at=now - timedelta(minutes=number + 2)
        )
    response = api("post", "/membership/email-code", {"email": email}, user=identities["other"])
    assert response.status_code == 429


def test_failed_mail_rolls_back_code_and_can_retry(api, identities, monkeypatch):
    real_sender = services.send_mail
    monkeypatch.setattr(services, "send_mail", Mock(side_effect=RuntimeError("smtp-secret")))
    response = api(
        "post",
        "/membership/email-code",
        {"email": "student@student.monash.edu"},
        user=identities["student"],
    )
    assert response.status_code == 503
    assert EmailCode.objects.count() == 0
    monkeypatch.setattr(services, "send_mail", real_sender)
    send_and_read_code(api, identities["student"])


def test_unconfigured_smtp_explicitly_fails(api, identities, settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
    settings.EMAIL_HOST = ""
    assert (
        api(
            "post",
            "/membership/email-code",
            {"email": "student@student.monash.edu"},
            user=identities["student"],
        ).status_code
        == 503
    )
    assert EmailCode.objects.count() == 0


def test_code_expires_and_five_wrong_attempts_cannot_be_rolled_back(api, identities):
    student = identities["student"]
    code = send_and_read_code(api, student)
    wrong = "000000" if code != "000000" else "999999"
    for _ in range(5):
        assert (
            api(
                "post",
                "/membership/applications",
                {"email": "student@student.monash.edu", "code": wrong},
                user=student,
            ).status_code
            == 422
        )
    assert EmailCode.objects.get().attempts == 5
    assert (
        api(
            "post",
            "/membership/applications",
            {"email": "student@student.monash.edu", "code": code},
            user=student,
        ).status_code
        == 422
    )
    EmailCode.objects.update(attempts=0, expires_at=timezone.now() - timedelta(seconds=1))
    assert (
        api(
            "post",
            "/membership/applications",
            {"email": "student@student.monash.edu", "code": code},
            user=student,
        ).status_code
        == 422
    )
    assert not Application.objects.exists() and not Membership.objects.exists()


def test_code_cannot_be_used_by_another_user(api, identities):
    code = send_and_read_code(api, identities["student"])
    assert (
        api(
            "post",
            "/membership/applications",
            {"email": "student@student.monash.edu", "code": code},
            user=identities["other"],
        ).status_code
        == 422
    )
    assert not Application.objects.exists()


@pytest.mark.parametrize("endpoint", ["/membership/applications", "/membership/verify"])
def test_verification_only_creates_pending_not_membership(api, identities, endpoint):
    student = identities["student"]
    code = send_and_read_code(api, student)
    response = api(
        "post", endpoint, {"email": "student@student.monash.edu", "code": code}, user=student
    )
    assert response.status_code == 200
    membership = response.json()["membership"]
    assert membership["state"] == "none"
    assert membership["application"]["status"] == "pending"
    assert membership["member_no"] is None
    assert not Membership.objects.exists()
    assert api("get", "/membership/card", user=student).status_code == 403
    duplicate = api(
        "post", endpoint, {"email": "student@student.monash.edu", "code": code}, user=student
    )
    assert duplicate.status_code == 422
    assert Application.objects.count() == 1


def test_approval_is_required_for_card_and_duplicate_review_is_rejected(api, identities):
    application_id = apply(api, identities["student"])
    path = f"/staff/applications/{application_id}/review"
    body = {"decision": "approved", "note": "资料已核对"}
    for role in ["student", "editor"]:
        assert api("post", path, body, user=identities[role]).status_code == 403
    response = api("post", path, body, user=identities["reviewer"])
    assert response.status_code == 200
    assert response.json()["review_note"] == "资料已核对"
    first_expiry = Membership.objects.get().expires_at
    assert api("get", "/membership/card", user=identities["student"]).status_code == 200
    assert api("post", path, body, user=identities["owner"]).status_code == 422
    assert Membership.objects.count() == 1 and Membership.objects.get().expires_at == first_expiry
    assert AuditLog.objects.filter(action="membership.review").count() == 1


def test_rejection_does_not_grant_membership(api, identities):
    application_id = apply(api, identities["student"])
    response = api(
        "post",
        f"/staff/applications/{application_id}/review",
        {"decision": "rejected", "note": "请补充申请资料"},
        user=identities["reviewer"],
    )
    assert response.status_code == 200
    assert not Membership.objects.exists()
    assert api("get", "/membership/card", user=identities["student"]).status_code == 403
    assert (
        api("get", "/me", user=identities["student"]).json()["membership"]["application"]["status"]
        == "rejected"
    )


def test_review_input_cannot_smuggle_privileged_fields(api, identities):
    application_id = apply(api, identities["student"])
    response = api(
        "post",
        f"/staff/applications/{application_id}/review",
        {"decision": "approved", "user_id": identities["owner"].pk},
        user=identities["reviewer"],
    )
    assert response.status_code == 422
    assert Application.objects.get().status == "pending"
    assert not Membership.objects.exists()


def test_reviewers_cannot_approve_their_own_membership(api, identities):
    application_id = apply(api, identities["reviewer"], "reviewer@student.monash.edu")
    assert (
        api(
            "post",
            f"/staff/applications/{application_id}/review",
            {"decision": "approved"},
            user=identities["reviewer"],
        ).status_code
        == 403
    )
    assert not Membership.objects.exists()


def test_staff_pages_and_endpoints_recheck_db_roles(api, identities):
    for role in ["student", "reviewer", "editor"]:
        assert api("get", "/staff/accounts", user=identities[role]).status_code == 403
        assert (
            api(
                "post",
                "/staff/accounts",
                {"user_id": identities["other"].pk, "role": "owner"},
                user=identities[role],
            ).status_code
            == 403
        )
    assert api("get", "/staff/applications", user=identities["editor"]).status_code == 403
    assert api("get", "/staff/applications", user=identities["reviewer"]).status_code == 200
    cached_user = identities["reviewer"]
    assert require_staff(cached_user, "membership.review").role == "reviewer"
    StaffAccount.objects.filter(user=cached_user).update(role="editor")
    with pytest.raises(ServiceError) as exc:
        require_staff(cached_user, "membership.review")
    assert exc.value.status == 403


def test_owner_creates_and_changes_accounts_but_rejects_extra_fields(api, identities):
    owner = identities["owner"]
    result = api(
        "post", "/staff/accounts", {"user_id": identities["other"].pk, "role": "editor"}, user=owner
    )
    assert result.status_code == 200
    account_id = result.json()["id"]
    assert (
        api("patch", f"/staff/accounts/{account_id}", {"role": "reviewer"}, user=owner).status_code
        == 200
    )
    assert (
        api(
            "patch",
            f"/staff/accounts/{account_id}",
            {"role": "owner", "is_superuser": True},
            user=owner,
        ).status_code
        == 422
    )
    assert StaffAccount.objects.get(pk=account_id).role == "reviewer"
    assert AuditLog.objects.filter(target_id=account_id, target_type="staff_account").count() == 2


def test_disabling_staff_invalidates_old_tokens_and_restores_no_cached_permissions(api, identities):
    reviewer = identities["reviewer"]
    old_token = services.issue_token(reviewer)
    account = StaffAccount.objects.get(user=reviewer)
    response = api(
        "patch", f"/staff/accounts/{account.pk}", {"is_active": False}, user=identities["owner"]
    )
    assert response.status_code == 200
    assert api("get", "/staff/applications", token=old_token).status_code == 401
    assert api("get", "/staff/applications", user=reviewer).status_code == 403
    assert services.build_me(reviewer)["staff_role"] is None


def test_cannot_remove_last_owner_or_change_own_role(api, identities):
    owner = identities["owner"]
    account = StaffAccount.objects.get(user=owner)
    for body in [{"is_active": False}, {"role": "editor"}]:
        assert api("patch", f"/staff/accounts/{account.pk}", body, user=owner).status_code == 422
    StaffAccount.objects.create(user=identities["other"], role="owner")
    assert (
        api("patch", f"/staff/accounts/{account.pk}", {"role": "editor"}, user=owner).status_code
        == 403
    )
    account.refresh_from_db()
    assert account.is_active and account.role == "owner"


def test_revoked_or_other_users_email_cannot_be_reapplied_or_transferred(api, identities):
    student, other = identities["student"], identities["other"]
    now = timezone.now()
    membership = Membership.objects.create(
        user=student,
        email="student@student.monash.edu",
        approved_at=now,
        expires_at=now + timedelta(days=10),
    )
    code = send_and_read_code(api, other)
    response = api(
        "post", "/membership/applications", {"email": membership.email, "code": code}, user=other
    )
    assert response.status_code == 409 and response.json()["code"] == "ALREADY_MEMBER"
    membership.refresh_from_db()
    assert membership.user_id == student.pk
    membership.revoked_at = now
    membership.save(update_fields=["revoked_at"])
    EmailCode.objects.all().delete()
    code = send_and_read_code(api, student)
    response = api(
        "post", "/membership/applications", {"email": membership.email, "code": code}, user=student
    )
    assert response.status_code == 409 and response.json()["code"] == "MEMBERSHIP_REVOKED"
    assert api("get", "/membership/card", user=student).status_code == 403


def test_renewal_window_and_expiry_from_approval_using_calendar_year(api, identities, monkeypatch):
    student = identities["student"]
    now = datetime.fromisoformat("2027-02-28T10:00:00+00:00")
    monkeypatch.setattr(services.timezone, "now", lambda: now)
    membership = Membership.objects.create(
        user=student,
        email="student@student.monash.edu",
        approved_at=now,
        expires_at=now + timedelta(days=31),
    )
    code = send_and_read_code(api, student)
    response = api(
        "post", "/membership/applications", {"email": membership.email, "code": code}, user=student
    )
    assert response.status_code == 409 and response.json()["code"] == "RENEWAL_NOT_OPEN"
    membership.expires_at = now + timedelta(days=30)
    membership.save(update_fields=["expires_at"])
    application = services.submit_application(student, membership.email, code)
    services.review_application(identities["reviewer"], application.pk, "approved", "renew")
    expected = services.add_calendar_year(membership.expires_at)
    membership.refresh_from_db()
    assert membership.expires_at == expected
    assert (
        services.add_calendar_year(datetime.fromisoformat("2028-02-29T10:00:00+00:00")).isoformat()
        == "2029-02-28T10:00:00+00:00"
    )


def test_expired_pending_application_starts_12_months_at_approval(identities):
    student = identities["student"]
    now = timezone.now()
    application = Application.objects.create(user=student, email="student@student.monash.edu")
    Application.objects.filter(pk=application.pk).update(submitted_at=now - timedelta(days=90))
    services.review_application(identities["owner"], application.pk, "approved", "")
    membership = Membership.objects.get(user=student)
    assert membership.expires_at > services.add_calendar_year(now - timedelta(seconds=1))


def test_expired_membership_cannot_read_card(api, identities):
    now = timezone.now()
    Membership.objects.create(
        user=identities["student"],
        email="student@student.monash.edu",
        approved_at=now - timedelta(days=400),
        expires_at=now - timedelta(seconds=1),
    )
    assert api("get", "/membership/card", user=identities["student"]).status_code == 403


def test_dev_login_and_seeding_require_both_flags_and_loopback(api, settings):
    settings.DEBUG = True
    settings.ENABLE_DEV_LOGIN = False
    assert (
        api(
            "post", "/auth/dev-login", {"username": "demo-owner"}, HTTP_HOST="localhost"
        ).status_code
        == 404
    )
    with pytest.raises(CommandError):
        call_command("seed_demo", stdout=io.StringIO())
    settings.ENABLE_DEV_LOGIN = True
    call_command("seed_demo", stdout=io.StringIO())
    assert User.objects.count() == 4
    assert all(not user.has_usable_password() for user in User.objects.all())
    assert (
        api(
            "post", "/auth/dev-login", {"username": "demo-owner"}, HTTP_HOST="localhost"
        ).status_code
        == 200
    )
    assert (
        api(
            "post",
            "/auth/dev-login",
            {"username": "demo-owner"},
            HTTP_HOST="localhost",
            REMOTE_ADDR="192.168.1.20",
        ).status_code
        == 403
    )
    settings.DEBUG = False
    assert (
        api(
            "post", "/auth/dev-login", {"username": "demo-owner"}, HTTP_HOST="localhost"
        ).status_code
        == 404
    )
    with pytest.raises(CommandError):
        call_command("seed_demo", stdout=io.StringIO())


def test_dev_login_cannot_impersonate_real_identity_with_demo_username(api, settings):
    settings.DEBUG = settings.ENABLE_DEV_LOGIN = True
    User.objects.create_user(username="demo-owner", openid="real-identity", password=None)
    assert (
        api(
            "post", "/auth/dev-login", {"username": "demo-owner"}, HTTP_HOST="localhost"
        ).status_code
        == 404
    )
    with pytest.raises(CommandError):
        call_command("seed_demo", stdout=io.StringIO())


def test_bootstrap_owner_requires_real_user_and_cannot_run_twice():
    demo = User.objects.create_user(username="demo", openid="dev:demo", password=None)
    with pytest.raises(CommandError):
        call_command("bootstrap_owner", user_id=demo.pk, stdout=io.StringIO())
    real = User.objects.create_user(username="real", openid="real-wechat-id", password=None)
    call_command("bootstrap_owner", user_id=real.pk, stdout=io.StringIO())
    assert StaffAccount.objects.get(user=real).role == "owner"
    assert not real.has_usable_password()
    assert AuditLog.objects.filter(action="staff.bootstrap_owner").count() == 1
    with pytest.raises(CommandError):
        call_command("bootstrap_owner", user_id=real.pk, stdout=io.StringIO())


def test_health_check_is_public_and_does_not_expose_settings(client):
    assert client.get("/healthz").json() == {"status": "ok"}
    assert client.get("/api/v1/health").json() == {"status": "ok"}
    csrf_client = Client(enforce_csrf_checks=True)
    assert csrf_client.post("/manage/login/", {"username": "owner"}).status_code in {403, 404, 405}
