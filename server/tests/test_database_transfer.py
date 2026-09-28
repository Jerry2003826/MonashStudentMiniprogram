import copy
import io
import stat
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType
from django.contrib.sessions.models import Session
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from django.db.migrations.recorder import MigrationRecorder

from apps.content.models import (
    Activity,
    Area,
    Banner,
    Category,
    Feedback,
    HandbookSection,
    Merchant,
    SupportSettings,
)
from apps.core import database_transfer as transfer
from apps.core.models import (
    Application,
    AuditLog,
    AuthToken,
    EmailCode,
    EmailThrottle,
    Membership,
    StaffAccount,
    User,
)
from apps.forum.models import Board, Comment, Like, Post, Report
from apps.portal.models import LoginChallenge, LoginRateLimit

pytestmark = pytest.mark.django_db
STAMP = datetime(2026, 9, 28, 8, 9, 10, 123456, tzinfo=UTC)


@pytest.fixture(autouse=True)
def clear_content_type_cache():
    ContentType.objects.clear_cache()
    yield
    ContentType.objects.clear_cache()


@pytest.fixture
def business_data():
    owner = User.objects.create_user(
        pk=41,
        username="private-owner",
        openid="private-openid",
        nickname="迁移负责人",
        email="private@example.org",
        password="private-password",
        is_staff=True,
        first_name="负责人",
        last_name="测试",
        banned_until=STAMP + timedelta(days=1),
        last_login=STAMP,
        date_joined=STAMP,
    )
    student = User.objects.create_user(pk=85, username="private-student", password=None)
    group = Group.objects.create(pk=17, name="迁移权限组")
    permission = Permission.objects.get(codename="change_post", content_type__app_label="forum")
    group.permissions.add(permission)
    owner.groups.add(group)
    owner.user_permissions.add(permission)
    StaffAccount.objects.create(pk=51, user=owner, role="owner")
    Membership.objects.create(
        pk=23,
        user=student,
        email="private@student.monash.edu",
        approved_at=STAMP,
        expires_at=STAMP + timedelta(days=365),
        revoked_at=STAMP + timedelta(days=2),
    )
    Application.objects.create(
        pk=29,
        user=student,
        email="private@student.monash.edu",
        status="approved",
        reviewer=owner,
        reviewed_at=STAMP,
        review_note="保留审核记录",
    )
    AuditLog.objects.create(
        actor=owner,
        action="migration.example",
        target_type="application",
        target_id=29,
        details={"嵌套": [1, 1.25, True, None, {"秘密": "private-audit-content"}], "空": {}},
    )
    activity = Activity.objects.create(
        title="示例活动",
        summary="摘要",
        category="past",
        starts_at=STAMP,
        content="活动正文",
        location="墨尔本",
        published=True,
    )
    category = Category.objects.create(pk=31, name="餐饮")
    area = Area.objects.create(pk=61, name="校区")
    merchant = Merchant.objects.create(
        pk=71,
        name="示例商家",
        category=category,
        area=area,
        discount_summary="会员优惠",
        intro="介绍",
        discount_terms="条款",
        image_urls=["https://example.org/a.png"],
        address="示例地址",
        latitude=-37.8136123456,
        longitude=144.9631123456,
        published=True,
        featured=True,
    )
    Banner.objects.create(
        title="商家轮播",
        image_url="https://example.org/banner.png",
        link_type="merchant",
        link_id=merchant.pk,
        published=True,
    )
    HandbookSection.objects.create(title="手册", content="内容", published=True, sort_order=4)
    SupportSettings.objects.create(website_url="https://example.org", assistant_wechat="example")
    Feedback.objects.create(
        user=student,
        category="suggestion",
        content="这是一条足够长的迁移测试建议",
        contact="private-contact",
        status="resolved",
        resolution_note="保留处理记录",
    )
    board = Board.objects.create(pk=21, name="示例板块", intro="介绍", staff_only=True)
    post = Post.objects.create(
        pk=91,
        board=board,
        author=student,
        title="测试帖子",
        content="private-post-content",
        status="approved",
        reviewer=owner,
        reviewed_at=STAMP,
        is_pinned=True,
    )
    comment = Comment.objects.create(
        pk=101,
        post=post,
        author=owner,
        reply_to=student,
        content="private-comment-content",
        status="rejected",
        reviewer=owner,
        reviewed_at=STAMP,
        review_note="private-review-note",
    )
    Like.objects.create(user=owner, post=post)
    Report.objects.create(
        user=student,
        target_type="comment",
        target_id=comment.pk,
        reason="other",
        detail="private-report-content",
        status="resolved",
        resolution_note="已处理",
    )
    # auto_now and auto_now_add must survive raw fixture import without changing.
    for label in transfer.BUSINESS_MODELS:
        model = transfer.classified_models()[label]
        values = {
            field.name: STAMP
            for field in model._meta.local_fields
            if field.name in {"created_at", "updated_at", "submitted_at"}
        }
        if values:
            model.objects.update(**values)
    return {"owner": owner, "student": student, "permission": permission, "activity": activity}


def temporary_data(user):
    AuthToken.objects.create(user=user, token_hash="private-token-hash", expires_at=STAMP)
    EmailCode.objects.create(
        user=user, email="private-code@example.org", code_hash="private-code-hash", expires_at=STAMP
    )
    EmailThrottle.objects.create(email="private-throttle@example.org")
    LoginChallenge.objects.create(
        code_digest="private-code-digest",
        browser_digest="private-browser-digest",
        expires_at=STAMP,
        approved_by=user,
    )
    LoginRateLimit.objects.create(key="private-rate-key", hits=2, expires_at=STAMP)
    Session.objects.create(
        session_key="private-session-key", session_data="private-session", expire_date=STAMP
    )


def clear_test_business_and_temporary():
    models = transfer.classified_models()
    for label in reversed(transfer.TEMPORARY_MODELS + transfer.BUSINESS_MODELS):
        models[label].objects.all().delete()


def resign(package):
    package.update(transfer.fixture_summary(package["fixture"], transfer.classified_models()))
    package["sha256"] = transfer.digest(
        {key: value for key, value in package.items() if key != "sha256"}
    )
    return package


def invoke(command, path, **options):
    stdout = io.StringIO()
    call_command(command, str(path), stdout=stdout, **options)
    return stdout.getvalue()


def sequence_state():
    with connection.cursor() as cursor:
        if connection.vendor == "postgresql":
            cursor.execute(
                "SELECT schemaname, sequencename, last_value FROM pg_sequences "
                "WHERE schemaname = current_schema() ORDER BY sequencename"
            )
        else:
            cursor.execute("SELECT name, seq FROM sqlite_sequence ORDER BY name")
        return cursor.fetchall()


def test_export_requires_maintenance_protects_file_excludes_temporary_and_preserves_precision(
    business_data, tmp_path
):
    temporary_data(business_data["owner"])
    path = tmp_path / "transfer.json"
    with pytest.raises(CommandError, match="maintenance-window"):
        invoke("export_database", path)
    assert not path.exists()
    output = invoke("export_database", path, maintenance_window=True)
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    package = transfer.read_package(path)
    transfer.validate_package(package, transfer.classified_models())
    assert all(count > 0 for count in package["counts"].values())
    assert set(row["model"] for row in package["fixture"]) == set(transfer.BUSINESS_MODELS)
    raw = path.read_text()
    assert "2026-09-28T08:09:10.123456Z" in raw
    assert "private-token-hash" not in raw
    assert "private-code-hash" not in raw
    assert "private-session" not in raw
    assert "private-" not in output
    assert "fixture_sha256=" in output
    user = next(
        row for row in package["fixture"] if row["model"] == "core.user" and row["pk"] == 41
    )
    assert user["fields"]["groups"] == [["迁移权限组"]]
    assert user["fields"]["user_permissions"] == [["change_post", "forum", "post"]]
    assert user["fields"]["password"] == business_data["owner"].password
    before = path.read_bytes()
    with pytest.raises(CommandError, match="never be overwritten"):
        invoke("export_database", path, maintenance_window=True)
    assert path.read_bytes() == before
    symlink = tmp_path / "symlink.json"
    symlink.symlink_to(path)
    with pytest.raises(CommandError, match="never be overwritten"):
        invoke("export_database", symlink, maintenance_window=True)
    assert path.read_bytes() == before


def test_round_trip_rebinds_permission_content_type_ids_and_preserves_all_fields(
    business_data, tmp_path
):
    path = tmp_path / "transfer.json"
    invoke("export_database", path, maintenance_window=True)
    package = transfer.read_package(path)
    old_permission_id = business_data["permission"].pk
    old_content_type_id = business_data["permission"].content_type_id
    clear_test_business_and_temporary()
    # A newly migrated target can allocate different infrastructure primary keys.
    Permission.objects.all().delete()
    ContentType.objects.all().delete()
    ContentType.objects.clear_cache()
    call_command("migrate", verbosity=0)
    permission = Permission.objects.get(codename="change_post", content_type__app_label="forum")
    assert permission.pk != old_permission_id
    assert permission.content_type_id != old_content_type_id
    with pytest.raises(CommandError, match="maintenance-window"):
        invoke("import_database", path)
    output = invoke("import_database", path, maintenance_window=True)
    assert "verified and committed" in output
    assert "private-" not in output
    assert (
        transfer.verify_package(package, "default")["fixture_sha256"] == package["fixture_sha256"]
    )
    owner = User.objects.get(pk=41)
    assert owner.username == "private-owner"
    assert owner.check_password("private-password")
    assert owner.date_joined == STAMP and owner.last_login == STAMP
    assert list(owner.groups.values_list("pk", flat=True)) == [17]
    assert list(owner.user_permissions.values_list("pk", flat=True)) == [permission.pk]
    assert list(Group.objects.get(pk=17).permissions.values_list("pk", flat=True)) == [
        permission.pk
    ]
    assert Application.objects.get(pk=29).reviewer_id == 41
    assert Comment.objects.get(pk=101).reply_to_id == 85
    assert Post.objects.get(pk=91).created_at == STAMP
    assert Activity.objects.get(pk=business_data["activity"].pk).starts_at == STAMP
    assert AuditLog.objects.get().details["嵌套"][4] == {"秘密": "private-audit-content"}
    assert Merchant.objects.get(pk=71).latitude == -37.8136123456
    assert all(
        not transfer.classified_models()[label].objects.exists()
        for label in transfer.TEMPORARY_MODELS
    )
    assert "All business counts and content hashes match" in invoke("verify_database", path)
    # Explicit PK inserts must not leave sequences pointing at existing rows.
    assert User.objects.create_user(username="after-transfer").pk == 86
    assert Group.objects.create(name="after-transfer").pk == 18
    assert Board.objects.create(name="after-transfer").pk == 22


def test_verify_detects_same_count_changed_content_without_exposing_values(business_data, tmp_path):
    path = tmp_path / "transfer.json"
    invoke("export_database", path, maintenance_window=True)
    User.objects.filter(pk=41).update(nickname="private-changed-name")
    with pytest.raises(CommandError, match="core.user") as error:
        invoke("verify_database", path)
    assert "private-" not in str(error.value)
    assert User.objects.count() == 2


@pytest.mark.parametrize(
    "corruption",
    [
        "hash",
        "counts",
        "schema",
        "version",
        "model",
        "field",
        "missing",
        "pk",
        "duplicate",
        "permission-id",
    ],
)
def test_invalid_packages_are_rejected_before_any_business_write(business_data, corruption):
    package = transfer.export_package("default")
    clear_test_business_and_temporary()
    user = next(row for row in package["fixture"] if row["model"] == "core.user")
    if corruption == "hash":
        user["fields"]["nickname"] = "tampered"
    elif corruption == "counts":
        package["counts"]["core.user"] += 1
        package["sha256"] = transfer.digest(
            {key: value for key, value in package.items() if key != "sha256"}
        )
    elif corruption == "schema":
        package["schema"]["migrations"] = []
        resign(package)
    elif corruption == "version":
        package["format_version"] = 999
        resign(package)
    elif corruption == "model":
        package["fixture"].append({"model": "auth.permission", "pk": 1, "fields": {}})
        package["sha256"] = transfer.digest(
            {key: value for key, value in package.items() if key != "sha256"}
        )
    elif corruption == "field":
        user["fields"]["membership_record"] = "unexpected-reverse-relation"
        resign(package)
    elif corruption == "missing":
        del user["fields"]["is_superuser"]
        resign(package)
    elif corruption == "pk":
        del user["pk"]
        package["sha256"] = transfer.digest(
            {key: value for key, value in package.items() if key != "sha256"}
        )
    elif corruption == "duplicate":
        package["fixture"].append(copy.deepcopy(user))
        resign(package)
    else:
        user["fields"]["user_permissions"] = [business_data["permission"].pk]
        resign(package)
    with pytest.raises(CommandError):
        transfer.import_package(package, "default")
    assert not User.objects.exists()
    assert not Group.objects.exists()


def test_nonempty_business_and_every_temporary_table_are_reported_and_never_cleared(business_data):
    package = transfer.export_package("default")
    temporary_data(business_data["owner"])
    with pytest.raises(CommandError, match="empty business AND temporary") as error:
        transfer.import_package(package, "default")
    for label in transfer.TEMPORARY_MODELS:
        assert label in str(error.value)
        assert transfer.classified_models()[label].objects.count() == 1
    assert User.objects.count() == 2
    clear_test_business_and_temporary()
    Session.objects.create(session_key="orphan-session", session_data="private", expire_date=STAMP)
    with pytest.raises(CommandError, match="sessions.session"):
        transfer.import_package(package, "default")
    assert not User.objects.exists()


def test_new_unclassified_model_fails_closed(monkeypatch):
    original = list(transfer.apps.get_models())
    unknown = SimpleNamespace(_meta=SimpleNamespace(label_lower="content.newbusinessmodel"))
    monkeypatch.setattr(transfer.apps, "get_models", lambda: original + [unknown])
    with pytest.raises(CommandError, match="Unclassified models: content.newbusinessmodel"):
        transfer.export_package("default")


def test_source_requires_exact_applied_migration_set():
    MigrationRecorder.Migration.objects.filter(app="forum", name="0001_initial").delete()
    with pytest.raises(CommandError, match="Schema migrations"):
        transfer.export_package("default")


def test_missing_custom_permission_rolls_back_all_previously_loaded_rows(business_data, tmp_path):
    package = transfer.export_package("default")
    clear_test_business_and_temporary()
    Permission.objects.filter(pk=business_data["permission"].pk).delete()
    path = tmp_path / "transfer.json"
    transfer.write_package(path, package)
    with pytest.raises(CommandError, match="natural-key permission") as error:
        invoke("import_database", path, maintenance_window=True)
    assert "private-" not in str(error.value)
    assert all(
        not transfer.classified_models()[label].objects.exists()
        for label in transfer.BUSINESS_MODELS
    )


def test_invalid_foreign_key_fails_constraint_check_and_rolls_back_every_model(
    business_data, tmp_path
):
    package = transfer.export_package("default")
    # A structurally valid fixture can still contain a dangling database FK.
    row = next(row for row in package["fixture"] if row["model"] == "forum.comment")
    row["fields"]["post"] = 999999
    resign(package)
    clear_test_business_and_temporary()
    path = tmp_path / "broken-relation.json"
    transfer.write_package(path, package)
    with pytest.raises(CommandError, match="IntegrityError") as error:
        invoke("import_database", path, maintenance_window=True)
    assert "private-" not in str(error.value)
    assert all(
        not transfer.classified_models()[label].objects.exists()
        for label in transfer.BUSINESS_MODELS
    )


def test_late_import_failure_rolls_back_business_rows_and_m2m(business_data, monkeypatch):
    package = transfer.export_package("default")
    clear_test_business_and_temporary()
    before_sequences = sequence_state()
    original_reset = transfer.reset_sequences

    def fail_after_reset(db, models):
        original_reset(db, models)
        raise RuntimeError("private-simulated-failure")

    monkeypatch.setattr(transfer, "reset_sequences", fail_after_reset)
    with pytest.raises(RuntimeError):
        transfer.import_package(package, "default")
    assert all(
        not transfer.classified_models()[label].objects.exists()
        for label in transfer.BUSINESS_MODELS
    )
    assert not User.groups.through.objects.exists()
    if connection.vendor == "sqlite":
        assert sequence_state() == before_sequences
    else:
        # PostgreSQL M2M inserts call nextval(), whose consumption is not rolled
        # back. Gaps are normal; only rows/relations are promised atomic rollback.
        assert {(row[0], row[1]) for row in sequence_state()} == {
            (row[0], row[1]) for row in before_sequences
        }
    # A retry must still succeed despite PostgreSQL's consumed M2M sequence IDs.
    monkeypatch.setattr(transfer, "reset_sequences", original_reset)
    transfer.import_package(package, "default")
    added = User.objects.create_user(username="after-retried-transfer")
    assert added.pk == 86
    added.groups.add(Group.objects.get(pk=17))
    assert User.groups.through.objects.count() == 2


def test_raw_save_skips_model_overrides_but_post_load_change_is_detected_and_rolled_back(
    business_data, monkeypatch
):
    package = transfer.export_package("default")
    clear_test_business_and_temporary()
    original_compare = transfer.compare_database

    def tamper_then_compare(package, db, models):
        User.objects.filter(pk=41).update(nickname="private-change")
        return original_compare(package, db, models)

    monkeypatch.setattr(transfer, "compare_database", tamper_then_compare)
    with pytest.raises(CommandError, match="content verification failed"):
        transfer.import_package(package, "default")
    assert not User.objects.exists()
    assert not Merchant.objects.exists()


def test_duplicate_json_keys_oversize_and_symlink_inputs_are_rejected(tmp_path, monkeypatch):
    path = tmp_path / "transfer.json"
    path.write_text('{"fixture": [], "fixture": []}')
    with pytest.raises(CommandError, match="duplicate JSON keys"):
        transfer.read_package(path)
    path.write_text("NaN")
    with pytest.raises(CommandError, match="non-finite"):
        transfer.read_package(path)
    monkeypatch.setattr(transfer, "MAX_PACKAGE_BYTES", 2)
    with pytest.raises(CommandError, match="regular JSON file"):
        transfer.read_package(path)
    link = tmp_path / "symlink.json"
    link.symlink_to(path)
    with pytest.raises(CommandError):
        invoke("verify_database", link)


def test_transaction_pooling_rejected_without_opening_connection(monkeypatch, settings):
    fake = SimpleNamespace(
        vendor="postgresql",
        settings_dict={"OPTIONS": {}},
        features=SimpleNamespace(supports_transactions=True),
    )
    monkeypatch.setattr(transfer, "connections", {"migration": fake})
    for mode in ["direct", "session"]:
        settings.DB_POOL_MODE = mode
        assert transfer.transfer_connection("migration") is fake
    settings.DB_POOL_MODE = "transaction"
    with pytest.raises(CommandError, match="refuses transaction pooling"):
        transfer.transfer_connection("migration")
    settings.DB_POOL_MODE = "direct"
    fake.settings_dict = {
        "DISABLE_SERVER_SIDE_CURSORS": True,
        "OPTIONS": {"prepare_threshold": None},
    }
    with pytest.raises(CommandError, match="refuses transaction pooling"):
        transfer.transfer_connection("migration")
