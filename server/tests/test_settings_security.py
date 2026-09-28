import os
import subprocess
import sys

import pytest


def settings_import(overrides):
    env = {
        key: value
        for key, value in os.environ.items()
        if key
        not in {
            "DJANGO_DEBUG",
            "DJANGO_SECRET_KEY",
            "DJANGO_ALLOWED_HOSTS",
            "WECHAT_APPID",
            "WECHAT_APPSECRET",
            "WECHAT_CONTENT_SAFETY_MODE",
            "ENABLE_DEV_LOGIN",
            "DATABASE_URL",
            "DB_POOL_MODE",
            "DB_CONN_MAX_AGE",
            "EMAIL_BACKEND",
            "DJANGO_TRUST_PROXY_SSL_HEADER",
            "DJANGO_SECURE_SSL_REDIRECT",
            "DJANGO_SECURE_HSTS_SECONDS",
            "DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS",
            "DJANGO_SECURE_HSTS_PRELOAD",
        }
    }
    env.update(overrides)
    return subprocess.run(
        [sys.executable, "-c", "import config.settings"],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


PRODUCTION = {
    "DJANGO_DEBUG": "false",
    "DJANGO_SECRET_KEY": "production-test-key-" + "x" * 64,
    "DJANGO_ALLOWED_HOSTS": "api.example.test",
    "WECHAT_APPID": "test-app",
    "WECHAT_APPSECRET": "test-secret",
    "DATABASE_URL": "postgresql://test:test@localhost/test",
}


@pytest.mark.parametrize(
    "overrides,expected",
    [
        ({}, "DJANGO_SECRET_KEY"),
        ({"DJANGO_SECRET_KEY": "x" * 64}, "WECHAT_APPID"),
        ({**PRODUCTION, "ENABLE_DEV_LOGIN": "true"}, "ENABLE_DEV_LOGIN"),
        ({**PRODUCTION, "DATABASE_URL": ""}, "PostgreSQL"),
        ({**PRODUCTION, "DATABASE_URL": "sqlite:///var/db.sqlite3"}, "postgres"),
        ({**PRODUCTION, "EMAIL_BACKEND": "django.core.mail.backends.console.EmailBackend"}, "SMTP"),
        ({**PRODUCTION, "DJANGO_ALLOWED_HOSTS": "*"}, "ALLOWED_HOSTS"),
    ],
)
def test_production_configuration_fails_closed(overrides, expected):
    result = settings_import(overrides)
    assert result.returncode != 0
    assert expected in result.stderr


def test_complete_production_configuration_can_import_without_contacting_services():
    assert settings_import(PRODUCTION).returncode == 0
