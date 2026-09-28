"""Portable PostgreSQL configuration with no provider SDK or network access."""

import ipaddress
import re
from collections.abc import Mapping
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlsplit

from django.core.exceptions import ImproperlyConfigured

POOL_MODES = {"direct", "session", "transaction"}
SSL_MODES = {"disable", "allow", "prefer", "require", "verify-ca", "verify-full"}
QUERY_OPTIONS = {"sslmode", "sslrootcert", "connect_timeout", "host"}


def _invalid(message: str) -> ImproperlyConfigured:
    # Messages must never include a supplied URL, hostname, credentials or query value.
    return ImproperlyConfigured(message)


def _has_control(value: str) -> bool:
    return any(ord(character) < 32 or ord(character) == 127 for character in value)


def _integer(value: str | int, name: str, *, minimum: int, maximum: int = 2_147_483_647) -> int:
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise _invalid(f"{name} must be an integer.")
    text = str(value).strip()
    if len(text) > 10 or not re.fullmatch(r"[0-9]+", text):
        raise _invalid(f"{name} must be an integer.")
    result = int(text)
    if not minimum <= result <= maximum:
        raise _invalid(f"{name} is outside the supported range.")
    return result


def validate_pool_mode(value: str) -> str:
    if not isinstance(value, str) or value.strip().lower() not in POOL_MODES:
        raise _invalid("DB_POOL_MODE must be direct, session, or transaction.")
    return value.strip().lower()


def _decode(value: str) -> str:
    if re.search(r"%(?![0-9a-fA-F]{2})", value):
        raise _invalid("DATABASE_URL contains invalid percent encoding.")
    try:
        decoded = unquote(value, encoding="utf-8", errors="strict")
    except UnicodeError:
        raise _invalid("DATABASE_URL contains invalid percent encoding.") from None
    if "\x00" in decoded:
        raise _invalid("DATABASE_URL contains an invalid character.")
    return decoded


def _hostname(value: str) -> str:
    value = _decode(value)
    if _has_control(value):
        raise _invalid("DATABASE_URL requires a valid hostname.")
    try:
        ipaddress.ip_address(value)
    except ValueError:
        try:
            ascii_name = value.encode("idna").decode("ascii")
        except UnicodeError:
            raise _invalid("DATABASE_URL requires a valid hostname.") from None
        labels = ascii_name.rstrip(".").split(".")
        if len(ascii_name) > 253 or not all(
            re.fullmatch(r"[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?", label)
            for label in labels
        ):
            raise _invalid("DATABASE_URL requires one valid hostname.") from None
        return ascii_name.lower()
    return value


def _is_loopback(host: str) -> bool:
    if host.lower().rstrip(".") == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def parse_database_url(
    database_url: str,
    *,
    conn_max_age: str | int = 60,
    pool_mode: str = "direct",
) -> dict:
    """Return one Django PostgreSQL database entry; reject ambiguous/unsafe settings.

    A socket URL may omit the authority hostname, for example:
    postgresql://user:password@:5432/database?host=%2Fcloudsql%2Finstance&sslmode=disable
    """
    max_age = _integer(conn_max_age, "DB_CONN_MAX_AGE", minimum=0)
    mode = validate_pool_mode(pool_mode)
    if not isinstance(database_url, str) or not database_url or _has_control(database_url):
        raise _invalid("DATABASE_URL must be a valid PostgreSQL URL.")
    if database_url != database_url.strip():
        raise _invalid("DATABASE_URL must not contain surrounding whitespace.")
    try:
        parsed = urlsplit(database_url)
        uri_host = parsed.hostname
        uri_port = parsed.port
        uri_user = parsed.username
        uri_password = parsed.password
    except ValueError:
        raise _invalid("DATABASE_URL has an invalid authority or port.") from None
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise _invalid("DATABASE_URL must use postgres or postgresql.")
    if "#" in database_url:
        raise _invalid("DATABASE_URL cannot contain a fragment; percent-encode credentials.")
    if not parsed.path.startswith("/") or not parsed.path[1:] or "/" in parsed.path[1:]:
        raise _invalid("DATABASE_URL requires one database name.")
    database_name = _decode(parsed.path[1:])
    if not database_name or _has_control(database_name) or len(database_name.encode("utf-8")) > 63:
        raise _invalid("DATABASE_URL database name is empty or exceeds PostgreSQL limits.")
    if parsed.netloc.rsplit("@", 1)[-1].endswith(":"):
        raise _invalid("DATABASE_URL port cannot be empty.")
    port = _integer(
        uri_port if uri_port is not None else 5432, "DATABASE_URL port", minimum=1, maximum=65535
    )

    # Validate percent escapes before parse_qsl decodes them, including encoded option names.
    _decode(parsed.query)
    try:
        pairs = parse_qsl(
            parsed.query,
            keep_blank_values=True,
            strict_parsing=True,
            encoding="utf-8",
            errors="strict",
            max_num_fields=8,
        )
    except (ValueError, UnicodeError):
        raise _invalid("DATABASE_URL query options are malformed.") from None
    options = {}
    for key, value in pairs:
        if key not in QUERY_OPTIONS:
            raise _invalid("Unsupported DATABASE_URL option.")
        if key in options:
            raise _invalid("DATABASE_URL options must not be repeated.")
        if not value or _has_control(value):
            raise _invalid("DATABASE_URL options cannot be empty or contain control characters.")
        options[key] = value

    socket_path = options.pop("host", None)
    if socket_path is not None:
        if not socket_path.startswith("/"):
            raise _invalid("DATABASE_URL host query must be an absolute Unix socket directory.")
        if uri_host and _hostname(uri_host).lower().rstrip(".") != "localhost":
            raise _invalid("DATABASE_URL cannot combine a remote hostname with a Unix socket.")
        host = socket_path
        local_connection = True
    else:
        if not uri_host:
            raise _invalid("DATABASE_URL requires an explicit hostname or Unix socket directory.")
        host = _hostname(uri_host)
        local_connection = _is_loopback(host)

    sslmode = options.pop("sslmode", "require")
    if sslmode not in SSL_MODES:
        raise _invalid("DATABASE_URL sslmode is not supported.")
    if not local_connection and sslmode in {"disable", "allow", "prefer"}:
        raise _invalid("Remote PostgreSQL requires sslmode=require, verify-ca, or verify-full.")
    connect_timeout = _integer(options.pop("connect_timeout", "5"), "connect_timeout", minimum=1)
    sslrootcert = options.pop("sslrootcert", None)
    if sslrootcert is not None:
        if not sslrootcert.startswith("/") and sslrootcert != "system":
            raise _invalid("sslrootcert must be an absolute certificate path or system.")
        if sslmode == "disable":
            raise _invalid("sslrootcert cannot be combined with sslmode=disable.")

    connection_options = {"connect_timeout": connect_timeout, "sslmode": sslmode}
    if sslrootcert is not None:
        connection_options["sslrootcert"] = sslrootcert
    config = {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": database_name,
        "USER": _decode(uri_user or ""),
        "PASSWORD": _decode(uri_password or ""),
        "HOST": host,
        "PORT": port,
        "OPTIONS": connection_options,
        "CONN_MAX_AGE": max_age,
        "CONN_HEALTH_CHECKS": True,
    }
    if mode == "transaction":
        config["DISABLE_SERVER_SIDE_CURSORS"] = True
        connection_options["prepare_threshold"] = None
    return config


def build_databases(environ: Mapping[str, str], *, debug: bool, base_dir: Path) -> dict:
    """Build DATABASES from explicit environment input, with SQLite only in DEBUG."""
    max_age = _integer(environ.get("DB_CONN_MAX_AGE", "60"), "DB_CONN_MAX_AGE", minimum=0)
    mode = validate_pool_mode(environ.get("DB_POOL_MODE", "direct"))
    database_url = environ.get("DATABASE_URL", "")
    if database_url:
        return {"default": parse_database_url(database_url, conn_max_age=max_age, pool_mode=mode)}
    if not debug:
        raise _invalid("Production requires a PostgreSQL DATABASE_URL.")
    local_directory = Path(base_dir) / "var"
    local_directory.mkdir(exist_ok=True)
    return {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": local_directory / "db.sqlite3",
            "OPTIONS": {"timeout": 20},
        }
    }
