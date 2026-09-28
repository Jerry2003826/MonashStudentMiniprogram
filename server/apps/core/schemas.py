from typing import Literal

from ninja import Schema
from pydantic import ConfigDict, Field


class StrictInput(Schema):
    model_config = ConfigDict(extra="forbid", strict=True)


class WechatLoginInput(StrictInput):
    code: str = Field(min_length=1, max_length=512)


class DevLoginInput(StrictInput):
    username: Literal["demo-owner", "demo-reviewer", "demo-editor", "demo-student"]


class EmailCodeInput(StrictInput):
    email: str = Field(min_length=5, max_length=254)


class ApplicationInput(EmailCodeInput):
    code: str = Field(pattern=r"^[0-9]{6}$")


class ProfileInput(StrictInput):
    nickname: str = Field(min_length=1, max_length=20)


class ReviewInput(StrictInput):
    decision: Literal["approved", "rejected"]
    note: str = Field(default="", max_length=1000)


class CreateStaffInput(StrictInput):
    user_id: int = Field(gt=0)
    role: Literal["owner", "reviewer", "editor"]


class UpdateStaffInput(StrictInput):
    role: Literal["owner", "reviewer", "editor"] | None = None
    is_active: bool | None = None


class ApplicationOutput(Schema):
    id: int
    email: str
    status: Literal["pending", "approved", "rejected"]
    submitted_at: str
    reviewed_at: str | None
    review_note: str


class MembershipOutput(Schema):
    state: Literal["none", "active", "expired", "revoked"]
    member_no: str | None
    email: str | None
    expires_at: str | None
    renewable: bool
    application: ApplicationOutput | None


class MeOutput(Schema):
    id: int
    nickname: str
    avatar_url: str | None
    banned_until: str | None
    membership: MembershipOutput
    staff_role: Literal["owner", "reviewer", "editor"] | None


class LoginOutput(Schema):
    token: str
    me: MeOutput


class StaffOutput(Schema):
    id: int
    user_id: int
    nickname: str
    role: Literal["owner", "reviewer", "editor"]
    is_active: bool
