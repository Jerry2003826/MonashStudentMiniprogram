from datetime import timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone

from apps.core.models import Application, AuditLog, User
from apps.forum.models import Board, Post, Report
from apps.portal.forms import ReportResolveForm

from .test_portal import browser, post

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize("data", [{}, {"note": ""}, {"note": " \t\n "}])
def test_report_resolve_form_requires_nonblank_note(data):
    form = ReportResolveForm(data)

    assert not form.is_valid()
    assert form.errors.as_data()["note"][0].code == "required"


def test_report_resolve_form_limits_and_trims_note():
    form = ReportResolveForm({"note": "  " + "查" * 1000 + "\n"})
    assert form.is_valid()
    assert form.cleaned_data["note"] == "查" * 1000

    form = ReportResolveForm({"note": "查" * 1001})
    assert not form.is_valid()
    assert form.errors.as_data()["note"][0].code == "max_length"


@pytest.fixture
def report(identities):
    board = Board.objects.create(name="校园生活")
    item = Post.objects.create(
        author=identities["student"], board=board, title="待核查帖子", content="请核查内容。"
    )
    return Report.objects.create(
        user=identities["student"], target_type="post", target_id=item.pk, reason="other"
    )


def test_report_resolution_page_marks_note_required(identities, report):
    response = browser(identities["editor"]).get("/manage/forum/?kind=reports")

    assert response.status_code == 200
    html = response.content.decode()
    assert f'<label for="report-note-{report.pk}">处理备注（必填）</label>' in html
    assert (
        f'<textarea id="report-note-{report.pk}" name="note" maxlength="1000" '
        'rows="3" required></textarea>' in html
    )


@pytest.mark.parametrize("data", [{}, {"note": ""}, {"note": " \t\n "}, {"note": "查" * 1001}])
def test_invalid_report_note_does_not_call_service_or_resolve(identities, report, data):
    client = browser(identities["editor"])

    with patch("apps.portal.forum_views.resolve_report") as resolve:
        response = post(client, f"/manage/forum/reports/{report.pk}/resolve/", data, follow=True)

    resolve.assert_not_called()
    assert response.status_code == 200
    assert "请填写处理备注，最多 1000 字。" in response.content.decode()
    report.refresh_from_db()
    assert report.status == Report.Status.NEW
    assert report.resolution_note == ""
    assert not AuditLog.objects.filter(action="forum.report.resolve").exists()


def test_valid_report_resolution_saves_trimmed_note_and_audit(identities, report):
    client = browser(identities["editor"])
    response = post(
        client,
        f"/manage/forum/reports/{report.pk}/resolve/",
        {"note": "  已核查并处理  \n"},
        follow=True,
    )

    assert response.status_code == 200
    assert "举报已标记为已处理。" in response.content.decode()
    report.refresh_from_db()
    assert report.status == Report.Status.RESOLVED
    assert report.resolution_note == "已核查并处理"
    audit = AuditLog.objects.get(action="forum.report.resolve", target_id=report.pk)
    assert audit.actor == identities["editor"]


def create_applications(status, count):
    users = User.objects.bulk_create(
        [User(username=f"applicant-{status}-{i}") for i in range(count)]
    )
    applications = Application.objects.bulk_create(
        [
            Application(user=user, email=f"{user.username}@student.monash.edu", status=status)
            for user in users
        ]
    )
    # Equal submission times must not cause records to move between pages.
    Application.objects.filter(pk__in=[item.pk for item in applications]).update(
        submitted_at=timezone.now()
    )
    return applications


@pytest.mark.parametrize("status", ["pending", "approved", "rejected"])
def test_membership_pagination_reaches_every_record_and_preserves_status(identities, status):
    applications = create_applications(status, 105)
    for other_status in {"pending", "approved", "rejected"} - {status}:
        create_applications(other_status, 1)
    # Submission time takes precedence over the descending primary-key tie-breaker.
    Application.objects.filter(pk=applications[0].pk).update(
        submitted_at=timezone.now() + timedelta(days=1)
    )
    client = browser(identities["reviewer"])
    seen_ids = []

    for number in range(1, 7):
        response = client.get(f"/manage/applications/?status={status}&page={number}")
        assert response.status_code == 200
        assert response.context["status"] == status
        page = response.context["page"]
        assert page.number == number
        assert page.paginator.count == 105
        assert page.paginator.num_pages == 6
        assert len(page) == (20 if number < 6 else 5)
        assert all(item.status == status for item in response.context["applications"])
        seen_ids.extend(item.pk for item in page)
        html = response.content.decode()
        assert f"第 {number} / 6 页" in html
        assert 'aria-label="申请分页"' in html
        assert ("上一页" in html) == (number > 1)
        assert ("下一页" in html) == (number < 6)
        if number > 1:
            assert f'href="?status={status}&amp;page={number - 1}"' in html
        if number < 6:
            assert f'href="?status={status}&amp;page={number + 1}"' in html

    assert seen_ids == [applications[0].pk] + [item.pk for item in reversed(applications[1:])]
    assert len(set(seen_ids)) == 105


@pytest.mark.parametrize(
    ("query", "expected_page"),
    [
        ("", 1),
        ("&page=", 1),
        ("&page=abc", 1),
        ("&page=1.5", 1),
        ("&page=0", 2),
        ("&page=-1", 2),
        ("&page=999999999999999999999", 2),
    ],
)
def test_membership_pagination_invalid_pages_use_safe_fallback(identities, query, expected_page):
    applications = create_applications("rejected", 21)
    client = browser(identities["reviewer"])

    response = client.get(f"/manage/applications/?status=rejected{query}")

    assert response.status_code == 200
    assert response.context["status"] == "rejected"
    assert response.context["page"].number == expected_page
    expected_ids = [item.pk for item in reversed(applications)]
    start = (expected_page - 1) * 20
    assert [item.pk for item in response.context["applications"]] == expected_ids[
        start : start + 20
    ]


def test_membership_pagination_empty_and_invalid_status(identities):
    create_applications("approved", 1)
    client = browser(identities["reviewer"])

    response = client.get("/manage/applications/?status=unknown&page=999")

    assert response.status_code == 200
    assert response.context["status"] == "pending"
    assert response.context["page"].number == 1
    assert response.context["page"].paginator.count == 0
    assert list(response.context["applications"]) == []
    html = response.content.decode()
    assert "暂无此状态的申请" in html
    assert 'class="pagination"' not in html


def test_reviewer_can_reject_application_beyond_first_hundred(identities):
    applications = create_applications("pending", 101)
    oldest = applications[0]
    client = browser(identities["reviewer"])
    response = client.get("/manage/applications/?status=pending&page=6")
    review_url = f"/manage/applications/{oldest.pk}/review/"

    assert response.status_code == 200
    assert f'action="{review_url}"' in response.content.decode()

    response = post(client, review_url, {"decision": "rejected", "note": "请补充信息"})

    assert response.status_code == 302
    oldest.refresh_from_db()
    assert oldest.status == "rejected"
    assert oldest.review_note == "请补充信息"
    assert oldest.reviewer == identities["reviewer"]


@pytest.mark.parametrize("status", ["approved", "rejected"])
def test_reviewed_membership_is_readable_after_reviewer_deleted(identities, status):
    application = Application.objects.create(
        user=identities["student"],
        email="former-reviewer@student.monash.edu",
        status=status,
        reviewer=identities["reviewer"],
        reviewed_at=timezone.now(),
        review_note="已核查",
    )
    identities["reviewer"].delete()

    response = browser(identities["owner"]).get(f"/manage/applications/?status={status}")

    assert response.status_code == 200
    assert [item.pk for item in response.context["applications"]] == [application.pk]
    assert "未记录或账号已移除" in response.content.decode()
    assert "已核查" in response.content.decode()
