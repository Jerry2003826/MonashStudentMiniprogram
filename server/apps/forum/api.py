from django.contrib.auth.models import AnonymousUser
from django.db import transaction
from ninja import Router
from ninja.errors import AuthenticationError

from apps.core.api import BearerAuth
from apps.core.errors import ServiceError

from . import services
from .models import Board
from .schemas import (
    BoardOutput,
    CommentOutput,
    CommentPageOutput,
    CreateCommentInput,
    CreatePostInput,
    CreateReportInput,
    LikeOutput,
    PostDetailOutput,
    PostPageOutput,
)


class OptionalBearerAuth(BearerAuth):
    def __call__(self, request):
        if "Authorization" not in request.headers:
            # Browser login cookies do not grant API identity or write permissions.
            return AnonymousUser()
        actor = super().__call__(request)
        if actor is None:
            raise AuthenticationError()
        return actor


router = Router(tags=["forum"], auth=OptionalBearerAuth())


@router.get("/boards", response=list[BoardOutput])
def boards(request):
    return [services.board_data(board) for board in Board.objects.filter(is_active=True)]


@router.get("/posts", response=PostPageOutput)
def posts(
    request,
    board: int | None = None,
    q: str = "",
    author: str | None = None,
    cursor: str | None = None,
):
    rows, next_cursor = services.list_posts(request.auth, board, q, author, cursor)
    return {
        "items": [services.post_data(post, request.auth) for post in rows],
        "next_cursor": next_cursor,
    }


@router.get("/posts/{post_id}", response=PostDetailOutput)
def post_detail(request, post_id: int):
    return services.post_data(services.get_post(request.auth, post_id), request.auth, detail=True)


@router.post("/posts", response=PostDetailOutput)
def post_create(request, payload: CreatePostInput):
    post = services.create_post(
        request.auth,
        payload.board_id,
        payload.title,
        payload.content,
        payload.image_ids,
        request=request,
    )
    return services.post_data(post, request.auth, detail=True)


@router.delete("/posts/{post_id}")
def post_delete(request, post_id: int):
    services.delete_post(request.auth, post_id)
    return None


@router.get("/posts/{post_id}/comments", response=CommentPageOutput)
def comments(request, post_id: int, cursor: str | None = None):
    post = services.interactive_post(post_id)
    rows, next_cursor = services.page_of(
        services.visible_comments(request.auth, post), cursor, services.COMMENT_PAGE_SIZE
    )
    return {
        "items": [services.comment_data(comment, request.auth) for comment in rows],
        "next_cursor": next_cursor,
    }


@router.post("/posts/{post_id}/comments", response=CommentOutput)
def comment_create(request, post_id: int, payload: CreateCommentInput):
    comment = services.create_comment(
        request.auth, post_id, payload.content, payload.reply_to_user_id, request=request
    )
    return services.comment_data(comment, request.auth)


@router.delete("/comments/{comment_id}")
def comment_delete(request, comment_id: int):
    services.delete_comment(request.auth, comment_id)
    return None


@router.put("/posts/{post_id}/like", response=LikeOutput)
def like_post(request, post_id: int):
    return services.set_like(request.auth, post_id, True)


@router.delete("/posts/{post_id}/like", response=LikeOutput)
def unlike_post(request, post_id: int):
    return services.set_like(request.auth, post_id, False)


@router.post("/reports")
def report(request, payload: CreateReportInput):
    services.report_content(
        request.auth, payload.target_type, payload.target_id, payload.reason, payload.detail
    )
    return None


@router.post("/images")
@transaction.atomic
def upload_image(request):
    services.require_writer(request.auth)
    raise ServiceError(422, "VALIDATION_ERROR", "当前仅开放纯文本论坛，图片上传尚未开放")
