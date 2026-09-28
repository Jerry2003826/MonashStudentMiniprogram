import pytest

from apps.core.models import StaffAccount, User


@pytest.fixture
def identities():
    users = {}
    for role in ("owner", "reviewer", "editor", "student"):
        user = User.objects.create_user(
            username=f"person-{role}", openid=f"wechat-{role}", nickname=f"测试{role}"
        )
        if role != "student":
            StaffAccount.objects.create(user=user, role=role)
        users[role] = user
    return users
