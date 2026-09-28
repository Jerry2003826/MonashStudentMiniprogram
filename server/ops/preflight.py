"""Staging configuration and optional read-only service probes. Never print secrets."""

import argparse
import ipaddress
import json
import os
import re
import sys
from email.utils import parseaddr
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

from config.database import parse_database_url

FALSE_VALUES = {"false", "0", "no"}
TRUE_VALUES = {"true", "1", "yes"}
PLACEHOLDER = re.compile(r"replace|change[_-]?me|example|test-only|django-insecure|synthetic", re.I)


def configured(value):
    return bool(value and value.strip() and not PLACEHOLDER.search(value))


def configuration_issues(env, project_config):
    """Return fixed descriptions only; supplied values never become error messages."""
    issues = []
    for key in ("DJANGO_DEBUG", "ENABLE_DEV_LOGIN"):
        if env.get(key, "").lower() not in FALSE_VALUES:
            issues.append(f"{key} must explicitly be false for a shared trial.")
    if env.get("DJANGO_SETTINGS_MODULE", "config.settings") != "config.settings":
        issues.append("DJANGO_SETTINGS_MODULE must be config.settings.")
    if env.get("WECHAT_CONTENT_SAFETY_MODE", "wechat") != "wechat":
        issues.append("The shared trial must use real WeChat content safety checks.")
    secret = env.get("DJANGO_SECRET_KEY", "")
    if not configured(secret) or len(secret) < 50 or len(set(secret)) < 5:
        issues.append("DJANGO_SECRET_KEY must be a unique random secret of at least 50 characters.")
    appid = env.get("WECHAT_APPID", "")
    if not re.fullmatch(r"wx[0-9a-fA-F]{16}", appid):
        issues.append("WECHAT_APPID must be a real Mini Program app id.")
    try:
        expected_appid = json.loads(Path(project_config).read_text())["appid"]
        if appid != expected_appid:
            issues.append("WECHAT_APPID differs from the Mini Program project configuration.")
    except (OSError, ValueError, KeyError, TypeError):
        issues.append("Cannot read the Mini Program project configuration to verify its app id.")
    if not configured(env.get("WECHAT_APPSECRET", "")) or not re.fullmatch(
        r"[0-9a-zA-Z]{32}", env.get("WECHAT_APPSECRET", "")
    ):
        issues.append("WECHAT_APPSECRET is missing or still a placeholder.")
    try:
        parse_database_url(
            env.get("DATABASE_URL", ""),
            conn_max_age=env.get("DB_CONN_MAX_AGE", "0"),
            pool_mode=env.get("DB_POOL_MODE", "direct"),
        )
        if PLACEHOLDER.search(env["DATABASE_URL"]):
            issues.append("DATABASE_URL still contains placeholder values.")
    except Exception:
        issues.append("DATABASE_URL or its connection options are missing or invalid.")
    for key in ("EMAIL_HOST", "EMAIL_HOST_USER", "EMAIL_HOST_PASSWORD", "DEFAULT_FROM_EMAIL"):
        if not configured(env.get(key, "")):
            issues.append(f"{key} is missing or still a placeholder.")
    sender = parseaddr(env.get("DEFAULT_FROM_EMAIL", ""))[1]
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", sender):
        issues.append("DEFAULT_FROM_EMAIL must identify the configured sender address.")
    if env.get("EMAIL_BACKEND", "django.core.mail.backends.smtp.EmailBackend") != (
        "django.core.mail.backends.smtp.EmailBackend"
    ):
        issues.append("The shared trial must use the SMTP email backend.")
    tls = env.get("EMAIL_USE_TLS", "true").lower() in TRUE_VALUES
    ssl = env.get("EMAIL_USE_SSL", "false").lower() in TRUE_VALUES
    if tls == ssl:
        issues.append("Enable exactly one of EMAIL_USE_TLS or EMAIL_USE_SSL.")
    try:
        if not 1 <= int(env.get("EMAIL_PORT", "587")) <= 65535:
            raise ValueError
    except ValueError:
        issues.append("EMAIL_PORT must be a valid TCP port.")
    origin = env.get("PUBLIC_API_ORIGIN", "")
    try:
        url = urlsplit(origin)
        public = (
            url.scheme == "https"
            and url.hostname
            and "." in url.hostname
            and url.hostname not in {"localhost", "127.0.0.1"}
            and not url.hostname.endswith((".local", ".test", ".invalid", ".example"))
            and not PLACEHOLDER.search(url.hostname)
            and url.port in (None, 443)
            and not url.username
            and not url.password
            and not url.query
            and not url.fragment
            and url.path in ("", "/")
        )
        if not public:
            raise ValueError
        try:
            ipaddress.ip_address(url.hostname)
        except ValueError:
            pass
        else:
            raise ValueError
        hosts = {value.strip() for value in env.get("DJANGO_ALLOWED_HOSTS", "").split(",")}
        if "*" in hosts or url.hostname not in hosts:
            issues.append("DJANGO_ALLOWED_HOSTS must explicitly include the public API hostname.")
        origins = {value.strip() for value in env.get("CSRF_TRUSTED_ORIGINS", "").split(",")}
        if origin.rstrip("/") not in origins:
            issues.append("CSRF_TRUSTED_ORIGINS must include the public HTTPS origin.")
    except ValueError:
        issues.append("PUBLIC_API_ORIGIN must be the real public HTTPS origin without a path.")
    if env.get("DJANGO_SECURE_SSL_REDIRECT", "true").lower() not in TRUE_VALUES:
        issues.append("DJANGO_SECURE_SSL_REDIRECT must remain enabled for the shared trial.")
    if env.get("DJANGO_TRUST_PROXY_SSL_HEADER", "false").strip().lower() not in TRUE_VALUES:
        issues.append(
            "The container trial requires DJANGO_TRUST_PROXY_SSL_HEADER=true behind a trusted "
            "HTTPS ingress that replaces client-supplied X-Forwarded-Proto headers."
        )
    return issues


def _named_record(value):
    return (
        isinstance(value, dict)
        and type(value.get("id")) is int
        and value["id"] > 0
        and isinstance(value.get("name"), str)
    )


def _home_schema(payload):
    if not isinstance(payload, dict) or not all(
        isinstance(payload.get(key), list) for key in ("banners", "featured_merchants")
    ):
        return False
    for banner in payload["banners"]:
        if not (
            isinstance(banner, dict)
            and type(banner.get("id")) is int
            and banner["id"] > 0
            and isinstance(banner.get("title"), str)
            and isinstance(banner.get("image_url"), str)
            and isinstance(banner.get("link_type"), str)
            and banner.get("link_type") in {"none", "merchant", "post"}
            and "link_id" in banner
            and (
                banner["link_id"] is None
                or (type(banner["link_id"]) is int and banner["link_id"] > 0)
            )
        ):
            return False
    return all(
        _named_record(merchant)
        and isinstance(merchant.get("logo_url"), str)
        and isinstance(merchant.get("discount_summary"), str)
        and type(merchant.get("is_example")) is bool
        and _named_record(merchant.get("category"))
        and _named_record(merchant.get("area"))
        for merchant in payload["featured_merchants"]
    )


class _PortalLoginSchema(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_pairing_form = False
        self.has_pairing_csrf = False

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "form":
            self.in_pairing_form = (
                attributes.get("id") == "pairing-create"
                and (attributes.get("method") or "").lower() == "post"
                and attributes.get("action") == "/manage/login/challenge/"
            )
        if tag == "input" and self.in_pairing_form:
            self.has_pairing_csrf |= (
                attributes.get("name") == "csrfmiddlewaretoken"
                and attributes.get("type") == "hidden"
                and bool(attributes.get("value"))
            )

    def handle_endtag(self, tag):
        if tag == "form":
            self.in_pairing_form = False


def probe_public_api(client, origin):
    """Check health plus actual application routes without following any redirect."""
    origin = origin.rstrip("/")
    for path in ("/healthz", "/readyz"):
        response = client.get(origin + path, follow_redirects=False)
        if response.status_code != 200 or response.json() != {"status": "ok"}:
            raise RuntimeError("Public health or readiness probe failed.")

    response = client.get(origin + "/api/v1/home", follow_redirects=False)
    if response.status_code != 200 or not _home_schema(response.json()):
        raise RuntimeError("Public application response does not match the home API.")

    # /manage/ correctly redirects anonymous visitors to /manage/login/. Probe
    # that actual login page directly so a TLS redirect loop cannot look healthy.
    response = client.get(origin + "/manage/login/", follow_redirects=False)
    if (
        response.status_code != 200
        or response.headers.get("content-type", "").split(";")[0].strip().lower() != "text/html"
    ):
        raise RuntimeError("Public portal login probe failed.")
    page = _PortalLoginSchema()
    page.feed(response.text)
    if not page.has_pairing_csrf:
        raise RuntimeError("Public portal response does not match the login page.")


def online_checks(*, probe_api=False, check_owner=False):
    import django

    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    django.setup()
    from django.conf import settings
    from django.core.mail import get_connection
    from django.db import connection
    from django.db.migrations.executor import MigrationExecutor

    results = []

    def probe(name, operation):
        try:
            operation()
            results.append({"check": name, "ok": True})
        except Exception as error:
            results.append({"check": name, "ok": False, "error_type": type(error).__name__})

    def database():
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            if cursor.fetchone() != (1,):
                raise RuntimeError
        executor = MigrationExecutor(connection)
        if executor.migration_plan(executor.loader.graph.leaf_nodes()):
            raise RuntimeError("Apply the release's migrations before inviting testers.")

    def smtp():
        with get_connection() as mail:
            mail.open()
            code, _message = mail.connection.noop()
            if code != 250:
                raise RuntimeError

    def wechat():
        # Validate app credentials without sending user text or a login code.
        import httpx

        with httpx.Client(timeout=10, follow_redirects=False, trust_env=False) as client:
            response = client.post(
                "https://api.weixin.qq.com/cgi-bin/stable_token",
                json={
                    "grant_type": "client_credential",
                    "appid": settings.WECHAT_APPID,
                    "secret": settings.WECHAT_APPSECRET,
                    "force_refresh": False,
                },
            )
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict) or not payload.get("access_token"):
                raise RuntimeError

    def api():
        import httpx

        origin = os.environ["PUBLIC_API_ORIGIN"].rstrip("/")
        with httpx.Client(timeout=15, follow_redirects=False, trust_env=False) as client:
            probe_public_api(client, origin)

    def owner():
        from apps.core.models import StaffAccount

        if (
            not StaffAccount.objects.filter(
                role="owner", is_active=True, user__is_active=True, user__openid__isnull=False
            )
            .exclude(user__openid="")
            .exclude(user__openid__startswith="dev:")
            .exists()
        ):
            raise RuntimeError

    probe("database_and_migrations", database)
    probe("smtp_connection_no_email_sent", smtp)
    probe("wechat_app_credentials_no_user_content_sent", wechat)
    if probe_api:
        probe("public_https_health_readiness_and_application", api)
    if check_owner:
        probe("active_owner", owner)
    connection.close()
    return results


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--online", action="store_true", help="Probe DB, SMTP and WeChat credentials."
    )
    parser.add_argument(
        "--probe-api", action="store_true", help="Also probe deployed HTTPS health."
    )
    parser.add_argument("--check-owner", action="store_true", help="Also require an active owner.")
    parser.add_argument(
        "--project-config",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "project.config.json",
    )
    args = parser.parse_args(argv)
    issues = configuration_issues(os.environ, args.project_config)
    if (args.probe_api or args.check_owner) and not args.online:
        issues.append("--probe-api and --check-owner require --online.")
    results = []
    if not issues and args.online:
        try:
            results = online_checks(probe_api=args.probe_api, check_owner=args.check_owner)
        except Exception as error:
            results = [{"check": "django_startup", "ok": False, "error_type": type(error).__name__}]
    passed = not issues and all(result["ok"] for result in results)
    print(json.dumps({"ok": passed, "online": args.online, "issues": issues, "checks": results}))
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
