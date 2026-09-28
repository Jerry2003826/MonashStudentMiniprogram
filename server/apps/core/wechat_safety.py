"""Fail-closed WeChat text checks; only stable tokens are cached per worker.

Two workers may each cache a token. stable_token with force_refresh=False avoids
workers invalidating one another. Cache state is neither shared nor persistent;
larger deployments should move token coordination to a shared secret store.

Official v2 contract and stable-token request:
https://developers.weixin.qq.com/miniprogram/dev/server/API/sec-center/sec-check/api_msgseccheck.html
https://developers.weixin.qq.com/miniprogram/dev/server/API/mp-access-token/api_getstableaccesstoken.html
"""

import asyncio
import atexit
import hashlib
import re
import threading
import time
from contextvars import copy_context

import httpx
from django.conf import settings
from django.views.decorators.debug import sensitive_variables

from .errors import ServiceError
from .models import User

TOKEN_URL = "https://api.weixin.qq.com/cgi-bin/stable_token"
CHECK_URL = "https://api.weixin.qq.com/wxa/msg_sec_check"
TOKEN_ERRORS = {40001, 40014, 42001}
MAX_CHUNK_LENGTH = 2500
CHUNK_OVERLAP = 100
CHECK_BUDGET_SECONDS = 10.0
_token_lock = threading.Lock()
_token_cache = None
_async_context = threading.local()


def unavailable():
    return ServiceError(503, "INTERNAL_ERROR", "内容安全服务暂时不可用，请稍后重试")


def _remaining(deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise unavailable()
    return remaining


@sensitive_variables()
def _credentials():
    appid = settings.WECHAT_APPID
    secret = settings.WECHAT_APPSECRET
    if (
        not isinstance(appid, str)
        or not re.fullmatch(r"wx[0-9a-fA-F]{16}", appid)
        or not isinstance(secret, str)
        or not re.fullmatch(r"[0-9a-zA-Z]{32}", secret)
    ):
        raise unavailable()
    key = hashlib.sha256(f"{appid}:{secret}".encode()).hexdigest()
    return appid, secret, key


@sensitive_variables()
async def _post_json(url, *, body, deadline, params=None):
    # HTTPX phase timeouts alone cannot bound a slow trickle of response chunks.
    # Cancelling the actual async I/O closes its stream before this call returns;
    # no background worker can finish a late request while Django releases locks.
    async with asyncio.timeout(_remaining(deadline)):
        async with httpx.AsyncClient(
            timeout=min(8.0, _remaining(deadline)),
            follow_redirects=False,
            trust_env=False,
        ) as client:
            response = await client.post(url, json=body, params=params)
            response.raise_for_status()
            data = response.json()
            _remaining(deadline)
            return data


def _http_runner():
    # A Runner belongs to the current synchronous worker thread: HTTP I/O runs
    # on that very thread, never on a detached request worker. Reusing the loop
    # also avoids asyncio.run() waiting for a cancelled system DNS lookup in
    # shutdown_default_executor() while the request still owns DB locks. A DNS
    # resolver thread can finish only its lookup; its cancelled awaiter cannot
    # open a connection or finish a late content check. The executor is bounded
    # and reused, and shutdown happens only when the server process exits.
    runner = getattr(_async_context, "runner", None)
    if runner is None:
        runner = asyncio.Runner(loop_factory=asyncio.new_event_loop)
        _async_context.runner = runner
        atexit.register(runner.close)
    return runner


@sensitive_variables()
def _request_json(url, *, body, deadline, params=None):
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        pass
    else:
        # This is a synchronous Django service. Do not silently move its work to
        # an uncancellable background thread if called from an async context.
        raise unavailable()
    try:
        data = _http_runner().run(
            _post_json(url, body=body, params=params, deadline=deadline),
            context=copy_context(),
        )
    except (httpx.HTTPError, TimeoutError, ValueError):
        # Never include upstream messages, URLs, content, OpenIDs or tokens.
        raise unavailable() from None
    _remaining(deadline)
    if not isinstance(data, dict):
        raise unavailable()
    return data


@sensitive_variables()
def _access_token(*, deadline, rejected_token=None):
    global _token_cache
    appid, secret, key = _credentials()
    if not _token_lock.acquire(timeout=_remaining(deadline)):
        raise unavailable()
    try:
        _remaining(deadline)
        now = time.monotonic()
        if _token_cache and _token_cache[0] == key:
            if rejected_token == _token_cache[1]:
                _token_cache = None
            elif _token_cache[2] > now:
                return _token_cache[1]
        data = _request_json(
            TOKEN_URL,
            body={
                "grant_type": "client_credential",
                "appid": appid,
                "secret": secret,
                "force_refresh": False,
            },
            deadline=deadline,
        )
        token = data.get("access_token")
        expires = data.get("expires_in")
        if (
            type(data.get("errcode", 0)) is not int
            or data.get("errcode", 0) != 0
            or not isinstance(token, str)
            or not token
            or len(token) > 2048
            or any(ord(char) < 33 or ord(char) == 127 for char in token)
            or type(expires) is not int
            or not 1 <= expires <= 86400
        ):
            raise unavailable()
        # Refresh before actual expiry; a short-lived token is never cached past
        # its real expiry. Time spent fetching is conservatively included.
        _token_cache = (key, token, now + max(0, expires - min(60, expires / 10)))
        return token
    finally:
        _token_lock.release()


@sensitive_variables()
def _check_chunk(openid, content, scene, title, nickname, deadline, token_retry):
    body = {"openid": openid, "content": content, "version": 2, "scene": scene}
    if title:
        body["title"] = title
    if nickname:
        body["nickname"] = nickname
    token = _access_token(deadline=deadline)
    for attempt in range(2):
        data = _request_json(
            CHECK_URL, params={"access_token": token}, body=body, deadline=deadline
        )
        error = data.get("errcode")
        if type(error) is not int:
            raise unavailable()
        if error in TOKEN_ERRORS and attempt == 0 and not token_retry["used"]:
            token_retry["used"] = True
            token = _access_token(rejected_token=token, deadline=deadline)
            continue
        if error == 87014:
            return "risky"
        if error != 0:
            raise unavailable()
        result = data.get("result")
        suggest = result.get("suggest") if isinstance(result, dict) else None
        if not isinstance(suggest, str) or suggest not in {"pass", "review", "risky"}:
            raise unavailable()
        return suggest
    raise unavailable()


@sensitive_variables()
def check_text(actor, content, scene, *, request=None, title="", nickname=""):
    """Use a stored login identity, never an OpenID supplied by the request body.

    Returning review does not authorize publication. Public forum writes remain
    pending; callers without a manual-review state must decline that change.
    """
    deadline = time.monotonic() + CHECK_BUDGET_SECONDS
    if not actor or not actor.is_authenticated:
        raise ServiceError(401, "UNAUTHORIZED", "请先登录")
    user = User.objects.filter(pk=actor.pk, is_active=True).first()
    if user is None:
        raise ServiceError(401, "UNAUTHORIZED", "登录已失效，请重新登录")
    if (
        not isinstance(content, str)
        or not content.strip()
        or len(content) > 5500
        or type(scene) is not int
        or scene not in {1, 2, 3, 4}
        or not isinstance(title, str)
        or len(title) > 50
        or not isinstance(nickname, str)
        or len(nickname) > 20
    ):
        raise ServiceError(422, "VALIDATION_ERROR", "待检查的内容格式不正确")
    mode = getattr(settings, "WECHAT_CONTENT_SAFETY_MODE", "wechat")
    if mode == "fake":
        from .services import dev_login_user

        if request is None or not (settings.DEBUG and settings.ENABLE_DEV_LOGIN):
            raise unavailable()
        verified_demo = dev_login_user(request, user.username)
        if verified_demo.pk != user.pk:
            raise unavailable()
        _remaining(deadline)
        return "pass"
    if mode != "wechat":
        raise unavailable()
    if (
        not isinstance(user.openid, str)
        or not user.openid
        or user.openid.startswith("dev:")
        or len(user.openid) > 128
        or any(char.isspace() or ord(char) < 32 for char in user.openid)
    ):
        raise ServiceError(401, "UNAUTHORIZED", "请重新通过微信登录后再提交")
    suggestion = "pass"
    token_retry = {"used": False}
    # Preserve the existing 5,000-character forum contract. Every character is
    # checked, with overlap so ordinary phrases crossing a boundary are retained.
    for offset in range(0, len(content), MAX_CHUNK_LENGTH - CHUNK_OVERLAP):
        result = _check_chunk(
            user.openid,
            content[offset : offset + MAX_CHUNK_LENGTH],
            scene,
            title,
            nickname,
            deadline,
            token_retry,
        )
        if result == "risky":
            raise ServiceError(422, "CONTENT_RISKY", "内容可能含有违规信息，请修改后再提交")
        if result == "review":
            suggestion = "review"
        if offset + MAX_CHUNK_LENGTH >= len(content):
            break
    # Also guard the synchronous parsing/checking work between async requests.
    _remaining(deadline)
    return suggestion
