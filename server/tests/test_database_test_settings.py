"""Import-only safety checks: these tests never open a database connection."""

import json
import os
import subprocess
import sys

import pytest


def import_test_settings(overrides):
    env = {
        key: value
        for key, value in os.environ.items()
        if key
        not in {
            "DATABASE_URL",
            "TEST_DATABASE_URL",
            "DB_POOL_MODE",
            "DB_CONN_MAX_AGE",
            "DJANGO_DEBUG",
            "WECHAT_CONTENT_SAFETY_MODE",
        }
    }
    env.update(overrides)
    return subprocess.run(
        [
            sys.executable,
            "-c",
            "import json, os; import config.settings_test as s; "
            "db = s.DATABASES['default']; "
            "print(json.dumps({'engine': db['ENGINE'], 'name': str(db['NAME']), "
            "'test': db.get('TEST'), 'max_age': db.get('CONN_MAX_AGE'), "
            "'host': db.get('HOST'), 'port': db.get('PORT'), "
            "'pool_mode': s.DB_POOL_MODE, 'debug': s.DEBUG, "
            "'external_url_unchanged': os.environ.get('DATABASE_URL') == "
            "os.environ.get('EXPECTED_DATABASE_URL')}))",
        ],
        env=env,
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )


def test_default_database_is_in_memory_sqlite():
    result = import_test_settings({})
    assert result.returncode == 0, result.stderr
    data = json.loads(result.stdout)
    assert data["engine"] == "django.db.backends.sqlite3"
    assert data["name"] == ":memory:"


@pytest.mark.parametrize(
    "live_url",
    [
        "postgresql://live:private@live.example.invalid/application",
        "sqlite:///must-not-open.sqlite3",
        "an invalid deployment URL which must never be parsed",
    ],
)
def test_real_database_url_and_production_environment_are_ignored(live_url):
    result = import_test_settings(
        {
            "DATABASE_URL": live_url,
            "EXPECTED_DATABASE_URL": live_url,
            "DJANGO_DEBUG": "false",
            "DB_POOL_MODE": "invalid-production-value",
            "DB_CONN_MAX_AGE": "invalid-production-value",
            "WECHAT_CONTENT_SAFETY_MODE": "invalid-production-value",
        }
    )
    assert result.returncode == 0, result.stderr
    data = json.loads(result.stdout)
    assert data["engine"] == "django.db.backends.sqlite3"
    assert data["name"] == ":memory:"
    assert data["debug"] is True
    assert data["pool_mode"] == "direct"
    assert data["external_url_unchanged"] is True


def test_postgres_requires_explicit_opt_in_and_gets_a_separate_test_database():
    result = import_test_settings(
        {
            "DATABASE_URL": "must-not-be-parsed",
            "TEST_DATABASE_URL": "postgresql://ci:disposable@127.0.0.1:5432/mnp_ci?sslmode=disable",
        }
    )
    assert result.returncode == 0, result.stderr
    data = json.loads(result.stdout)
    assert data["engine"] == "django.db.backends.postgresql"
    assert data["name"] == "mnp_ci"
    assert data["test"] == {"NAME": "test_mnp_ci"}
    assert data["test"]["NAME"] != data["name"]
    assert data["max_age"] == 0
    assert data["pool_mode"] == "direct"


def test_explicit_socket_postgres_url_is_supported_without_tcp():
    result = import_test_settings(
        {
            "TEST_DATABASE_URL": "postgresql://ci@:55439/mnp_ci?host=%2Ftmp%2Fmnp-pg&sslmode=disable",
        }
    )
    assert result.returncode == 0, result.stderr
    data = json.loads(result.stdout)
    assert data["host"] == "/tmp/mnp-pg"
    assert str(data["port"]) == "55439"
    assert data["test"] == {"NAME": "test_mnp_ci"}


@pytest.mark.parametrize(
    "database_name", ["a" * 59, "unsafe%20name", "unsafe%0Aname", "1starts_digit"]
)
def test_unsafe_or_truncated_test_database_names_fail_closed(database_name):
    result = import_test_settings(
        {
            "TEST_DATABASE_URL": f"postgresql://ci:disposable@127.0.0.1/{database_name}?sslmode=disable",
        }
    )
    assert result.returncode != 0
    assert "ImproperlyConfigured" in result.stderr


def test_non_postgres_opt_in_does_not_silently_fall_back_to_sqlite():
    result = import_test_settings({"TEST_DATABASE_URL": "sqlite:///production.sqlite3"})
    assert result.returncode != 0
    assert "ImproperlyConfigured" in result.stderr
