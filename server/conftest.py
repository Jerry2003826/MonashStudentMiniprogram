"""Offline business tests explicitly replace the external moderation boundary.

The safety module's own tests override this fixture and exercise mocked HTTP.
There is no corresponding bypass setting in application code.
"""

import pytest


@pytest.fixture(autouse=True)
def mock_wechat_content_safety(monkeypatch):
    from apps.core import wechat_safety

    monkeypatch.setattr(wechat_safety, "check_text", lambda *args, **kwargs: "pass")
