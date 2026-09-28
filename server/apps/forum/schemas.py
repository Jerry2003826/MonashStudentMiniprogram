from typing import Literal

from ninja import Schema
from pydantic import Field

from apps.core.schemas import StrictInput

ModerationValue = Literal["pending", "approved", "rejected"]


class CreatePostInput(StrictInput):
    board_id: int = Field(gt=0)
    title: str = Field(min_length=1, max_length=50)
    content: str = Field(min_length=1, max_length=5000)
    image_ids: list[int] = Field(default_factory=list, max_length=9)


class CreateCommentInput(StrictInput):
    content: str = Field(min_length=1, max_length=500)
    reply_to_user_id: int | None = Field(default=None, gt=0)


class CreateReportInput(StrictInput):
    target_type: Literal["post", "comment"]
    target_id: int = Field(gt=0)
    reason: Literal["ad", "porn", "abuse", "illegal", "other"]
    detail: str = Field(default="", max_length=1000)


class AuthorOutput(Schema):
    id: int
    nickname: str
    avatar_url: str | None


class BoardOutput(Schema):
    id: int
    name: str
    intro: str
    staff_only: bool


class PostSummaryOutput(Schema):
    id: int
    board: BoardOutput
    title: str
    excerpt: str
    thumbnail_urls: list[str]
    author: AuthorOutput
    like_count: int
    comment_count: int
    is_pinned: bool
    created_at: str
    moderation_status: ModerationValue
    review_note: str


class PostDetailOutput(Schema):
    id: int
    board: BoardOutput
    title: str
    content: str
    images: list[dict]
    author: AuthorOutput
    like_count: int
    comment_count: int
    liked: bool
    is_pinned: bool
    is_mine: bool
    created_at: str
    moderation_status: ModerationValue
    review_note: str


class CommentOutput(Schema):
    id: int
    author: AuthorOutput
    reply_to: AuthorOutput | None
    content: str
    created_at: str
    is_mine: bool
    moderation_status: ModerationValue
    review_note: str


class PostPageOutput(Schema):
    items: list[PostSummaryOutput]
    next_cursor: str | None


class CommentPageOutput(Schema):
    items: list[CommentOutput]
    next_cursor: str | None


class LikeOutput(Schema):
    liked: bool
    like_count: int
