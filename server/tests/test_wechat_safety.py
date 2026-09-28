import asyncio
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import httpx
import pytest
from django.test import RequestFactory
from django.utils import timezone

from apps.content.models import Feedback
from apps.core import services
from apps.core import wechat_safety as safety
from apps.core.errors import ServiceError
from apps.core.models import Membership, User
from apps.forum.models import Board, Comment, Post

pytestmark = pytest.mark.django_db
APPID = "wx0123456789abcdef"
SECRET = "s" * 32
TOKEN = {"access_token": "private-access-token", "expires_in": 7200}
PASS = {"errcode": 0, "result": {"suggest": "pass"}}
REVIEW = {"errcode": 0, "result": {"suggest": "review"}}
RISKY = {"errcode": 0, "result": {"suggest": "risky"}}


@pytest.fixture(autouse=True)
def mock_wechat_content_safety(settings, monkeypatch):
    # Override the offline-business fixture: exercise the real safety code here.
    settings.WECHAT_CONTENT_SAFETY_MODE = "wechat"
    settings.WECHAT_APPID = APPID
    settings.WECHAT_APPSECRET = SECRET
    monkeypatch.setattr(safety, "_token_cache", None)

    def no_synchronous_http(*args, **kwargs):
        pytest.fail("Safety HTTP must use the cancellable asynchronous transport")

    monkeypatch.setattr(httpx, "post", no_synchronous_http)


@pytest.fixture
def user():
    user = User.objects.create_user(
        username="student", openid="stored-wechat-openid", nickname="原昵称", password=None
    )
    Membership.objects.create(
        user=user,
        email="student@student.monash.edu",
        approved_at=timezone.now(),
        expires_at=timezone.now() + timedelta(days=30),
    )
    return user


@pytest.fixture
def upstream(monkeypatch):
    replies = []
    requests = []
    original_client = httpx.AsyncClient

    def handler(request):
        requests.append(request)
        assert replies, "Unexpected external request"
        reply = replies.pop(0)
        if callable(reply):
            reply = reply()
        if isinstance(reply, Exception):
            raise reply
        if isinstance(reply, httpx.Response):
            return reply
        status, body = reply if isinstance(reply, tuple) else (200, reply)
        return httpx.Response(status, json=body)

    def client(**kwargs):
        assert kwargs.pop("follow_redirects") is False
        assert kwargs.pop("trust_env") is False
        timeout = kwargs.pop("timeout")
        assert 0 < timeout <= 8.0

        async def timed_handler(request):
            request.extensions["safety_timeout"] = timeout
            return handler(request)

        return original_client(transport=httpx.MockTransport(timed_handler), **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", client)
    return replies, requests


def test_v2_uses_database_identity_and_stable_token_cache(user, upstream):
    replies, requests = upstream
    replies.extend([TOKEN, PASS, PASS])
    user.openid = "forged-in-memory-id"
    assert safety.check_text(user, "文本", 3, title="标题") == "pass"
    assert safety.check_text(user, "另一个文本", 2) == "pass"
    assert len(requests) == 3
    assert str(requests[0].url) == safety.TOKEN_URL
    assert json.loads(requests[0].content) == {
        "grant_type": "client_credential",
        "appid": APPID,
        "secret": SECRET,
        "force_refresh": False,
    }
    assert json.loads(requests[1].content) == {
        "openid": "stored-wechat-openid",
        "content": "文本",
        "scene": 3,
        "version": 2,
        "title": "标题",
    }
    assert requests[1].url.params["access_token"] == TOKEN["access_token"]


@pytest.mark.parametrize("error", [40001, 40014, 42001])
def test_rejected_token_is_retrieved_once_then_check_retried(user, upstream, error):
    replies, requests = upstream
    replies.extend([TOKEN, {"errcode": error}, {**TOKEN, "access_token": "new-token"}, PASS])
    assert safety.check_text(user, "文本", 2) == "pass"
    assert len(requests) == 4
    assert requests[-1].url.params["access_token"] == "new-token"
    assert json.loads(requests[2].content)["force_refresh"] is False


def test_second_token_failure_stops_retrying(user, upstream):
    replies, requests = upstream
    replies.extend([TOKEN, {"errcode": 42001}, TOKEN, {"errcode": 42001}])
    with pytest.raises(ServiceError) as error:
        safety.check_text(user, "文本", 3)
    assert error.value.status == 503
    assert len(requests) == 4


def test_token_expiry_and_secret_rotation_invalidate_cached_token(
    user, upstream, monkeypatch, settings
):
    replies, requests = upstream
    now = [100.0]
    monkeypatch.setattr(safety.time, "monotonic", lambda: now[0])
    replies.extend([TOKEN, PASS, TOKEN, PASS, TOKEN, PASS])
    safety.check_text(user, "文本", 1)
    now[0] += 7150
    safety.check_text(user, "文本", 1)
    settings.WECHAT_APPSECRET = "z" * 32
    safety.check_text(user, "文本", 1)
    assert len(requests) == 6


@pytest.mark.parametrize(
    "response",
    [
        {"errcode": 40013, "errmsg": "private-upstream-secret"},
        [],
        {"access_token": "", "expires_in": 7200},
        {"access_token": "token", "expires_in": "7200"},
        {"access_token": "token", "expires_in": True},
        {"access_token": "token", "expires_in": 0},
        (502, {"message": "private-upstream-secret"}),
        httpx.ReadTimeout("private-token-timeout"),
        httpx.Response(200, content=b"private-invalid-json"),
    ],
)
def test_invalid_token_responses_fail_closed(user, upstream, response, caplog):
    replies, requests = upstream
    replies.append(response)
    with pytest.raises(ServiceError) as error:
        safety.check_text(user, "private-content", 2)
    assert error.value.status == 503
    assert "重试" in error.value.message
    assert len(requests) == 1
    assert "private-" not in str(error.value) + caplog.text
    assert SECRET not in str(error.value) + caplog.text


@pytest.mark.parametrize(
    "response",
    [
        {},
        [],
        {"errcode": False, "result": {"suggest": "pass"}},
        {"errcode": 0},
        {"errcode": 0, "result": {"suggest": "unknown"}},
        {"errcode": 0, "result": {"suggest": []}},
        {"errcode": -1, "errmsg": "private-platform-error"},
        {"errcode": 45009},
        (503, {"message": "private-platform-error"}),
        httpx.ReadTimeout("private-timeout-with-token"),
        httpx.ConnectError("private-connection-with-secret"),
    ],
)
def test_platform_errors_timeout_and_malformed_results_fail_closed(
    user, upstream, response, caplog
):
    replies, requests = upstream
    replies.extend([TOKEN, response])
    with pytest.raises(ServiceError) as error:
        safety.check_text(user, "private-content", 2)
    assert error.value.status == 503
    assert len(requests) == 2
    assert "private-" not in str(error.value) + caplog.text


@pytest.mark.parametrize("response", [RISKY, {"errcode": 87014}])
def test_risky_result_is_rejected(user, upstream, response):
    upstream[0].extend([TOKEN, response])
    with pytest.raises(ServiceError) as error:
        safety.check_text(user, "待检查内容", 3)
    assert error.value.code == "CONTENT_RISKY"
    assert error.value.status == 422


def test_long_text_checks_every_segment_and_preserves_review(user, upstream):
    replies, requests = upstream
    replies.extend([TOKEN, PASS, REVIEW, PASS])
    content = "甲" * 2500 + "乙" * 2500
    assert safety.check_text(user, content, 3) == "review"
    chunks = [json.loads(request.content)["content"] for request in requests[1:]]
    assert [len(chunk) for chunk in chunks] == [2500, 2500, 200]
    assert chunks[0][-100:] == chunks[1][:100]
    assert chunks[1][-100:] == chunks[2][:100]
    assert chunks[0] + chunks[1][100:] + chunks[2][100:] == content


@pytest.mark.parametrize(
    "name,value",
    [
        ("WECHAT_APPID", "https://private-secret.example"),
        ("WECHAT_APPSECRET", "private-secret"),
        ("WECHAT_CONTENT_SAFETY_MODE", "off"),
    ],
)
def test_bad_configuration_never_leaks_values_or_contacts_network(
    user, upstream, settings, name, value
):
    setattr(settings, name, value)
    with pytest.raises(ServiceError) as error:
        safety.check_text(user, "文本", 1)
    assert error.value.status == 503
    assert value not in str(error.value)
    assert upstream[1] == []


def test_fake_requires_local_request_and_verified_demo_identity(user, upstream, settings):
    settings.WECHAT_CONTENT_SAFETY_MODE = "fake"
    settings.DEBUG = True
    settings.ENABLE_DEV_LOGIN = True
    settings.ALLOWED_HOSTS = ["localhost", "example.org"]
    local = RequestFactory().post("/", HTTP_HOST="localhost", REMOTE_ADDR="127.0.0.1")
    demo = User.objects.create_user(
        username="demo-student", openid="dev:demo-student", password=None
    )
    assert safety.check_text(demo, "文本", 1, request=local) == "pass"
    bad_requests = [
        None,
        RequestFactory().post("/", HTTP_HOST="example.org", REMOTE_ADDR="127.0.0.1"),
        RequestFactory().post("/", HTTP_HOST="localhost", REMOTE_ADDR="203.0.113.1"),
    ]
    for request in bad_requests:
        with pytest.raises(ServiceError):
            safety.check_text(demo, "文本", 1, request=request)
    with pytest.raises(ServiceError):
        safety.check_text(user, "文本", 1, request=local)
    demo.openid = "real-openid"
    demo.save(update_fields=["openid"])
    with pytest.raises(ServiceError):
        safety.check_text(demo, "文本", 1, request=local)
    demo.openid = "dev:demo-student"
    demo.set_password("not-a-demo")
    demo.save(update_fields=["openid", "password"])
    with pytest.raises(ServiceError):
        safety.check_text(demo, "文本", 1, request=local)
    assert upstream[1] == []


@pytest.mark.parametrize("debug,dev_login", [(False, True), (True, False), (False, False)])
def test_fake_cannot_run_with_production_flags(user, upstream, settings, debug, dev_login):
    settings.WECHAT_CONTENT_SAFETY_MODE = "fake"
    settings.DEBUG = debug
    settings.ENABLE_DEV_LOGIN = dev_login
    request = RequestFactory().post("/", HTTP_HOST="localhost", REMOTE_ADDR="127.0.0.1")
    with pytest.raises(ServiceError) as error:
        safety.check_text(user, "文本", 1, request=request)
    assert error.value.status == 503
    assert not upstream[1]


@pytest.mark.parametrize("openid", [None, "", "dev:demo-student", "bad openid"])
def test_missing_real_wechat_identity_requires_login(user, upstream, openid):
    User.objects.filter(pk=user.pk).update(openid=openid)
    with pytest.raises(ServiceError) as error:
        safety.check_text(user, "文本", 1)
    assert error.value.status == 401
    assert not upstream[1]


@pytest.mark.parametrize("suggest,status", [("pass", 200), ("review", 422), ("risky", 422)])
@pytest.mark.parametrize("method", ["patch", "put"])
def test_profile_routes_apply_check_before_any_name_change(
    client, user, upstream, suggest, status, method
):
    upstream[0].extend([TOKEN, {"errcode": 0, "result": {"suggest": suggest}}])
    response = getattr(client, method)(
        "/api/v1/me",
        data=json.dumps({"nickname": "新昵称"}),
        content_type="application/json",
        HTTP_AUTHORIZATION=f"Bearer {services.issue_token(user)}",
    )
    assert response.status_code == status
    user.refresh_from_db()
    assert user.nickname == ("新昵称" if suggest == "pass" else "原昵称")
    payload = json.loads(upstream[1][-1].content)
    assert payload["scene"] == 1 and payload["nickname"] == "新昵称"


@pytest.mark.parametrize("suggest", ["pass", "review"])
def test_public_forum_writes_remain_pending_and_feedback_private(client, user, upstream, suggest):
    board = Board.objects.create(name="公开板块")
    published = Post.objects.create(
        author=user, board=board, title="已审标题", content="正文", status="approved"
    )
    upstream[0].extend([TOKEN] + [{"errcode": 0, "result": {"suggest": suggest}}] * 3)
    headers = {"HTTP_AUTHORIZATION": f"Bearer {services.issue_token(user)}"}
    for path, body in [
        ("/forum/posts", {"board_id": board.pk, "title": "新标题", "content": "论坛正文"}),
        (f"/forum/posts/{published.pk}/comments", {"content": "评论正文"}),
        (
            "/feedback",
            {"category": "suggestion", "content": "这是足够长的一条反馈内容", "contact": "联系"},
        ),
    ]:
        # Existing published fixture must not activate the per-user post cooldown.
        Post.objects.filter(pk=published.pk).update(created_at=timezone.now() - timedelta(days=1))
        response = client.post(
            f"/api/v1{path}", data=json.dumps(body), content_type="application/json", **headers
        )
        assert response.status_code == 200, response.content
    assert Post.objects.exclude(pk=published.pk).get().status == "pending"
    assert Comment.objects.get().status == "pending"
    assert Feedback.objects.get().status == "new"
    assert [json.loads(r.content)["scene"] for r in upstream[1][1:]] == [3, 2, 2]


@pytest.mark.parametrize("response", [RISKY, httpx.ReadTimeout("private-timeout")])
def test_failure_blocks_all_submission_routes_without_partial_rows(
    client, user, upstream, response
):
    board = Board.objects.create(name="板块")
    post = Post.objects.create(
        author=user, board=board, title="已发布", content="内容", status="approved"
    )
    Post.objects.filter(pk=post.pk).update(created_at=timezone.now() - timedelta(days=1))
    upstream[0].extend([TOKEN] + [response] * 4)
    headers = {"HTTP_AUTHORIZATION": f"Bearer {services.issue_token(user)}"}
    for method, path, body in [
        ("patch", "/me", {"nickname": "新昵称"}),
        ("post", "/forum/posts", {"board_id": board.pk, "title": "新标题", "content": "新内容"}),
        ("post", f"/forum/posts/{post.pk}/comments", {"content": "新评论"}),
        ("post", "/feedback", {"category": "suggestion", "content": "这是足够长的新反馈内容"}),
    ]:
        result = getattr(client, method)(
            f"/api/v1{path}", data=json.dumps(body), content_type="application/json", **headers
        )
        assert result.status_code == (503 if isinstance(response, Exception) else 422)
    user.refresh_from_db()
    assert user.nickname == "原昵称"
    assert Post.objects.count() == 1
    assert not Comment.objects.exists()
    assert not Feedback.objects.exists()


def test_request_body_cannot_override_openid(client, user, upstream):
    result = client.patch(
        "/api/v1/me",
        data=json.dumps({"nickname": "新昵称", "openid": "attacker"}),
        content_type="application/json",
        HTTP_AUTHORIZATION=f"Bearer {services.issue_token(user)}",
    )
    assert result.status_code == 422
    assert not upstream[1]


def test_simultaneous_token_reads_fetch_only_once_per_process(upstream):
    upstream[0].append(TOKEN)
    ready = threading.Barrier(2)

    def obtain():
        ready.wait(timeout=2)
        return safety._access_token(deadline=safety.time.monotonic() + 10)

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(obtain) for _ in range(2)]
        assert [future.result(timeout=3) for future in futures] == [TOKEN["access_token"]] * 2
    assert len(upstream[1]) == 1


def test_final_chunk_risk_rejects_entire_post(client, user, upstream):
    board = Board.objects.create(name="板块")
    upstream[0].extend([TOKEN, PASS, PASS, RISKY])
    result = client.post(
        "/api/v1/forum/posts",
        data=json.dumps({"board_id": board.pk, "title": "标题", "content": "甲" * 5000}),
        content_type="application/json",
        HTTP_AUTHORIZATION=f"Bearer {services.issue_token(user)}",
    )
    assert result.status_code == 422
    assert result.json()["code"] == "CONTENT_RISKY"
    assert not Post.objects.exists()
    assert len(upstream[1]) == 4


def test_total_deadline_includes_token_refresh_and_rejects_late_success(
    client, user, upstream, monkeypatch
):
    now = [0.0]
    monkeypatch.setattr(safety.time, "monotonic", lambda: now[0])

    def advance(seconds, response):
        def deliver():
            now[0] += seconds
            return response

        return deliver

    upstream[0].extend(
        [
            advance(4, TOKEN),
            advance(3, {"errcode": 42001}),
            advance(2, TOKEN),
            advance(1.1, PASS),
        ]
    )
    response = client.patch(
        "/api/v1/me",
        data=json.dumps({"nickname": "新昵称"}),
        content_type="application/json",
        HTTP_AUTHORIZATION=f"Bearer {services.issue_token(user)}",
    )
    assert response.status_code == 503
    assert [r.extensions["safety_timeout"] for r in upstream[1]] == [8, 6, 3, 1]
    user.refresh_from_db()
    assert user.nickname == "原昵称"


def test_late_token_does_not_start_content_check(user, upstream, monkeypatch):
    now = [0.0]
    monkeypatch.setattr(safety.time, "monotonic", lambda: now[0])

    def late_token():
        now[0] = 10.1
        return TOKEN

    upstream[0].append(late_token)
    with pytest.raises(ServiceError) as error:
        safety.check_text(user, "文本", 1)
    assert error.value.status == 503
    assert len(upstream[1]) == 1


def test_token_lock_wait_is_bounded_by_remaining_budget(user, upstream, monkeypatch):
    waits = []

    class BusyLock:
        def acquire(self, *, timeout):
            waits.append(timeout)
            return False

        def release(self):
            pytest.fail("An unacquired lock must not be released")

    monkeypatch.setattr(safety, "_token_lock", BusyLock())
    with pytest.raises(ServiceError) as error:
        safety.check_text(user, "文本", 1)
    assert error.value.status == 503
    assert len(waits) == 1 and 0 < waits[0] <= 10
    assert not upstream[1]


def test_final_deadline_guard_runs_before_nickname_write(user, monkeypatch):
    now = [0.0]
    monkeypatch.setattr(safety.time, "monotonic", lambda: now[0])

    def late_chunk(*args):
        now[0] = 10.1
        return "pass"

    monkeypatch.setattr(safety, "_check_chunk", late_chunk)
    with pytest.raises(ServiceError) as error:
        services.update_nickname(user, "新昵称")
    assert error.value.status == 503
    user.refresh_from_db()
    assert user.nickname == "原昵称"


def test_only_one_token_retry_is_allowed_across_all_segments(user, upstream):
    upstream[0].extend(
        [
            TOKEN,
            {"errcode": 42001},
            TOKEN,
            PASS,
            {"errcode": 42001},
        ]
    )
    with pytest.raises(ServiceError) as error:
        safety.check_text(user, "甲" * 3000, 3)
    assert error.value.status == 503
    assert len(upstream[1]) == 5


def test_cumulative_slow_phases_cancel_before_response_finishes(user, monkeypatch):
    original_client = httpx.AsyncClient
    events = []

    async def handler(request):
        if request.url.path.endswith("stable_token"):
            return httpx.Response(200, json=TOKEN)
        try:
            # Both phases individually fit the 100ms deadline, but together do
            # not. Phase-only HTTP timeouts would let this return a late pass.
            await asyncio.sleep(0.07)
            events.append("connected")
            await asyncio.sleep(0.07)
            events.append("late-response")
            return httpx.Response(200, json=PASS)
        except asyncio.CancelledError:
            events.append("cancelled")
            raise

    class Transport(httpx.MockTransport):
        async def aclose(self):
            events.append("transport-closed")

    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: original_client(transport=Transport(handler), **kwargs),
    )
    monkeypatch.setattr(safety, "CHECK_BUDGET_SECONDS", 0.1)
    started = time.perf_counter()
    with pytest.raises(ServiceError) as error:
        services.update_nickname(user, "新昵称")
    assert time.perf_counter() - started < 0.35
    assert error.value.status == 503
    assert "connected" in events and "cancelled" in events
    assert "late-response" not in events
    assert events[-1] == "transport-closed"
    user.refresh_from_db()
    assert user.nickname == "原昵称"
    assert not safety._token_lock.locked()


def test_streaming_response_is_closed_and_has_no_background_read_after_deadline(user, monkeypatch):
    original_client = httpx.AsyncClient
    events = []

    class Trickle(httpx.AsyncByteStream):
        async def __aiter__(self):
            try:
                # Every chunk arrives before the per-read timeout, forever.
                for _ in range(20):
                    await asyncio.sleep(0.03)
                    events.append("chunk")
                    yield b" "
                yield json.dumps(PASS).encode()
            except asyncio.CancelledError:
                events.append("cancelled")
                raise

        async def aclose(self):
            events.append("stream-closed")

    async def handler(request):
        if request.url.path.endswith("stable_token"):
            return httpx.Response(200, json=TOKEN)
        return httpx.Response(200, stream=Trickle())

    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: original_client(transport=httpx.MockTransport(handler), **kwargs),
    )
    monkeypatch.setattr(safety, "CHECK_BUDGET_SECONDS", 0.1)
    started = time.perf_counter()
    with pytest.raises(ServiceError) as error:
        services.update_nickname(user, "新昵称")
    assert time.perf_counter() - started < 0.35
    assert error.value.status == 503
    assert 0 < events.count("chunk") < 20
    assert events[-2:] == ["cancelled", "stream-closed"]
    finished = list(events)
    time.sleep(0.06)
    assert events == finished
    user.refresh_from_db()
    assert user.nickname == "原昵称"
    assert not safety._token_lock.locked()


def test_cancelled_dns_does_not_delay_transaction_exit_or_start_late_http(user, monkeypatch):
    original_client = httpx.AsyncClient
    release_resolver = threading.Event()
    resolver_finished = threading.Event()
    events = []

    def resolver():
        # Match the standard event-loop DNS executor without external traffic.
        try:
            release_resolver.wait(timeout=1)
            events.append("dns-finished")
        finally:
            resolver_finished.set()

    async def handler(request):
        if request.url.path.endswith("stable_token"):
            return httpx.Response(200, json=TOKEN)
        try:
            await asyncio.get_running_loop().run_in_executor(None, resolver)
            events.append("http-after-dns")
            return httpx.Response(200, json=PASS)
        except asyncio.CancelledError:
            events.append("cancelled")
            raise

    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: original_client(transport=httpx.MockTransport(handler), **kwargs),
    )
    monkeypatch.setattr(safety, "CHECK_BUDGET_SECONDS", 0.1)
    started = time.perf_counter()
    try:
        with pytest.raises(ServiceError) as error:
            services.update_nickname(user, "新昵称")
        assert time.perf_counter() - started < 0.35
        assert error.value.status == 503
        assert events == ["cancelled"]
        assert not safety._token_lock.locked()
        user.refresh_from_db()
        assert user.nickname == "原昵称"
    finally:
        release_resolver.set()
        assert resolver_finished.wait(timeout=0.5)
    # Drive the reused loop again after DNS completes: no cancelled operation
    # can resume and send the original HTTP request.
    safety._http_runner().run(asyncio.sleep(0))
    assert events == ["cancelled", "dns-finished"]
    assert not asyncio.all_tasks(safety._http_runner().get_loop())
