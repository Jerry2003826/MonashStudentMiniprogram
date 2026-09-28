import json
import os
import runpy
import subprocess
import sys
from pathlib import Path
from unittest.mock import Mock

import pytest
from django.core.management import call_command
from django.db import OperationalError
from django.test import override_settings

from config import health

BASE_DIR = Path(__file__).resolve().parent.parent


def production_process(code, **overrides):
    env = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith(("DJANGO_", "WECHAT_", "DB_", "EMAIL_"))
        and key not in {"DATABASE_URL", "ENABLE_DEV_LOGIN", "CSRF_TRUSTED_ORIGINS"}
    }
    env.update(
        DJANGO_SETTINGS_MODULE="config.settings",
        DJANGO_DEBUG="false",
        DJANGO_SECRET_KEY="configuration-test-key-" + "x" * 64,
        DJANGO_ALLOWED_HOSTS="testserver,api.example.test",
        WECHAT_APPID="test-app",
        WECHAT_APPSECRET="test-secret",
        DATABASE_URL="postgresql://unused:unused@127.0.0.1:1/unused?connect_timeout=1",
    )
    env.update(overrides)
    return subprocess.run(
        [sys.executable, "-c", code],
        env=env,
        capture_output=True,
        text=True,
        check=False,
        timeout=20,
    )


def test_production_https_defaults_without_trusting_any_proxy_header():
    result = production_process(
        "import json; from config import settings as s; "
        "print(json.dumps([s.SECURE_SSL_REDIRECT, s.SESSION_COOKIE_SECURE, "
        "s.CSRF_COOKIE_SECURE, s.SECURE_PROXY_SSL_HEADER, s.SECURE_HSTS_SECONDS, "
        "s.SECURE_HSTS_INCLUDE_SUBDOMAINS, s.SECURE_HSTS_PRELOAD]))"
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == [True, True, True, None, 3600, False, False]


def test_explicit_proxy_and_https_policy_configuration():
    result = production_process(
        "import json; from config import settings as s; "
        "print(json.dumps([s.SECURE_PROXY_SSL_HEADER, s.SECURE_SSL_REDIRECT, "
        "s.SECURE_HSTS_SECONDS, s.SECURE_HSTS_INCLUDE_SUBDOMAINS, s.SECURE_HSTS_PRELOAD]))",
        DJANGO_TRUST_PROXY_SSL_HEADER="true",
        DJANGO_SECURE_SSL_REDIRECT="false",
        DJANGO_SECURE_HSTS_SECONDS="31536000",
        DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS="true",
        DJANGO_SECURE_HSTS_PRELOAD="true",
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == [
        ["HTTP_X_FORWARDED_PROTO", "https"],
        False,
        31536000,
        True,
        True,
    ]


@pytest.mark.parametrize(
    "overrides,expected",
    [
        ({"DJANGO_TRUST_PROXY_SSL_HEADER": "perhaps"}, "must be a boolean"),
        ({"DJANGO_SECURE_SSL_REDIRECT": "invalid"}, "must be a boolean"),
        ({"DJANGO_SECURE_HSTS_SECONDS": "-1"}, "nonnegative integer"),
        ({"DJANGO_SECURE_HSTS_SECONDS": "99999999999"}, "nonnegative integer"),
        ({"DJANGO_SECURE_HSTS_SECONDS": "63072001"}, "allowed maximum"),
        ({"DJANGO_SECURE_HSTS_PRELOAD": "true"}, "HSTS preload requires"),
        ({"WECHAT_CONTENT_SAFETY_MODE": "fake"}, "Fake content safety requires"),
        ({"WECHAT_CONTENT_SAFETY_MODE": "off"}, "must be wechat or fake"),
    ],
)
def test_invalid_deployment_options_fail_before_running(overrides, expected):
    result = production_process("import config.settings", **overrides)
    assert result.returncode != 0
    assert expected in result.stderr


def test_production_docs_and_schema_are_not_public_routes():
    result = production_process(
        "import django,json; django.setup(); from django.test import Client; "
        "from apps.core.api import api; "
        "print(json.dumps([api.docs_url,api.openapi_url, "
        "Client().get('/api/v1/docs',secure=True).status_code, "
        "Client().get('/api/v1/openapi.json',secure=True).status_code]))"
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == [None, None, 404, 404]


@pytest.mark.django_db
def test_readyz_reports_migrated_database_and_prevents_caching(client):
    response = client.get("/readyz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert "no-store" in response.headers["Cache-Control"]
    assert client.head("/readyz").content == b""


@pytest.mark.django_db
def test_readyz_rejects_pending_migrations_without_running_them(client, monkeypatch):
    executor = Mock()
    executor.migration_plan.return_value = [(object(), False)]
    monkeypatch.setattr(health, "MigrationExecutor", Mock(return_value=executor))
    response = client.get("/readyz")
    assert response.status_code == 503
    assert response.json() == {"status": "unavailable"}
    executor.migrate.assert_not_called()
    executor.loader.check_consistent_history.assert_called_once()


def test_readyz_database_failure_hides_details_and_does_not_redirect(client, monkeypatch, caplog):
    secret = "postgresql://private-user:private-secret@private-host/database"
    monkeypatch.setattr(health.connection, "cursor", Mock(side_effect=OperationalError(secret)))
    with override_settings(SECURE_SSL_REDIRECT=True):
        response = client.get("/readyz")
    assert response.status_code == 503
    assert response.json() == {"status": "unavailable"}
    assert "no-store" in response.headers["Cache-Control"]
    assert secret not in response.content.decode()
    assert secret not in caplog.text
    assert "OperationalError" in caplog.text


@pytest.mark.django_db
def test_readyz_inconsistent_migration_history_is_unavailable(client, monkeypatch):
    executor = Mock()
    executor.loader.check_consistent_history.side_effect = RuntimeError("private migration data")
    monkeypatch.setattr(health, "MigrationExecutor", Mock(return_value=executor))
    response = client.get("/readyz")
    assert response.status_code == 503
    assert response.json() == {"status": "unavailable"}
    executor.migrate.assert_not_called()


def test_liveness_remains_available_without_a_database_and_does_not_redirect(client):
    with override_settings(SECURE_SSL_REDIRECT=True):
        response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_readiness_does_not_accept_post(client):
    assert client.post("/readyz").status_code == 405


def test_untrusted_forwarded_header_cannot_bypass_https_redirect(client):
    with override_settings(SECURE_SSL_REDIRECT=True, SECURE_PROXY_SSL_HEADER=None):
        response = client.get("/manage/", HTTP_X_FORWARDED_PROTO="https")
    assert response.status_code == 301
    assert response.headers["Location"] == "https://testserver/manage/"


def test_trusted_proxy_recognizes_https_and_returns_hsts(client):
    with override_settings(
        SECURE_SSL_REDIRECT=True,
        SECURE_PROXY_SSL_HEADER=("HTTP_X_FORWARDED_PROTO", "https"),
        SECURE_HSTS_SECONDS=3600,
        SECURE_HSTS_INCLUDE_SUBDOMAINS=False,
        SECURE_HSTS_PRELOAD=False,
    ):
        response = client.get("/healthz", HTTP_X_FORWARDED_PROTO="https")
    assert response.status_code == 200
    assert response.headers["Strict-Transport-Security"] == "max-age=3600"


@pytest.mark.django_db
def test_static_collection_and_whitenoise_serve_hashed_production_assets(client, tmp_path):
    with override_settings(
        DEBUG=False,
        STATIC_ROOT=tmp_path,
        SECURE_SSL_REDIRECT=True,
        STORAGES={
            "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"}
        },
    ):
        call_command("collectstatic", interactive=False, verbosity=0)
        from django.contrib.staticfiles.storage import staticfiles_storage

        url = staticfiles_storage.url("portal/portal.css")
        assert url.startswith("/static/portal/portal.") and url != "/static/portal/portal.css"
        response = client.get(url, secure=True)
        assert response.status_code == 200
        assert response.headers["Content-Type"].startswith("text/css")
        assert "immutable" in response.headers["Cache-Control"]
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        response.close()


def test_collectstatic_build_settings_do_not_load_application_secrets_or_database():
    result = production_process(
        "import django,json; django.setup(); from django.conf import settings as s; "
        "print(json.dumps([s.INSTALLED_APPS, s.DATABASES, s.STORAGES['staticfiles']['BACKEND']]))",
        DJANGO_SETTINGS_MODULE="config.settings_build",
        DJANGO_SECRET_KEY="",
        WECHAT_APPID="",
        WECHAT_APPSECRET="",
        DATABASE_URL="not-a-real-url",
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == [
        ["django.contrib.staticfiles"],
        {},
        "whitenoise.storage.CompressedManifestStaticFilesStorage",
    ]


def test_gunicorn_configuration_is_portable_and_does_not_log_query_strings(monkeypatch):
    monkeypatch.setenv("PORT", "8080")
    monkeypatch.setenv("WEB_CONCURRENCY", "3")
    monkeypatch.setenv("GUNICORN_THREADS", "4")
    monkeypatch.setenv("GUNICORN_TIMEOUT", "45")
    config = runpy.run_path(str(BASE_DIR / "gunicorn.conf.py"))
    assert config["bind"] == "0.0.0.0:8080"
    assert config["workers"] == 3 and config["threads"] == 4 and config["timeout"] == 45
    assert config["forwarded_allow_ips"] == "" and config["secure_scheme_headers"] == {}
    assert "%(U)s" in config["access_log_format"]
    for unsafe in ["%(r)s", "%(q)s", "%(f)s", "authorization"]:
        assert unsafe not in config["access_log_format"]


@pytest.mark.parametrize("port", ["0", "65536", "invalid", "1;echo secret"])
def test_gunicorn_rejects_invalid_port_without_echoing_value(monkeypatch, port):
    monkeypatch.setenv("PORT", port)
    with pytest.raises(ValueError, match="PORT") as exc:
        runpy.run_path(str(BASE_DIR / "gunicorn.conf.py"))
    assert port not in str(exc.value)


def test_container_entrypoint_refuses_build_settings_in_runtime():
    result = subprocess.run(
        ["sh", str(BASE_DIR / "docker-entrypoint.sh")],
        env={**os.environ, "DJANGO_SETTINGS_MODULE": "config.settings_build"},
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 1
    assert "requires config.settings" in result.stderr


@pytest.mark.parametrize("flag", ["DJANGO_DEBUG", "ENABLE_DEV_LOGIN"])
def test_container_entrypoint_refuses_debug_and_demo_login(flag):
    result = subprocess.run(
        ["sh", str(BASE_DIR / "docker-entrypoint.sh")],
        env={
            **os.environ,
            "PATH": str(Path(sys.executable).parent) + os.pathsep + os.environ.get("PATH", ""),
            "DJANGO_SETTINGS_MODULE": "config.settings",
            flag: "true",
        },
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode != 0
    assert "requires DJANGO_DEBUG=false and ENABLE_DEV_LOGIN=false" in result.stderr
