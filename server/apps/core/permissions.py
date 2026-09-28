from .errors import ServiceError
from .models import StaffAccount

ROLE_CAPABILITIES = {
    "owner": {"portal.access", "accounts.manage", "membership.review", "content.manage"},
    "reviewer": {"portal.access", "membership.review"},
    "editor": {"portal.access", "content.manage"},
}


def require_staff(user, capability: str) -> StaffAccount:
    if not user or not user.is_authenticated:
        raise ServiceError(401, "UNAUTHORIZED", "请先登录")
    staff = StaffAccount.objects.filter(
        user_id=user.pk, is_active=True, user__is_active=True
    ).first()
    if not staff or capability not in ROLE_CAPABILITIES.get(staff.role, set()):
        raise ServiceError(403, "FORBIDDEN", "没有权限进行这个操作")
    return staff
