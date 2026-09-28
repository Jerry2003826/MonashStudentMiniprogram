import traceback
from urllib.parse import quote

import pytest
from django.core.exceptions import ImproperlyConfigured

from config.database import build_databases, parse_database_url, validate_pool_mode

REMOTE_URL = "postgresql://app:password@db.example.org:5432/student_union"


def test_remote_default_tls_connection_health_and_lifetime():
    database = parse_database_url(REMOTE_URL)
    assert database == {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": "student_union",
        "USER": "app",
        "PASSWORD": "password",
        "HOST": "db.example.org",
        "PORT": 5432,
        "OPTIONS": {"connect_timeout": 5, "sslmode": "require"},
        "CONN_MAX_AGE": 60,
        "CONN_HEALTH_CHECKS": True,
    }


def test_credentials_percent_decoded_once_and_literal_plus_retained():
    username = "app.user@project"
    password = "a:b/c?d#e%f+g"
    url = (
        f"postgresql://{quote(username, safe='')}:{quote(password, safe='')}"
        "@db.example.org/database"
    )
    database = parse_database_url(url)
    assert database["USER"] == username
    assert database["PASSWORD"] == password
    assert parse_database_url("postgres://u:p+q@db.example.org/a")["PASSWORD"] == "p+q"
    assert parse_database_url("postgres://u:p%252Fq@db.example.org/a")["PASSWORD"] == "p%2Fq"


def test_database_name_and_ipv6_host():
    database = parse_database_url("postgresql://u:p@[2001:db8::1]:5544/student%20union")
    assert database["NAME"] == "student union"
    assert database["HOST"] == "2001:db8::1"
    assert database["PORT"] == 5544
    assert database["OPTIONS"]["sslmode"] == "require"


@pytest.mark.parametrize("mode", ["direct", "session"])
def test_direct_and_session_keep_normal_cursor_and_preparation_behavior(mode):
    database = parse_database_url(REMOTE_URL, pool_mode=mode, conn_max_age="120")
    assert database["CONN_MAX_AGE"] == 120
    assert "DISABLE_SERVER_SIDE_CURSORS" not in database
    assert "prepare_threshold" not in database["OPTIONS"]
    assert "options" not in database["OPTIONS"]


def test_transaction_mode_disables_both_incompatible_features_without_session_overrides():
    database = parse_database_url(REMOTE_URL, pool_mode="transaction", conn_max_age=0)
    assert database["DISABLE_SERVER_SIDE_CURSORS"] is True
    assert database["OPTIONS"]["prepare_threshold"] is None
    assert database["CONN_MAX_AGE"] == 0
    assert database["CONN_HEALTH_CHECKS"] is True
    assert set(database["OPTIONS"]) == {"sslmode", "connect_timeout", "prepare_threshold"}


def test_verified_tls_ca_and_timeout_options_are_forwarded_as_safe_types():
    database = parse_database_url(
        REMOTE_URL
        + "?sslmode=verify-full&sslrootcert=%2Frun%2Fsecrets%2Fdatabase-ca.pem&connect_timeout=12"
    )
    assert database["OPTIONS"] == {
        "sslmode": "verify-full",
        "sslrootcert": "/run/secrets/database-ca.pem",
        "connect_timeout": 12,
    }


@pytest.mark.parametrize("host", ["localhost", "localhost.", "127.0.0.1", "127.0.0.2", "[::1]"])
def test_explicit_loopback_can_disable_tls(host):
    database = parse_database_url(f"postgresql://user:password@{host}/database?sslmode=disable")
    assert database["OPTIONS"]["sslmode"] == "disable"
    assert database["PORT"] == 5432


@pytest.mark.parametrize("authority", ["user:pass@", "user:pass@localhost", "user@", ""])
def test_cloudsql_unix_socket_directory_is_taken_from_query(authority):
    socket = "/cloudsql/example-project:australia-southeast1:student-union"
    database = parse_database_url(
        f"postgresql://{authority}/database?host={quote(socket, safe='')}&sslmode=disable"
    )
    assert database["HOST"] == socket
    assert database["OPTIONS"] == {"sslmode": "disable", "connect_timeout": 5}
    assert "host" not in database["OPTIONS"]


def test_unix_socket_preserves_explicit_nondefault_port_without_hostname():
    database = parse_database_url(
        "postgresql://migration_check@:55439/migration_tests?host=%2Ftmp%2Fprivate-pg&sslmode=disable"
    )
    assert database["HOST"] == "/tmp/private-pg"
    assert database["PORT"] == 55439
    assert database["USER"] == "migration_check"


def test_build_databases_reads_environment_without_mutating_it(tmp_path):
    env = {"DATABASE_URL": REMOTE_URL, "DB_POOL_MODE": "transaction", "DB_CONN_MAX_AGE": "15"}
    saved = dict(env)
    database = build_databases(env, debug=False, base_dir=tmp_path)["default"]
    assert database["CONN_MAX_AGE"] == 15
    assert database["DISABLE_SERVER_SIDE_CURSORS"] is True
    assert env == saved
    assert not (tmp_path / "var").exists()


def test_only_explicit_debug_allows_legacy_sqlite_fallback(tmp_path):
    database = build_databases({}, debug=True, base_dir=tmp_path)["default"]
    assert database == {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": tmp_path / "var" / "db.sqlite3",
        "OPTIONS": {"timeout": 20},
    }
    assert (tmp_path / "var").is_dir()
    with pytest.raises(ImproperlyConfigured, match="PostgreSQL"):
        build_databases({}, debug=False, base_dir=tmp_path)


@pytest.mark.parametrize(
    "url",
    [
        "sqlite:///database",
        "mysql://u:p@db.example.org/database",
        "postgresql://u:p@db.example.org",
        "postgresql://u:p@db.example.org/",
        "postgresql://u:p@db.example.org/database/other",
        "postgresql://u:p@/database",
        "postgresql://u:p@db.example.org:0/database",
        "postgresql://u:p@db.example.org:65536/database",
        "postgresql://u:p@db.example.org:abc/database",
        "postgresql://u:p@db.example.org:/database",
        "postgresql://u:p@[bad-ipv6]/database",
        "postgresql://u:p@bad,other/database",
        "postgresql://u:p@db.example.org/database#fragment",
        "postgresql://u:p@db.example.org/database#",
        " postgres://u:p@db.example.org/database",
        "postgres://u:p@db.example.org/data\nbase",
        "postgresql://u:p%00word@db.example.org/database",
        "postgresql://u:p%ZZword@db.example.org/database",
        "postgresql://u:p%FFword@db.example.org/database",
        "postgresql://u:p@db.example.org/data%00base",
        "postgresql://u:p@db.example.org/" + "x" * 64,
    ],
)
def test_rejects_malformed_url_authority_credentials_name_and_port(url):
    with pytest.raises(ImproperlyConfigured):
        parse_database_url(url)


@pytest.mark.parametrize(
    "query",
    [
        "sslmode=disable",
        "sslmode=prefer",
        "sslmode=allow",
        "sslmode=unknown",
        "sslmode=",
        "sslmode=require&sslmode=verify-full",
        "options=-csearch_path%3Dprivate",
        "prepare_threshold=0",
        "pool=true",
        "connect_timeout=0",
        "connect_timeout=-1",
        "connect_timeout=1.5",
        "connect_timeout=forever",
        "connect_timeout=99999999999",
        "sslrootcert=relative.pem",
        "sslrootcert=",
        "host=db.example.org",
        "host=relative/socket",
        "host=%2Ftmp%2Fsocket",
        "sslmode",
        "sslmode=require&",
        "connect_timeout=%ZZ",
        "sslmode=require&%73slmode=require",
        "host=%2Ftmp%0Asocket",
    ],
)
def test_rejects_unsafe_unknown_duplicate_and_invalid_query_options(query):
    with pytest.raises(ImproperlyConfigured):
        parse_database_url(REMOTE_URL + "?" + query)


@pytest.mark.parametrize("value", [True, -1, "-1", "1.5", "forever", "", "99999999999", None])
def test_connection_lifetime_requires_a_nonnegative_integer(value):
    with pytest.raises(ImproperlyConfigured, match="DB_CONN_MAX_AGE"):
        parse_database_url(REMOTE_URL, conn_max_age=value)


@pytest.mark.parametrize("value", ["", "pool", "statement", "auto", None])
def test_invalid_pool_mode_rejected(value):
    with pytest.raises(ImproperlyConfigured, match="DB_POOL_MODE"):
        parse_database_url(REMOTE_URL, pool_mode=value)


def test_pool_mode_normalization_is_shared_with_settings():
    assert validate_pool_mode(" Session ") == "session"


def test_configuration_errors_do_not_disclose_original_url_or_credentials():
    secret = "uniquely-sensitive-password-marker"
    urls = [
        f"postgresql://u:{secret}@db.example.org:bad/database",
        f"postgresql://u:{secret}@[broken/database",
        f"postgresql://u:{secret}@db.example.org/db?sslmode=bogus",
        f"postgresql://u:{secret}@db.example.org/db?unknown={secret}",
        f"postgresql://u:{secret}@invalid,host/db",
    ]
    for url in urls:
        with pytest.raises(ImproperlyConfigured) as captured:
            parse_database_url(url)
        diagnostic = "".join(traceback.format_exception(captured.value))
        assert secret not in diagnostic
        assert url not in diagnostic
