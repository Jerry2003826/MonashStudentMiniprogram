from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models
from django.db.models import Q


class User(AbstractUser):
    openid = models.CharField(max_length=128, unique=True, null=True, blank=True)
    nickname = models.CharField(max_length=20, default="微信用户")
    avatar_url = models.URLField(max_length=1000, blank=True)
    banned_until = models.DateTimeField(null=True, blank=True)


class StaffAccount(models.Model):
    class Role(models.TextChoices):
        OWNER = "owner", "负责人"
        REVIEWER = "reviewer", "会员审核员"
        EDITOR = "editor", "内容编辑"

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="staff_account"
    )
    role = models.CharField(max_length=12, choices=Role.choices)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(role__in=["owner", "reviewer", "editor"]), name="valid_staff_role"
            )
        ]


class AuthToken(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="api_tokens"
    )
    token_hash = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(db_index=True)


class Membership(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="membership_record"
    )
    email = models.EmailField(unique=True)
    approved_at = models.DateTimeField()
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)


class Application(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "待审核"
        APPROVED = "approved", "已批准"
        REJECTED = "rejected", "已拒绝"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="membership_applications"
    )
    email = models.EmailField()
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING)
    submitted_at = models.DateTimeField(auto_now_add=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="reviewed_applications",
    )
    review_note = models.CharField(max_length=1000, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user"],
                condition=Q(status="pending"),
                name="one_pending_application_per_user",
            ),
            models.UniqueConstraint(
                fields=["email"],
                condition=Q(status="pending"),
                name="one_pending_application_per_email",
            ),
            models.CheckConstraint(
                condition=Q(status__in=["pending", "approved", "rejected"]),
                name="valid_application_status",
            ),
        ]
        ordering = ["-submitted_at", "-pk"]


class EmailThrottle(models.Model):
    email = models.EmailField(primary_key=True)


class EmailCode(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    email = models.EmailField(db_index=True)
    code_hash = models.CharField(max_length=64)
    attempts = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)


class AuditLog(models.Model):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    action = models.CharField(max_length=80)
    target_type = models.CharField(max_length=40)
    target_id = models.PositiveBigIntegerField()
    details = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
