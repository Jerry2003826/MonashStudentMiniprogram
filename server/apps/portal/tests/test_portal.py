import json
from datetime import timedelta

import pytest
from django.test import Client, override_settings
from django.utils import timezone

from apps.core.models import Application, Membership, StaffAccount, User
from apps.core.services import issue_token
from apps.portal.models import LoginChallenge
from apps.portal.pairing import CHALLENGE_SESSION_KEY

pytestmark = pytest.mark.django_db


def browser(user=None):
    client = Client(enforce_csrf_checks=True, HTTP_HOST="localhost")
    if user:
        client.force_login(user, backend="django.contrib.auth.backends.ModelBackend")
    client.get("/manage/login/")
    return client


def post(client, path, data=None, **kwargs):
    return client.post(
        path, data or {}, HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value, **kwargs
    )


def pairing_browser():
    client = browser()
    assert post(client, "/manage/login/challenge/").status_code == 302
    return client, client.session[CHALLENGE_SESSION_KEY]["code"]


def confirm(user, code, **extra):
    client = Client(enforce_csrf_checks=True, HTTP_HOST="localhost")
    return client.post(
        "/api/v1/staff/login/confirm",
        data=json.dumps({"code": code, **extra}),
        content_type="application/json",
        HTTP_AUTHORIZATION=f"Bearer {issue_token(user)}",
    )


def application_for(user):
    return Application.objects.create(user=user, email=f"student{user.pk}@student.monash.edu")


def test_login_is_not_password_based_and_get_cannot_create_or_consume():
    client = browser()
    page = client.get("/manage/login/").content.decode()
    assert "用户名和密码登录" in page
    assert 'type="password"' not in page
    assert "本地演示登录" not in page
    assert LoginChallenge.objects.count() == 0
    for path in ("challenge", "poll", "dev"):
        assert client.get(f"/manage/login/{path}/").status_code == 405


def test_anonymous_management_redirects_to_login():
    client = browser()
    for path in ("accounts", "applications"):
        assert client.get(f"/manage/{path}/").url == "/manage/login/"


@pytest.mark.parametrize("role", ["reviewer", "editor", "student"])
def test_nonowners_cannot_access_or_post_account_urls(identities, role):
    client = browser(identities[role])
    account = identities["reviewer"].staff_account
    before = StaffAccount.objects.count()
    assert client.get("/manage/accounts/").status_code in (302, 403)
    for url, data in [
        ("/manage/accounts/create/", {"user_id": identities["student"].pk, "role": "owner"}),
        (f"/manage/accounts/{account.pk}/update/", {"role": "owner", "is_active": "on"}),
    ]:
        client.force_login(identities[role])
        assert post(client, url, data).status_code == 403
    account.refresh_from_db()
    assert account.role == "reviewer"
    assert StaffAccount.objects.count() == before


def test_owner_can_create_change_role_and_disable_account(identities):
    client = browser(identities["owner"])
    assert client.get("/manage/accounts/").status_code == 200
    result = post(
        client, "/manage/accounts/create/", {"user_id": identities["student"].pk, "role": "editor"}
    )
    assert result.status_code == 302
    account = StaffAccount.objects.get(user=identities["student"])
    assert account.role == "editor"
    url = f"/manage/accounts/{account.pk}/update/"
    assert post(client, url, {"role": "reviewer", "is_active": "on"}).status_code == 302
    account.refresh_from_db()
    assert account.role == "reviewer" and account.is_active
    post(client, url, {"role": "reviewer"})
    account.refresh_from_db()
    assert not account.is_active


def test_disabled_account_loses_existing_browser_session(identities):
    reviewer = browser(identities["reviewer"])
    assert reviewer.get("/manage/applications/").status_code == 200
    account = identities["reviewer"].staff_account
    owner = browser(identities["owner"])
    post(owner, f"/manage/accounts/{account.pk}/update/", {"role": "reviewer"})
    assert reviewer.get("/manage/applications/").status_code == 403
    assert "_auth_user_id" not in reviewer.session


def test_demotion_applies_to_existing_session_without_relogin(identities):
    second_owner = User.objects.create_user(username="second-owner", openid="second-owner")
    account = StaffAccount.objects.create(user=second_owner, role="owner")
    old_session = browser(second_owner)
    assert old_session.get("/manage/accounts/").status_code == 200
    owner = browser(identities["owner"])
    url = f"/manage/accounts/{account.pk}/update/"
    post(owner, url, {"role": "reviewer", "is_active": "on"})
    assert old_session.get("/manage/accounts/").status_code == 403
    assert old_session.get("/manage/applications/").status_code == 200
    post(owner, url, {"role": "editor", "is_active": "on"})
    assert old_session.get("/manage/applications/").status_code == 403


def test_deactivated_user_loses_existing_browser_session(identities):
    client = browser(identities["reviewer"])
    User.objects.filter(pk=identities["reviewer"].pk).update(is_active=False)
    assert client.get("/manage/applications/").status_code == 302
    assert "_auth_user_id" not in client.session


def test_all_browser_writes_require_csrf(identities):
    client = browser(identities["owner"])
    application = application_for(identities["student"])
    urls = [
        "/manage/login/challenge/",
        "/manage/login/poll/",
        "/manage/login/dev/",
        "/manage/logout/",
        "/manage/accounts/create/",
        f"/manage/accounts/{identities['reviewer'].staff_account.pk}/update/",
        f"/manage/applications/{application.pk}/review/",
    ]
    for url in urls:
        assert client.post(url, {"decision": "approved", "role": "owner"}).status_code == 403, url
    application.refresh_from_db()
    assert application.status == "pending"


@pytest.mark.parametrize("decision", ["approved", "rejected"])
def test_reviewer_explicit_decision_uses_core_service(identities, decision):
    application = application_for(identities["student"])
    client = browser(identities["reviewer"])
    assert "请选择审核结果" in client.get("/manage/applications/").content.decode()
    result = post(
        client,
        f"/manage/applications/{application.pk}/review/",
        {"decision": decision, "note": "已核对"},
    )
    assert result.status_code == 302
    application.refresh_from_db()
    assert application.status == decision
    assert application.reviewer == identities["reviewer"]
    assert application.review_note == "已核对"
    assert Membership.objects.filter(user=identities["student"]).exists() == (
        decision == "approved"
    )


def test_missing_review_decision_does_not_approve(identities):
    application = application_for(identities["student"])
    client = browser(identities["reviewer"])
    post(client, f"/manage/applications/{application.pk}/review/", {"note": "未选择"})
    application.refresh_from_db()
    assert application.status == "pending"
    assert not Membership.objects.filter(user=identities["student"]).exists()


def test_editor_cannot_review_direct_url(identities):
    application = application_for(identities["student"])
    client = browser(identities["editor"])
    assert client.get("/manage/applications/").status_code == 403
    result = post(
        client, f"/manage/applications/{application.pk}/review/", {"decision": "approved"}
    )
    assert result.status_code == 403
    application.refresh_from_db()
    assert application.status == "pending"


def test_pairing_confirms_self_and_rotates_session_once(identities):
    client, code = pairing_browser()
    before = client.session.session_key
    challenge = LoginChallenge.objects.get()
    secret = client.session[CHALLENGE_SESSION_KEY]["secret"]
    assert challenge.code_digest != code and challenge.browser_digest != secret
    page = client.get("/manage/login/").content.decode()
    assert code in page and secret not in page
    assert post(client, "/manage/login/poll/").json() == {"state": "pending"}
    assert confirm(identities["reviewer"], code).status_code == 200
    result = post(client, "/manage/login/poll/")
    assert result.json() == {"state": "authenticated", "redirect": "/manage/"}
    assert client.session["_auth_user_id"] == str(identities["reviewer"].pk)
    assert client.session.session_key != before
    assert CHALLENGE_SESSION_KEY not in client.session
    challenge.refresh_from_db()
    assert challenge.consumed_at is not None and challenge.approved_by == identities["reviewer"]
    assert confirm(identities["owner"], code).status_code == 422
    assert post(client, "/manage/login/poll/").status_code == 410


def test_code_cannot_confirm_twice_before_consumption(identities):
    _, code = pairing_browser()
    assert confirm(identities["reviewer"], code).status_code == 200
    assert confirm(identities["owner"], code).status_code == 422
    assert LoginChallenge.objects.get().approved_by == identities["reviewer"]


def test_code_and_id_cannot_authenticate_another_browser(identities):
    legitimate, code = pairing_browser()
    challenge = LoginChallenge.objects.get()
    assert confirm(identities["reviewer"], code).status_code == 200
    attacker = browser()
    result = post(attacker, "/manage/login/poll/", {"code": code, "id": str(challenge.pk)})
    assert result.status_code == 410
    session = attacker.session
    session[CHALLENGE_SESSION_KEY] = {"id": str(challenge.pk), "secret": "wrong", "code": code}
    session.save()
    assert post(attacker, "/manage/login/poll/").status_code == 410
    assert "_auth_user_id" not in attacker.session
    assert post(legitimate, "/manage/login/poll/").status_code == 200


def test_confirmation_cannot_choose_another_user(identities):
    _, code = pairing_browser()
    assert confirm(identities["reviewer"], code, user_id=identities["owner"].pk).status_code == 422
    assert LoginChallenge.objects.get().approved_by_id is None


def test_confirmation_requires_bearer_not_browser_cookie(identities):
    _, code = pairing_browser()
    client = browser(identities["owner"])
    result = post(
        client,
        "/api/v1/staff/login/confirm",
        json.dumps({"code": code}),
        content_type="application/json",
    )
    assert result.status_code == 401
    assert LoginChallenge.objects.get().approved_by_id is None


@pytest.mark.parametrize("disabled", [False, True])
def test_nonstaff_and_disabled_staff_cannot_confirm(identities, disabled):
    _, code = pairing_browser()
    user = identities["reviewer"] if disabled else identities["student"]
    if disabled:
        StaffAccount.objects.filter(user=user).update(is_active=False)
    assert confirm(user, code).status_code == 403
    assert LoginChallenge.objects.get().approved_by_id is None


def test_revocation_after_confirmation_prevents_login(identities):
    client, code = pairing_browser()
    assert confirm(identities["reviewer"], code).status_code == 200
    StaffAccount.objects.filter(user=identities["reviewer"]).update(is_active=False)
    assert post(client, "/manage/login/poll/").status_code == 403
    assert "_auth_user_id" not in client.session
    assert LoginChallenge.objects.get().consumed_at is None


@pytest.mark.parametrize("approved", [False, True])
def test_expired_challenge_cannot_confirm_or_be_consumed(identities, approved):
    client, code = pairing_browser()
    if approved:
        assert confirm(identities["reviewer"], code).status_code == 200
    LoginChallenge.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
    assert confirm(identities["reviewer"], code).status_code == 422
    assert post(client, "/manage/login/poll/").status_code == 410
    assert "_auth_user_id" not in client.session


def test_new_code_invalidates_previous_code_even_on_random_collision(identities, monkeypatch):
    generated = iter([123456, 123456, 654321])
    monkeypatch.setattr("apps.portal.pairing.secrets.randbelow", lambda _: next(generated))
    client, old_code = pairing_browser()
    post(client, "/manage/login/challenge/")
    new_code = client.session[CHALLENGE_SESSION_KEY]["code"]
    assert LoginChallenge.objects.count() == 1
    assert confirm(identities["reviewer"], old_code).status_code == 422
    assert confirm(identities["reviewer"], new_code).status_code == 200


def test_guessing_is_rate_limited_per_identity(identities):
    client, code = pairing_browser()
    wrong = "000000" if code != "000000" else "000001"
    for _ in range(6):
        assert confirm(identities["reviewer"], wrong).status_code == 422
    blocked = confirm(identities["reviewer"], code)
    assert blocked.status_code == 429 and blocked.json()["code"] == "RATE_LIMITED"
    assert post(client, "/manage/login/poll/").json() == {"state": "pending"}


@pytest.mark.parametrize("debug,enabled", [(False, False), (False, True), (True, False)])
def test_demo_requires_both_flags_and_hides_controls(debug, enabled):
    with override_settings(DEBUG=debug, ENABLE_DEV_LOGIN=enabled):
        client = browser()
        assert "本地演示登录" not in client.get("/manage/login/").content.decode()
        assert post(client, "/manage/login/dev/", {"username": "demo-owner"}).status_code == 404
        assert "_auth_user_id" not in client.session


def make_demo_owner(openid="dev:demo-owner"):
    user = User.objects.create_user(username="demo-owner", openid=openid, nickname="演示负责人")
    StaffAccount.objects.create(user=user, role="owner")
    return user


@override_settings(DEBUG=True, ENABLE_DEV_LOGIN=True)
def test_local_demo_login_uses_seeded_identity():
    user = make_demo_owner()
    client = browser()
    assert "本地演示登录" in client.get("/manage/login/").content.decode()
    assert not user.has_usable_password()
    assert post(client, "/manage/login/dev/", {"username": "demo-owner"}).status_code == 302
    assert client.session["_auth_user_id"] == str(user.pk)


@override_settings(DEBUG=True, ENABLE_DEV_LOGIN=True)
def test_demo_refuses_real_user_with_same_username():
    make_demo_owner(openid="real-wechat-openid")
    client = browser()
    assert post(client, "/manage/login/dev/", {"username": "demo-owner"}).status_code in (403, 404)
    assert "_auth_user_id" not in client.session


@override_settings(DEBUG=True, ENABLE_DEV_LOGIN=True)
def test_demo_refuses_user_with_usable_password():
    user = make_demo_owner()
    user.set_password("not-a-supported-login")
    user.save(update_fields=["password"])
    client = browser()
    assert post(client, "/manage/login/dev/", {"username": "demo-owner"}).status_code == 403
    assert "_auth_user_id" not in client.session


@override_settings(DEBUG=True, ENABLE_DEV_LOGIN=True, ALLOWED_HOSTS=["localhost", "remote.example"])
@pytest.mark.parametrize(
    "host,remote", [("remote.example", "127.0.0.1"), ("localhost", "203.0.113.10")]
)
def test_demo_requires_local_host_and_loopback_peer(host, remote):
    make_demo_owner()
    client = Client(enforce_csrf_checks=True, HTTP_HOST=host, REMOTE_ADDR=remote)
    assert "本地演示登录" not in client.get("/manage/login/").content.decode()
    assert post(client, "/manage/login/dev/", {"username": "demo-owner"}).status_code == 403
    assert "_auth_user_id" not in client.session
