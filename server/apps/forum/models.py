from django.conf import settings
from django.db import models
from django.db.models import Q


class ModerationStatus(models.TextChoices):
    PENDING = "pending", "待审核"
    APPROVED = "approved", "已通过"
    REJECTED = "rejected", "已拒绝"


class Board(models.Model):
    name = models.CharField(max_length=40, unique=True)
    intro = models.CharField(max_length=300, blank=True)
    staff_only = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["pk"]


class Post(models.Model):
    Status = ModerationStatus

    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="forum_posts"
    )
    board = models.ForeignKey(Board, on_delete=models.PROTECT, related_name="posts")
    title = models.CharField(max_length=50)
    content = models.TextField(max_length=5000)
    status = models.CharField(
        max_length=12, choices=ModerationStatus.choices, default=ModerationStatus.PENDING
    )
    review_note = models.CharField(max_length=1000, blank=True)
    reviewer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="reviewed_forum_posts",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    is_pinned = models.BooleanField(default=False)
    deleted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-is_pinned", "-created_at", "-pk"]
        indexes = [models.Index(fields=["status", "deleted", "-created_at"])]
        constraints = [
            models.CheckConstraint(
                condition=Q(status__in=ModerationStatus.values), name="forum_post_valid_status"
            ),
            models.CheckConstraint(
                condition=Q(is_pinned=False) | Q(status="approved"),
                name="forum_pinned_post_approved",
            ),
        ]


class Comment(models.Model):
    Status = ModerationStatus

    post = models.ForeignKey(Post, on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="forum_comments"
    )
    reply_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="forum_replies",
    )
    content = models.CharField(max_length=500)
    status = models.CharField(
        max_length=12, choices=ModerationStatus.choices, default=ModerationStatus.PENDING
    )
    review_note = models.CharField(max_length=1000, blank=True)
    reviewer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="reviewed_forum_comments",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    deleted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "pk"]
        indexes = [models.Index(fields=["post", "status", "deleted", "created_at"])]
        constraints = [
            models.CheckConstraint(
                condition=Q(status__in=ModerationStatus.values), name="forum_comment_valid_status"
            )
        ]


class Like(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="forum_likes"
    )
    post = models.ForeignKey(Post, on_delete=models.CASCADE, related_name="likes")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "post"], name="forum_unique_like")]


class Report(models.Model):
    class Status(models.TextChoices):
        NEW = "new", "待处理"
        RESOLVED = "resolved", "已处理"

    class TargetType(models.TextChoices):
        POST = "post", "帖子"
        COMMENT = "comment", "评论"

    class Reason(models.TextChoices):
        AD = "ad", "广告"
        PORN = "porn", "色情低俗"
        ABUSE = "abuse", "人身攻击"
        ILLEGAL = "illegal", "违法违规"
        OTHER = "other", "其他"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="forum_reports"
    )
    target_type = models.CharField(max_length=10, choices=TargetType.choices)
    target_id = models.PositiveBigIntegerField()
    reason = models.CharField(max_length=10, choices=Reason.choices)
    detail = models.CharField(max_length=1000, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.NEW)
    resolution_note = models.CharField(max_length=1000, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-pk"]
        indexes = [models.Index(fields=["user", "created_at"])]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "target_type", "target_id"], name="forum_unique_report"
            ),
            models.CheckConstraint(
                condition=Q(target_type__in=["post", "comment"]),
                name="forum_report_valid_target",
            ),
            models.CheckConstraint(
                condition=Q(status__in=["new", "resolved"]), name="forum_report_valid_status"
            ),
            models.CheckConstraint(
                condition=Q(reason__in=["ad", "porn", "abuse", "illegal", "other"]),
                name="forum_report_valid_reason",
            ),
        ]
