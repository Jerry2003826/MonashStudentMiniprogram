import re
from datetime import timedelta

from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone

from apps.core import wechat_safety
from apps.core.errors import ServiceError
from apps.core.models import AuditLog, User
from apps.core.permissions import require_staff
from apps.core.services import require_active_member

from .models import Board, Comment, Like, ModerationStatus, Post, Report

REPORT_DAILY_LIMIT = 10
POST_DAILY_LIMIT = 20
POST_COOLDOWN_SECONDS = 30
COMMENT_DAILY_LIMIT = 100
COMMENT_COOLDOWN_SECONDS = 10
POST_PAGE_SIZE = 10
COMMENT_PAGE_SIZE = 20


def require_identity(actor):
    if not actor or not actor.is_authenticated:
        raise ServiceError(401, "UNAUTHORIZED", "请先登录")
    if not actor.is_active:
        raise ServiceError(403, "FORBIDDEN", "账号已停用")
    return actor


def can_manage_content(actor):
    if not actor or not actor.is_authenticated:
        return False
    try:
        require_staff(actor, "content.manage")
    except ServiceError:
        return False
    return True


def require_writer(actor):
    # Every caller holds an atomic transaction. Serialize per-user writes/limits
    # and reread the account instead of trusting a stale authentication instance.
    require_identity(actor)
    user = User.objects.select_for_update().filter(pk=actor.pk, is_active=True).first()
    if user is None:
        raise ServiceError(403, "FORBIDDEN", "账号已停用")
    require_active_member(user)
    if user.banned_until and user.banned_until > timezone.now():
        raise ServiceError(403, "USER_BANNED", "你已被禁言，暂时不能发布或互动")
    return user


def text_value(value, label, maximum, allow_empty=False):
    if not isinstance(value, str):
        raise ServiceError(422, "VALIDATION_ERROR", f"{label}格式不正确")
    value = value.strip()
    if (not value and not allow_empty) or len(value) > maximum:
        raise ServiceError(
            422, "VALIDATION_ERROR", f"{label}需要 {'0' if allow_empty else '1'}–{maximum} 字"
        )
    return value


def moderation_filter(actor, prefix=""):
    if can_manage_content(actor):
        return Q()
    condition = Q(**{f"{prefix}status": ModerationStatus.APPROVED})
    if actor and actor.is_authenticated:
        condition |= Q(**{f"{prefix}author_id": actor.pk})
    return condition


def visible_posts(actor):
    rows = Post.objects.filter(deleted=False).filter(moderation_filter(actor))
    if not can_manage_content(actor):
        rows = rows.filter(board__is_active=True)
    return rows.select_related("board", "author").annotate(
        likes_total=Count("likes", distinct=True),
        visible_comments_total=Count(
            "comments",
            filter=Q(comments__deleted=False, comments__status=ModerationStatus.APPROVED),
            distinct=True,
        ),
    )


def get_post(actor, post_id):
    post = visible_posts(actor).filter(pk=post_id).first()
    if post is None:
        raise ServiceError(404, "NOT_FOUND", "帖子不存在或暂不可见")
    return post


def interactive_post(post_id, lock=False):
    rows = Post.objects.filter(
        pk=post_id, deleted=False, status=ModerationStatus.APPROVED, board__is_active=True
    )
    if lock:
        rows = rows.select_for_update(of=("self",))
    post = rows.first()
    if post is None:
        raise ServiceError(404, "NOT_FOUND", "帖子不存在或暂不可互动")
    return post


def visible_comments(actor, post):
    return (
        Comment.objects.filter(post=post, deleted=False)
        .filter(moderation_filter(actor))
        .select_related("author", "reply_to")
    )


def page_of(rows, cursor, page_size):
    if cursor is None or cursor == "":
        offset = 0
    elif not isinstance(cursor, str) or not re.fullmatch(r"[0-9]{1,9}", cursor):
        raise ServiceError(422, "VALIDATION_ERROR", "分页位置无效，请刷新重试")
    else:
        offset = int(cursor)
    items = list(rows[offset : offset + page_size + 1])
    return items[:page_size], str(offset + page_size) if len(items) > page_size else None


def list_posts(actor, board=None, q="", author=None, cursor=None):
    if author not in (None, "me"):
        raise ServiceError(422, "VALIDATION_ERROR", "作者筛选无效")
    rows = visible_posts(actor)
    if author == "me":
        require_identity(actor)
        rows = rows.filter(author=actor)
    else:
        rows = rows.filter(status=ModerationStatus.APPROVED, board__is_active=True)
    if board is not None:
        if board <= 0:
            raise ServiceError(422, "VALIDATION_ERROR", "板块编号无效")
        rows = rows.filter(board_id=board)
    keyword = text_value(q, "搜索内容", 100, allow_empty=True)
    if keyword:
        rows = rows.filter(Q(title__icontains=keyword) | Q(content__icontains=keyword))
    return page_of(rows, cursor, POST_PAGE_SIZE)


def check_publish_limit(user, model, cooldown, daily_limit):
    rows = model.objects.filter(author=user)
    now = timezone.now()
    if rows.filter(created_at__gt=now - timedelta(seconds=cooldown)).exists():
        raise ServiceError(429, "RATE_LIMITED", f"发布太频繁，请 {cooldown} 秒后再试")
    if rows.filter(created_at__date=timezone.localdate()).count() >= daily_limit:
        raise ServiceError(429, "RATE_LIMITED", "今天发布的内容较多，请明天再试")


@transaction.atomic
def create_post(actor, board_id, title, content, image_ids=None, *, request=None):
    user = require_writer(actor)
    if image_ids:
        raise ServiceError(422, "VALIDATION_ERROR", "当前仅开放纯文本发帖，图片上传尚未开放")
    title = text_value(title, "标题", 50)
    content = text_value(content, "正文", 5000)
    board = Board.objects.filter(pk=board_id, is_active=True).first()
    if board is None:
        raise ServiceError(422, "VALIDATION_ERROR", "请选择有效板块")
    if board.staff_only:
        require_staff(user, "content.manage")
    check_publish_limit(user, Post, POST_COOLDOWN_SECONDS, POST_DAILY_LIMIT)
    wechat_safety.check_text(user, f"{title}\n{content}", 3, request=request, title=title)
    return Post.objects.create(author=user, board=board, title=title, content=content)


@transaction.atomic
def create_comment(actor, post_id, content, reply_to_user_id=None, *, request=None):
    user = require_writer(actor)
    post = interactive_post(post_id, lock=True)
    content = text_value(content, "评论", 500)
    if reply_to_user_id is not None:
        participant = (
            reply_to_user_id == post.author_id
            or visible_comments(user, post).filter(author_id=reply_to_user_id).exists()
        )
        if not participant:
            raise ServiceError(422, "VALIDATION_ERROR", "只能回复本帖作者或可见评论的参与者")
    check_publish_limit(user, Comment, COMMENT_COOLDOWN_SECONDS, COMMENT_DAILY_LIMIT)
    wechat_safety.check_text(user, content, 2, request=request)
    return Comment.objects.create(
        post=post, author=user, reply_to_id=reply_to_user_id, content=content
    )


@transaction.atomic
def delete_post(actor, post_id):
    require_identity(actor)
    post = Post.objects.select_for_update().filter(pk=post_id, deleted=False).first()
    if post is None:
        raise ServiceError(404, "NOT_FOUND", "帖子不存在或已删除")
    if post.author_id != actor.pk:
        require_staff(actor, "content.manage")
    post.deleted = True
    post.is_pinned = False
    post.save(update_fields=["deleted", "is_pinned", "updated_at"])
    AuditLog.objects.create(
        actor=actor, action="forum.post.delete", target_type="forum_post", target_id=post.pk
    )


@transaction.atomic
def delete_comment(actor, comment_id):
    require_identity(actor)
    comment = Comment.objects.select_for_update().filter(pk=comment_id, deleted=False).first()
    if comment is None:
        raise ServiceError(404, "NOT_FOUND", "评论不存在或已删除")
    interactive_post(comment.post_id, lock=True)
    if comment.author_id != actor.pk:
        require_staff(actor, "content.manage")
    comment.deleted = True
    comment.save(update_fields=["deleted"])
    AuditLog.objects.create(
        actor=actor,
        action="forum.comment.delete",
        target_type="forum_comment",
        target_id=comment.pk,
    )


@transaction.atomic
def set_like(actor, post_id, liked):
    user = require_writer(actor)
    post = interactive_post(post_id, lock=True)
    if liked:
        Like.objects.get_or_create(user=user, post=post)
    else:
        Like.objects.filter(user=user, post=post).delete()
    return {"liked": liked, "like_count": Like.objects.filter(post=post).count()}


@transaction.atomic
def report_content(actor, target_type, target_id, reason, detail=""):
    user = require_writer(actor)
    if target_type not in Report.TargetType.values or reason not in Report.Reason.values:
        raise ServiceError(422, "VALIDATION_ERROR", "举报类型或原因无效")
    detail = text_value(detail, "举报说明", 1000, allow_empty=True)
    if target_type == Report.TargetType.POST:
        interactive_post(target_id)
    else:
        comment = Comment.objects.filter(
            pk=target_id, deleted=False, status=ModerationStatus.APPROVED
        ).first()
        if comment is None:
            raise ServiceError(404, "NOT_FOUND", "举报的评论不存在或暂不可见")
        interactive_post(comment.post_id)
    previous = Report.objects.filter(
        user=user, target_type=target_type, target_id=target_id
    ).first()
    if previous:
        return previous
    if (
        Report.objects.filter(user=user, created_at__date=timezone.localdate()).count()
        >= REPORT_DAILY_LIMIT
    ):
        raise ServiceError(429, "RATE_LIMITED", "今天提交的举报较多，请明天再试")
    return Report.objects.create(
        user=user, target_type=target_type, target_id=target_id, reason=reason, detail=detail
    )


def review_values(decision, note):
    if decision not in (ModerationStatus.APPROVED, ModerationStatus.REJECTED):
        raise ServiceError(422, "VALIDATION_ERROR", "请选择通过或拒绝")
    return text_value(note, "审核意见", 1000, allow_empty=decision != ModerationStatus.REJECTED)


@transaction.atomic
def moderate_post(actor, id, decision, note="", pinned=None):
    require_staff(actor, "content.manage")
    note = review_values(decision, note)
    if pinned is not None and not isinstance(pinned, bool):
        raise ServiceError(422, "VALIDATION_ERROR", "置顶状态无效")
    if pinned and decision != ModerationStatus.APPROVED:
        raise ServiceError(422, "VALIDATION_ERROR", "只有审核通过的帖子可以置顶")
    post = Post.objects.select_for_update().filter(pk=id, deleted=False).first()
    if post is None:
        raise ServiceError(404, "NOT_FOUND", "帖子不存在或已删除")
    post.status = decision
    post.review_note = note
    post.reviewer = actor
    post.reviewed_at = timezone.now()
    if decision == ModerationStatus.REJECTED:
        post.is_pinned = False
    elif pinned is not None:
        post.is_pinned = pinned
    post.save(
        update_fields=[
            "status",
            "review_note",
            "reviewer",
            "reviewed_at",
            "is_pinned",
            "updated_at",
        ]
    )
    AuditLog.objects.create(
        actor=actor,
        action="forum.post.review",
        target_type="forum_post",
        target_id=post.pk,
        details={"decision": decision, "pinned": post.is_pinned},
    )
    return post


@transaction.atomic
def set_post_pinned(actor, id, is_pinned):
    require_staff(actor, "content.manage")
    if not isinstance(is_pinned, bool):
        raise ServiceError(422, "VALIDATION_ERROR", "置顶状态无效")
    post = (
        Post.objects.select_for_update()
        .filter(pk=id, deleted=False, status=ModerationStatus.APPROVED)
        .first()
    )
    if post is None:
        raise ServiceError(404, "NOT_FOUND", "只能置顶未删除且审核通过的帖子")
    post.is_pinned = is_pinned
    post.save(update_fields=["is_pinned", "updated_at"])
    AuditLog.objects.create(
        actor=actor,
        action="forum.post.pin",
        target_type="forum_post",
        target_id=post.pk,
        details={"pinned": is_pinned},
    )
    return post


@transaction.atomic
def moderate_comment(actor, id, decision, note=""):
    require_staff(actor, "content.manage")
    note = review_values(decision, note)
    comment = (
        Comment.objects.select_for_update()
        .filter(pk=id, deleted=False, post__deleted=False)
        .first()
    )
    if comment is None:
        raise ServiceError(404, "NOT_FOUND", "评论不存在或所属帖子已删除")
    comment.status = decision
    comment.review_note = note
    comment.reviewer = actor
    comment.reviewed_at = timezone.now()
    comment.save(update_fields=["status", "review_note", "reviewer", "reviewed_at"])
    AuditLog.objects.create(
        actor=actor,
        action="forum.comment.review",
        target_type="forum_comment",
        target_id=comment.pk,
        details={"decision": decision},
    )
    return comment


@transaction.atomic
def resolve_report(actor, id, note=""):
    require_staff(actor, "content.manage")
    note = text_value(note, "处理说明", 1000)
    report = Report.objects.select_for_update().filter(pk=id).first()
    if report is None:
        raise ServiceError(404, "NOT_FOUND", "举报记录不存在")
    if report.status == Report.Status.RESOLVED:
        return report
    report.status = Report.Status.RESOLVED
    report.resolution_note = note
    report.save(update_fields=["status", "resolution_note"])
    AuditLog.objects.create(
        actor=actor, action="forum.report.resolve", target_type="forum_report", target_id=report.pk
    )
    return report


def author_data(author):
    return {"id": author.pk, "nickname": author.nickname, "avatar_url": author.avatar_url or None}


def board_data(board):
    return {
        "id": board.pk,
        "name": board.name,
        "intro": board.intro,
        "staff_only": board.staff_only,
    }


def post_data(post, actor, detail=False):
    approved = post.status == ModerationStatus.APPROVED
    own = bool(actor and actor.is_authenticated and post.author_id == actor.pk)
    data = {
        "id": post.pk,
        "board": board_data(post.board),
        "title": post.title,
        "author": author_data(post.author),
        "is_pinned": post.is_pinned,
        "created_at": post.created_at.isoformat(),
        "moderation_status": post.status,
        "review_note": post.review_note if own or can_manage_content(actor) else "",
        "like_count": getattr(post, "likes_total", None) if approved else 0,
        "comment_count": getattr(post, "visible_comments_total", None) if approved else 0,
    }
    if data["like_count"] is None:
        data["like_count"] = Like.objects.filter(post=post).count()
    if data["comment_count"] is None:
        data["comment_count"] = Comment.objects.filter(
            post=post, deleted=False, status=ModerationStatus.APPROVED
        ).count()
    if detail:
        data.update(
            {
                "content": post.content,
                "images": [],
                "is_mine": own,
                "liked": bool(
                    approved
                    and actor
                    and actor.is_authenticated
                    and Like.objects.filter(post=post, user=actor).exists()
                ),
            }
        )
    else:
        data.update({"excerpt": post.content[:160], "thumbnail_urls": []})
    return data


def comment_data(comment, actor):
    own = bool(actor and actor.is_authenticated and comment.author_id == actor.pk)
    return {
        "id": comment.pk,
        "author": author_data(comment.author),
        "reply_to": author_data(comment.reply_to) if comment.reply_to else None,
        "content": comment.content,
        "created_at": comment.created_at.isoformat(),
        "is_mine": own,
        "moderation_status": comment.status,
        "review_note": comment.review_note if own or can_manage_content(actor) else "",
    }
