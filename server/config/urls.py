from django.urls import include, path

from apps.content.api import router as content_router
from apps.core.api import api, healthz
from apps.forum.api import router as forum_router
from apps.portal.api import router as portal_router

from .health import readyz

api.add_router("/staff/login", portal_router)
api.add_router("", content_router)
api.add_router("/forum", forum_router)

urlpatterns = [
    path("healthz", healthz),
    path("readyz", readyz),
    path("api/v1/", api.urls),
    path("manage/", include("apps.portal.urls")),
]
