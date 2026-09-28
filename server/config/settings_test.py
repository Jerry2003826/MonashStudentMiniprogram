"""Hermetic SQLite tests, or an explicitly selected disposable PostgreSQL database.

TEST_DATABASE_URL must point only to a dedicated local/CI PostgreSQL instance.
Its role needs permission to CREATE/DROP the isolated test database. Never supply
an application or production connection string here; DATABASE_URL is ignored.
"""

import os
import re
from unittest.mock import patch

from django.core.exceptions import ImproperlyConfigured

from .database import parse_database_url

# Import the ordinary settings without evaluating a real deployment connection or
# production-only requirements. Restore the process environment after the import.
with patch.dict(
    os.environ,
    {
        "DATABASE_URL": "",
        "DJANGO_DEBUG": "true",
        "DJANGO_SECRET_KEY": "test-only-key-not-for-deployment-00000000",
        "DB_POOL_MODE": "direct",
        "DB_CONN_MAX_AGE": "0",
        "WECHAT_CONTENT_SAFETY_MODE": "wechat",
    },
):
    from .settings import *  # noqa: F403

ALLOWED_HOSTS = ["testserver", "localhost", "127.0.0.1"]
DB_POOL_MODE = "direct"
DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}

_test_database_url = os.environ.get("TEST_DATABASE_URL", "").strip()
if _test_database_url:
    _test_database = parse_database_url(_test_database_url, conn_max_age=0, pool_mode="direct")
    _source_name = _test_database["NAME"]
    # Restrict names to an unambiguous ASCII identifier and reserve PostgreSQL's
    # 63-byte identifier limit for the test_ prefix. No overridable TEST.NAME can
    # accidentally make Django flush or destroy the source database.
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,57}", _source_name):
        raise ImproperlyConfigured(
            "TEST_DATABASE_URL requires a dedicated database name of 1-58 ASCII letters, "
            "digits or underscores, starting with a letter or underscore."
        )
    _test_database["TEST"] = {"NAME": f"test_{_source_name}"}
    DATABASES = {"default": _test_database}

EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
ENABLE_DEV_LOGIN = False
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}
