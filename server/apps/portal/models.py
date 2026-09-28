import uuid

from django.conf import settings
from django.db import models


class LoginChallenge(models.Model):
    """Short-lived browser pairing. The code alone can never establish a session."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code_digest = models.CharField(max_length=64, unique=True)
    browser_digest = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(db_index=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="portal_login_challenges",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    consumed_at = models.DateTimeField(null=True, blank=True)


class LoginRateLimit(models.Model):
    """Database-backed fixed windows shared by all workers; identifiers are HMACs."""

    key = models.CharField(max_length=64, primary_key=True)
    hits = models.PositiveIntegerField(default=0)
    expires_at = models.DateTimeField(db_index=True)
