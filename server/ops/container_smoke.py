"""Build and verify a disposable production-mode container stack on loopback."""

import argparse
import json
import os
import re
import socket
import subprocess
import time
import uuid
from pathlib import Path

import httpx

from ops.preflight import probe_public_api

ROOT = Path(__file__).resolve().parents[2]


def run_smoke(*, build=True):
    project = "mnp-smoke-" + uuid.uuid4().hex[:10]
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    env = {**os.environ, "SMOKE_HTTP_PORT": str(port)}
    command = ["docker", "compose", "-p", project, "-f", str(ROOT / "deploy/compose.smoke.yaml")]
    results = []

    def compose(*args, timeout=180):
        result = subprocess.run(
            [*command, *args], env=env, cwd=ROOT, text=True, capture_output=True, timeout=timeout
        )
        if result.returncode:
            # This stack contains only explicitly synthetic configuration.
            raise RuntimeError(f"Compose {args[0]} failed: {result.stderr[-2500:]}")
        return result.stdout

    def record(name, condition):
        if not condition:
            raise AssertionError(name)
        results.append({"check": name, "ok": True})

    try:
        compose("config", "--quiet")
        if build:
            print("Building production image…", flush=True)
            compose("build", "app", timeout=600)
        print("Starting disposable PostgreSQL 16 and production-mode application…", flush=True)
        compose("up", "-d", timeout=300)
        isolation = compose(
            "exec",
            "-T",
            "app",
            "python",
            "-c",
            "from pathlib import Path; import importlib.util; "
            "assert not list(Path('/app').glob('**/conftest.py')); "
            "assert not list(Path('/app').glob('.env*')); "
            "assert not list(Path('/app/var').glob('*.sqlite3')); "
            "assert importlib.util.find_spec('pytest') is None; print('isolated')",
        )
        record(
            "runtime_excludes_test_mock_secrets_and_local_database", isolation.strip() == "isolated"
        )
        origin = f"http://127.0.0.1:{port}"
        with httpx.Client(base_url=origin, timeout=10, follow_redirects=False) as client:
            deadline = time.monotonic() + 60
            while True:
                try:
                    if client.get("/healthz").status_code == 200:
                        break
                except httpx.TransportError:
                    pass
                if time.monotonic() >= deadline:
                    raise RuntimeError("The application did not start within 60 seconds.")
                time.sleep(1)
            record("unmigrated_database_not_ready", client.get("/readyz").status_code == 503)
            compose("exec", "-T", "app", "python", "manage.py", "migrate", "--noinput")
            record("migrated_database_ready", client.get("/readyz").status_code == 200)
            compose(
                "exec",
                "-T",
                "app",
                "python",
                "manage.py",
                "shell",
                "-c",
                "from apps.content.models import Activity; "
                "Activity.objects.create(title='Container smoke fixture', summary='Local test', "
                "category='latest', content='Disposable local test record', "
                "published=True, is_example=True)",
            )
            print("Checking HTTP behavior, permissions and static resources…", flush=True)
            response = client.get("/api/v1/home")
            record("http_redirects_to_https", response.status_code in {301, 302, 307, 308})
            secure = {"X-Forwarded-Proto": "https"}
            with httpx.Client(headers=secure, timeout=10, trust_env=False) as preflight_client:
                probe_public_api(preflight_client, origin)
            record("application_preflight_accepts_real_production_responses", True)
            for route in ("/api/v1/docs", "/api/v1/openapi.json"):
                record(
                    "debug_route_absent:" + route,
                    client.get(route, headers=secure).status_code == 404,
                )
            response = client.get("/api/v1/me", headers=secure)
            record("anonymous_member_access_denied", response.status_code == 401)
            response = client.post(
                "/api/v1/auth/dev-login", json={"username": "demo-owner"}, headers=secure
            )
            record("development_login_disabled", response.status_code in {403, 404})
            for route in ("/api/v1/home", "/api/v1/activities", "/api/v1/merchants"):
                response = client.get(route, headers=secure)
                record("public_read:" + route, response.status_code == 200)
            response = client.get("/manage/login/", headers=secure)
            record("portal_renders_with_debug_false", response.status_code == 200)
            record(
                "https_response_has_hsts",
                "max-age=3600" in response.headers.get("strict-transport-security", ""),
            )
            assets = re.findall(r'(?:href|src)="(/static/[^\"]+)"', response.text)
            record("portal_has_static_assets", bool(assets))
            for asset in assets:
                record("static_asset_served", client.get(asset, headers=secure).status_code == 200)
            cookies = response.headers.get_list("set-cookie")
            record(
                "portal_cookies_are_secure",
                bool(cookies) and all("secure" in item.lower() for item in cookies),
            )
            before = client.get("/api/v1/activities", headers=secure).json()
            record("database_fixture_is_visible", "Container smoke fixture" in json.dumps(before))
            compose("restart", "app")
            for _ in range(30):
                try:
                    response = client.get("/api/v1/activities", headers=secure)
                    if response.status_code == 200:
                        break
                except httpx.TransportError:
                    pass
                time.sleep(1)
            record(
                "application_restart_preserves_database",
                response.status_code == 200 and response.json() == before,
            )
        rejected = subprocess.run(
            [*command, "run", "--rm", "--no-deps", "-e", "DJANGO_DEBUG=true", "app"],
            env=env,
            cwd=ROOT,
            text=True,
            capture_output=True,
            timeout=30,
        )
        record("container_rejects_debug_mode", rejected.returncode != 0)
        report = {
            "ok": True,
            "project": project,
            "checks": results,
            "external_services_used": False,
        }
        return report
    finally:
        # Only this invocation's random project and its disposable socket volume.
        compose("down", "--volumes", "--remove-orphans", timeout=90)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-build", action="store_true")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    report = run_smoke(build=not args.no_build)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
