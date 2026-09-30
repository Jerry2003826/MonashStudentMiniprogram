import json
import re

import pytest
from django.core import mail

from apps.core import services
from apps.core.models import EmailCode, User

pytestmark = pytest.mark.django_db


@pytest.fixture
def member_headers():
    user = User.objects.create_user(username="custom-domain", openid="custom-domain")
    return {"HTTP_AUTHORIZATION": f"Bearer {services.issue_token(user)}"}


def test_public_config_exposes_only_normalized_domains(client, settings):
    settings.MEMBERSHIP_ALLOWED_EMAIL_DOMAINS = [
        " Students.Example.edu ",
        "alumni.example.org",
        "students.example.edu",
    ]
    response = client.get("/api/v1/membership/config")
    assert response.status_code == 200
    assert response.json() == {
        "allowed_email_domains": ["students.example.edu", "alumni.example.org"]
    }


@pytest.mark.parametrize("domain", ["students.example.edu", "alumni.example.org"])
def test_custom_domains_can_send_and_submit(client, settings, member_headers, domain):
    settings.MEMBERSHIP_ALLOWED_EMAIL_DOMAINS = ["students.example.edu", "alumni.example.org"]
    email = f"Student@{domain.upper()}"
    sent = client.post(
        "/api/v1/membership/email-code",
        data=json.dumps({"email": email}),
        content_type="application/json",
        **member_headers,
    )
    assert sent.status_code == 200
    assert mail.outbox[-1].to == [email.lower()]
    code = re.search(r"验证码是 ([0-9]{6})", mail.outbox[-1].body).group(1)
    applied = client.post(
        "/api/v1/membership/applications",
        data=json.dumps({"email": email, "code": code}),
        content_type="application/json",
        **member_headers,
    )
    assert applied.status_code == 200
    assert applied.json()["membership"]["application"]["email"] == email.lower()
    assert applied.json()["membership"]["application"]["status"] == "pending"


@pytest.mark.parametrize(
    "email",
    [
        "student@student.monash.edu",
        "student@sub.students.example.edu",
        "student@students.example.edu.evil.test",
        "student@other.example.edu",
        "student@@students.example.edu",
        "student @students.example.edu",
        "@students.example.edu",
        "student..name@students.example.edu",
    ],
)
def test_replaced_and_malformed_emails_are_rejected(client, settings, member_headers, email):
    settings.MEMBERSHIP_ALLOWED_EMAIL_DOMAINS = ["students.example.edu"]
    for endpoint, fields in [("email-code", {}), ("applications", {"code": "123456"})]:
        response = client.post(
            f"/api/v1/membership/{endpoint}",
            data=json.dumps({"email": email, **fields}),
            content_type="application/json",
            **member_headers,
        )
        assert response.status_code == 422
    assert not EmailCode.objects.exists()


@pytest.mark.parametrize(
    "domains",
    [
        [],
        None,
        "students.example.edu",
        [""],
        ["students.example.edu", None],
        ["students.example.edu", "@bad.example.edu"],
        ["https://students.example.edu"],
        ["*.students.example.edu"],
        ["student@example.edu"],
        ["students..example.edu"],
        ["-students.example.edu"],
    ],
)
def test_invalid_config_fails_closed(client, settings, member_headers, domains):
    settings.MEMBERSHIP_ALLOWED_EMAIL_DOMAINS = domains
    config = client.get("/api/v1/membership/config")
    assert config.status_code == 503
    assert config.json()["code"] == "INTERNAL_ERROR"
    for endpoint, fields in [("email-code", {}), ("applications", {"code": "123456"})]:
        response = client.post(
            f"/api/v1/membership/{endpoint}",
            data=json.dumps({"email": "student@students.example.edu", **fields}),
            content_type="application/json",
            **member_headers,
        )
        assert response.status_code == 503
    assert not EmailCode.objects.exists()
