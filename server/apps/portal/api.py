from ninja import Router, Schema
from ninja.security import HttpBearer

from apps.core.services import authenticate_token

from .pairing import confirm_challenge


class StaffTokenAuth(HttpBearer):
    def authenticate(self, request, token):
        return authenticate_token(token)


class ConfirmPayload(Schema):
    model_config = {"extra": "forbid"}
    code: str


# Browser cookies are deliberately not accepted. Explicit Bearer headers provide
# CSRF protection for the Mini Program; browser POST views use Django CSRF tokens.
router = Router(tags=["staff login"], auth=StaffTokenAuth())


@router.post("/confirm")
def confirm(request, payload: ConfirmPayload):
    confirm_challenge(request.auth, payload.code, request)
    return {"confirmed": True, "message": "已确认，请返回发起登录的浏览器。"}
