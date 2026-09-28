import json
from unittest.mock import MagicMock

import httpx
import pytest

from ops.preflight import configuration_issues, main, online_checks, probe_public_api


@pytest.fixture
def configured_environment(tmp_path):
    project = tmp_path / "project.config.json"
    project.write_text(json.dumps({"appid": "wx0123456789abcdef"}))
    env = {
        "DJANGO_DEBUG": "false",
        "ENABLE_DEV_LOGIN": "false",
        "DJANGO_SECRET_KEY": "a-random-unit-check-value-234567890" * 2,
        "WECHAT_APPID": "wx0123456789abcdef",
        "WECHAT_APPSECRET": "0123456789abcdef0123456789abcdef",
        "DATABASE_URL": "postgresql://app:unit-password@db.club.org/app?sslmode=require",
        "EMAIL_HOST": "smtp.club.org",
        "EMAIL_HOST_USER": "mailer",
        "EMAIL_HOST_PASSWORD": "unit-mailer-password",
        "DEFAULT_FROM_EMAIL": "Testing <testing@club.org>",
        "PUBLIC_API_ORIGIN": "https://api.club.org",
        "DJANGO_ALLOWED_HOSTS": "api.club.org",
        "CSRF_TRUSTED_ORIGINS": "https://api.club.org",
        "DJANGO_TRUST_PROXY_SSL_HEADER": "true",
    }
    return env, project


def test_complete_configuration_passes_without_network(configured_environment):
    env, project = configured_environment
    assert configuration_issues(env, project) == []


@pytest.mark.parametrize(
    "key,value",
    [
        ("DJANGO_DEBUG", "true"),
        ("ENABLE_DEV_LOGIN", "true"),
        ("WECHAT_CONTENT_SAFETY_MODE", "fake"),
        ("DJANGO_SETTINGS_MODULE", "config.settings_build"),
        ("WECHAT_APPID", "wx1111111111111111"),
        ("WECHAT_APPSECRET", "REPLACE_WITH_APP_SECRET"),
        ("DATABASE_URL", "postgresql://app:secret@db.club.org/app?sslmode=disable"),
        ("EMAIL_HOST", ""),
        ("EMAIL_USE_SSL", "true"),
        ("EMAIL_PORT", "invalid"),
        ("PUBLIC_API_ORIGIN", "https://127.0.0.1"),
        ("PUBLIC_API_ORIGIN", "https://api.club.org/api/v1"),
        ("PUBLIC_API_ORIGIN", "https://api.example.com"),
        ("DJANGO_ALLOWED_HOSTS", "*"),
        ("CSRF_TRUSTED_ORIGINS", ""),
        ("DJANGO_SECURE_SSL_REDIRECT", "false"),
        ("DJANGO_TRUST_PROXY_SSL_HEADER", "false"),
        ("DJANGO_TRUST_PROXY_SSL_HEADER", ""),
        ("DJANGO_TRUST_PROXY_SSL_HEADER", "invalid"),
    ],
)
def test_unsafe_or_incomplete_configuration_fails(configured_environment, key, value):
    env, project = configured_environment
    assert configuration_issues({**env, key: value}, project)


def test_failure_does_not_echo_credentials(configured_environment):
    env, project = configured_environment
    env["DATABASE_URL"] = "postgresql://private-user:do-not-echo@host.invalid/db?extra=secret"
    output = json.dumps(configuration_issues(env, project))
    assert "do-not-echo" not in output
    assert "private-user" not in output
    assert "extra=secret" not in output


def test_online_checks_do_not_run_when_configuration_is_incomplete(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr("ops.preflight.os.environ", {})
    monkeypatch.setattr(
        "ops.preflight.online_checks", lambda **kwargs: pytest.fail("must not probe")
    )
    assert main(["--online", "--project-config", str(tmp_path / "missing.json")]) == 1
    result = json.loads(capsys.readouterr().out)
    assert result["ok"] is False
    assert result["checks"] == []


def test_trusted_ingress_must_be_explicit(configured_environment):
    env, project = configured_environment
    del env["DJANGO_TRUST_PROXY_SSL_HEADER"]
    assert any(
        "DJANGO_TRUST_PROXY_SSL_HEADER" in issue for issue in configuration_issues(env, project)
    )


LOGIN_PAGE = (
    '<html><form id="pairing-create" method="post" action="/manage/login/challenge/">'
    '<input type="hidden" name="csrfmiddlewaretoken" value="local-probe-fixture">'
    "</form></html>"
)
HOME = {
    "banners": [{"id": 1, "title": "公告", "image_url": "", "link_type": "none", "link_id": None}],
    "featured_merchants": [
        {
            "id": 1,
            "name": "商家",
            "logo_url": "",
            "discount_summary": "折扣",
            "is_example": False,
            "category": {"id": 1, "name": "餐饮"},
            "area": {"id": 1, "name": "城区"},
        }
    ],
}


def public_response(path):
    if path in ("/healthz", "/readyz"):
        return httpx.Response(200, json={"status": "ok"})
    if path == "/api/v1/home":
        return httpx.Response(200, json=HOME)
    if path == "/manage/login/":
        return httpx.Response(
            200, text=LOGIN_PAGE, headers={"content-type": "text/html; charset=utf-8"}
        )
    if path == "/manage/":
        return httpx.Response(302, headers={"location": "/manage/login/"})
    pytest.fail("Unexpected public probe path")


def test_public_probe_validates_actual_routes_without_rejecting_normal_portal_login():
    requests = []

    def transport(request):
        requests.append(request.url.path)
        return public_response(request.url.path)

    with httpx.Client(transport=httpx.MockTransport(transport)) as client:
        probe_public_api(client, "https://api.club.org/")
    assert requests == ["/healthz", "/readyz", "/api/v1/home", "/manage/login/"]


@pytest.mark.parametrize("path", ["/api/v1/home", "/manage/login/"])
def test_healthy_exempt_probes_do_not_hide_application_https_redirect_loop(path):
    requests = []

    def transport(request):
        requests.append(request.url.path)
        if request.url.path == path:
            return httpx.Response(301, headers={"location": str(request.url)})
        return public_response(request.url.path)

    # Deliberately enable client redirects; the probe must override this itself.
    with httpx.Client(transport=httpx.MockTransport(transport), follow_redirects=True) as client:
        with pytest.raises(RuntimeError):
            probe_public_api(client, "https://api.club.org")
    assert requests.count(path) == 1


@pytest.mark.parametrize(
    "path,response",
    [
        ("/healthz", httpx.Response(200, json={"status": "wrong"})),
        ("/readyz", httpx.Response(503, json={"status": "unavailable"})),
        ("/api/v1/home", httpx.Response(200, json={"status": "ok"})),
        ("/api/v1/home", httpx.Response(200, json={"banners": {}, "featured_merchants": []})),
        (
            "/api/v1/home",
            httpx.Response(200, json={"banners": [], "featured_merchants": [{"id": "bad"}]}),
        ),
        (
            "/manage/login/",
            httpx.Response(
                200, text="<html>Another website</html>", headers={"content-type": "text/html"}
            ),
        ),
        ("/manage/login/", httpx.Response(200, text=LOGIN_PAGE)),
        (
            "/manage/login/",
            httpx.Response(
                200,
                text=LOGIN_PAGE.replace('name="csrfmiddlewaretoken"', 'name="unrelated"'),
                headers={"content-type": "text/html"},
            ),
        ),
    ],
)
def test_public_probe_rejects_wrong_website_or_invalid_response_schema(path, response):
    def transport(request):
        return response if request.url.path == path else public_response(request.url.path)

    with httpx.Client(transport=httpx.MockTransport(transport)) as client:
        with pytest.raises(RuntimeError):
            probe_public_api(client, "https://api.club.org")


@pytest.mark.django_db
def test_online_http_probes_never_trust_environment_proxy_or_follow_redirects(
    monkeypatch, settings
):
    settings.WECHAT_APPID = "wx0123456789abcdef"
    settings.WECHAT_APPSECRET = "0123456789abcdef0123456789abcdef"
    monkeypatch.setenv("PUBLIC_API_ORIGIN", "https://api.club.org")
    mail = MagicMock()
    mail.__enter__.return_value = mail
    mail.connection.noop.return_value = (250, b"ok")
    monkeypatch.setattr("django.core.mail.get_connection", lambda: mail)
    client_options = []
    original_client = httpx.Client

    def transport(request):
        if request.url.host == "api.weixin.qq.com":
            return httpx.Response(200, json={"access_token": "not-a-real-token"})
        return public_response(request.url.path)

    def client(**kwargs):
        client_options.append(kwargs)
        return original_client(transport=httpx.MockTransport(transport), **kwargs)

    monkeypatch.setattr(httpx, "Client", client)
    results = online_checks(probe_api=True)
    assert all(result["ok"] for result in results)
    assert len(client_options) == 2
    assert all(option["trust_env"] is False for option in client_options)
    assert all(option["follow_redirects"] is False for option in client_options)
