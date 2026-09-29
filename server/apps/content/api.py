from typing import Literal

from ninja import Router
from ninja.security import HttpBearer
from pydantic import Field

from apps.core.schemas import StrictInput
from apps.core.services import authenticate_token

from . import services

router = Router(tags=["公开内容与反馈"])


class FeedbackInput(StrictInput):
    category: Literal["suggestion", "bug", "merchant"]
    content: str = Field(min_length=10, max_length=1000)
    contact: str = Field(default="", max_length=100)


class FeedbackAuth(HttpBearer):
    def authenticate(self, request, token):
        return authenticate_token(token)


@router.get("/home", auth=None)
def home(request):
    return services.home_content()


@router.get("/activities", auth=None)
def activities(request):
    return services.list_activities(request.GET)


@router.get("/activities/{activity_id}", auth=None)
def activity_detail(request, activity_id: int):
    return services.get_activity(activity_id)


@router.get("/merchants/filters", auth=None)
def merchant_filters(request):
    return services.merchant_filters()


@router.get("/merchants", auth=None)
def merchants(request):
    return services.list_merchants(request.GET)


@router.get("/merchants/map", auth=None)
def merchant_map(request):
    return services.merchant_map_pins(request.GET)


@router.get("/merchants/{merchant_id}", auth=None)
def merchant_detail(request, merchant_id: int):
    return services.get_merchant(merchant_id)


@router.get("/support", auth=None)
def support(request):
    return services.support_content()


@router.post("/feedback", auth=FeedbackAuth())
def feedback(request, body: FeedbackInput):
    entry = services.submit_feedback(
        request.auth, body.category, body.content, body.contact, request=request
    )
    return {"id": entry.pk}
