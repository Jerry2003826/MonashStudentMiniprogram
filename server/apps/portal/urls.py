from django.urls import path

from . import content_views, forum_views, views

app_name = "portal"
urlpatterns = [
    path("", views.index, name="index"),
    path("login/", views.login_page, name="login"),
    path("login/challenge/", views.begin_pairing, name="begin_pairing"),
    path("login/poll/", views.poll_pairing, name="poll_pairing"),
    path("login/dev/", views.dev_login, name="dev_login"),
    path("logout/", views.logout_view, name="logout"),
    path("applications/", views.applications, name="applications"),
    path("applications/<int:application_id>/review/", views.review, name="review"),
    path("accounts/", views.accounts, name="accounts"),
    path("accounts/create/", views.account_create, name="account_create"),
    path("accounts/<int:account_id>/update/", views.account_update, name="account_update"),
    path("content/", content_views.content_index, name="content_index"),
    path("content/<slug:resource_key>/", content_views.content_list, name="content_list"),
    path("content/<slug:resource_key>/new/", content_views.content_edit, name="content_new"),
    path(
        "content/<slug:resource_key>/<int:record_id>/edit/",
        content_views.content_edit,
        name="content_edit",
    ),
    path(
        "content/<slug:resource_key>/<int:record_id>/publish/",
        content_views.content_publish,
        name="content_publish",
    ),
    path("feedback/", content_views.feedback_list, name="feedback"),
    path("feedback/<int:record_id>/", content_views.feedback_edit, name="feedback_edit"),
    path("forum/", forum_views.forum_index, name="forum"),
    path(
        "forum/<slug:kind>/<int:record_id>/review/", forum_views.forum_review, name="forum_review"
    ),
    path("forum/posts/<int:record_id>/pin/", forum_views.forum_pin, name="forum_pin"),
    path(
        "forum/reports/<int:record_id>/resolve/",
        forum_views.forum_resolve_report,
        name="forum_report",
    ),
]
