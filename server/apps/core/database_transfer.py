"""Small, offline database transfers. Packages contain confidential business data.

This is deliberately not online replication: stop every source and target writer
before export/import and keep them stopped until verification and cutover finish.
The checksum detects corruption, not a malicious package author. Only import a
trusted package: it includes password hashes, administrator roles and permissions.
"""

import hashlib
import hmac
import json
import os
import stat
from contextlib import contextmanager
from datetime import UTC, datetime, time
from pathlib import Path

from django.apps import apps
from django.conf import settings
from django.contrib.contenttypes.models import ContentType
from django.core import serializers
from django.core.management.base import CommandError
from django.core.serializers.json import DjangoJSONEncoder
from django.db import connections, transaction
from django.db.migrations.loader import MigrationLoader
from django.db.models import Max
from django.utils import timezone

FORMAT_VERSION = 1
MAX_PACKAGE_BYTES = 64 * 1024 * 1024

# Explicitly classify every installed concrete model. Do not expand these lists
# automatically: a new model must be reviewed before a transfer can proceed.
# This order also satisfies natural-key dependencies during deserialization.
BUSINESS_MODELS = (
    "auth.group",
    "core.user",
    "core.staffaccount",
    "core.membership",
    "core.application",
    "core.auditlog",
    "content.activity",
    "content.category",
    "content.area",
    "content.merchant",
    "content.banner",
    "content.handbooksection",
    "content.supportsettings",
    "content.feedback",
    "forum.board",
    "forum.post",
    "forum.comment",
    "forum.like",
    "forum.report",
)
TEMPORARY_MODELS = (
    "core.authtoken",
    "core.emailcode",
    "core.emailthrottle",
    "portal.loginchallenge",
    "portal.loginratelimit",
    "sessions.session",
)
INFRASTRUCTURE_MODELS = ("auth.permission", "contenttypes.contenttype")
MAINTENANCE_NOTICE = (
    "Maintenance-window transfer only: stop ALL source and target writers. "
    "Keep writes stopped through verification and cutover; no online sync is provided. "
    "Temporary login data is excluded; users must log in again."
)


class PreciseJSONEncoder(DjangoJSONEncoder):
    """Django's default JSON encoder truncates datetimes to milliseconds."""

    def default(self, value):
        if isinstance(value, datetime):
            if timezone.is_naive(value):
                raise ValueError("Naive datetimes cannot be transferred safely.")
            return value.astimezone(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")
        if isinstance(value, time):
            return value.isoformat(timespec="microseconds")
        return super().default(value)


def canonical_json(value):
    return json.dumps(
        value,
        cls=PreciseJSONEncoder,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def digest(value):
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def classified_models():
    registered = {model._meta.label_lower: model for model in apps.get_models()}
    classified = set(BUSINESS_MODELS + TEMPORARY_MODELS + INFRASTRUCTURE_MODELS)
    if set(registered) != classified:
        missing = sorted(classified - set(registered))
        unknown = sorted(set(registered) - classified)
        raise CommandError(
            "Model classification is incomplete; review the transfer policy. "
            f"Unclassified models: {', '.join(unknown) or 'none'}; "
            f"missing models: {', '.join(missing) or 'none'}."
        )
    for model in registered.values():
        if not model._meta.managed or model._meta.proxy or model._meta.parents:
            raise CommandError(
                "Unsupported model inheritance or table management in transfer policy."
            )
    return registered


def serialized_fields(model):
    return {
        field.name: field
        for field in (*model._meta.local_fields, *model._meta.local_many_to_many)
        if field.serialize
    }


def table_models(models, labels):
    """Include automatic M2M tables in emptiness checks, locks and sequences."""
    result = []
    seen = set()
    for label in labels:
        model = models[label]
        candidates = [model] + [
            field.remote_field.through
            for field in model._meta.local_many_to_many
            if field.remote_field.through._meta.auto_created
        ]
        for candidate in candidates:
            if candidate._meta.db_table not in seen:
                result.append(candidate)
                seen.add(candidate._meta.db_table)
    return result


def transfer_connection(alias, *, writing=False):
    try:
        connection = connections[alias]
    except Exception:
        raise CommandError("Unknown database alias.") from None
    if connection.vendor not in {"sqlite", "postgresql"}:
        raise CommandError("Only SQLite and PostgreSQL are supported.")
    if connection.vendor == "postgresql":
        mode = getattr(settings, "DB_POOL_MODE", "direct")
        options = connection.settings_dict.get("OPTIONS", {})
        transaction_flags = connection.settings_dict.get("DISABLE_SERVER_SIDE_CURSORS") and (
            "prepare_threshold" in options and options["prepare_threshold"] is None
        )
        if mode == "transaction" or transaction_flags:
            raise CommandError(
                "Database transfer refuses transaction pooling. Configure a direct or session "
                "connection and DB_POOL_MODE=direct or session."
            )
        if mode not in {"direct", "session"}:
            raise CommandError("Unknown DB_POOL_MODE; use a direct or session connection.")
    if not connection.features.supports_transactions:
        raise CommandError("A transactional database is required.")
    if writing and getattr(settings, "DATABASE_ROUTERS", []):
        raise CommandError("Database routers need an explicit transfer policy before importing.")
    return connection


def schema_manifest(connection, models):
    loader = MigrationLoader(connection)
    loader.check_consistent_history(connection)
    expected = set(loader.disk_migrations)
    applied = set(loader.applied_migrations)
    if applied != expected:
        raise CommandError(
            "Schema migrations are not an exact match for this code. "
            "Apply all migrations with the same release before transferring."
        )
    return {
        "migrations": [list(key) for key in sorted(applied)],
        "models": {label: sorted(serialized_fields(models[label])) for label in BUSINESS_MODELS},
    }


def normalize_fixture(fixture, models):
    normalized = []
    for row in fixture:
        fields = dict(row["fields"])
        for field in models[row["model"]]._meta.local_many_to_many:
            if field.name in fields:
                fields[field.name] = sorted(fields[field.name], key=canonical_json)
        normalized.append({"model": row["model"], "pk": row["pk"], "fields": fields})
    return sorted(normalized, key=lambda row: (row["model"], row["pk"]))


def fixture_summary(fixture, models):
    rows = normalize_fixture(fixture, models)
    per_model = {label: [] for label in BUSINESS_MODELS}
    for row in rows:
        per_model[row["model"]].append(row)
    return {
        "counts": {label: len(items) for label, items in per_model.items()},
        "model_sha256": {label: digest(items) for label, items in per_model.items()},
        "fixture_sha256": digest(rows),
    }


def database_fixture(alias, models):
    fixture = []
    for label in BUSINESS_MODELS:
        queryset = models[label]._base_manager.using(alias).order_by("pk")
        encoded = serializers.serialize(
            "json",
            queryset,
            use_natural_foreign_keys=True,
            use_natural_primary_keys=False,
            cls=PreciseJSONEncoder,
            ensure_ascii=False,
            allow_nan=False,
        )
        fixture.extend(json.loads(encoded))
    return fixture


@contextmanager
def snapshot_transaction(connection):
    # A caller-supplied transaction controls its own isolation (e.g. a Django
    # TestCase). CLI commands open a fresh repeatable-read, read-only snapshot.
    outer_transaction = connection.in_atomic_block
    with transaction.atomic(using=connection.alias):
        if connection.vendor == "postgresql" and not outer_transaction:
            with connection.cursor() as cursor:
                cursor.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        yield


def export_package(alias):
    models = classified_models()
    connection = transfer_connection(alias)
    with snapshot_transaction(connection):
        schema = schema_manifest(connection, models)
        fixture = database_fixture(alias, models)
        package = {
            "format_version": FORMAT_VERSION,
            "created_at": PreciseJSONEncoder().default(timezone.now()),
            "source_vendor": connection.vendor,
            "schema": schema,
            **fixture_summary(fixture, models),
            "fixture": fixture,
        }
        package["sha256"] = digest(package)
    if len(canonical_json(package).encode("utf-8")) + 1 > MAX_PACKAGE_BYTES:
        raise CommandError("Package exceeds the 64 MiB limit for this small-database tool.")
    return package


def write_package(path, package):
    # O_EXCL also refuses existing symlinks. Restrict mode even under an unusual umask.
    path = Path(path)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            descriptor = None
            stream.write(canonical_json(package))
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
    finally:
        if descriptor is not None:
            os.close(descriptor)


def unique_json_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise CommandError("Package contains duplicate JSON keys.")
        result[key] = value
    return result


def reject_json_constant(value):
    raise CommandError("Package contains non-finite JSON numbers.")


def read_package(path):
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(descriptor, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_PACKAGE_BYTES:
            raise CommandError("Package must be a regular JSON file no larger than 64 MiB.")
        data = stream.read(MAX_PACKAGE_BYTES + 1)
    if len(data) > MAX_PACKAGE_BYTES:
        raise CommandError("Package exceeds the 64 MiB limit.")
    return json.loads(
        data, object_pairs_hook=unique_json_object, parse_constant=reject_json_constant
    )


def validate_fixture(fixture, models):
    if not isinstance(fixture, list):
        raise CommandError("Invalid fixture structure.")
    seen = set()
    for row in fixture:
        if not isinstance(row, dict) or set(row) != {"model", "pk", "fields"}:
            raise CommandError("Fixture rows must explicitly contain model, pk and fields.")
        label = row["model"]
        if not isinstance(label, str) or label not in BUSINESS_MODELS:
            raise CommandError("Fixture includes an unapproved model.")
        if type(row["pk"]) is not int or not 0 < row["pk"] < 2**63:
            raise CommandError("Every fixture row must retain a positive integer primary key.")
        identity = (label, row["pk"])
        if identity in seen:
            raise CommandError("Fixture contains a duplicate model primary key.")
        seen.add(identity)
        expected = serialized_fields(models[label])
        if not isinstance(row["fields"], dict) or set(row["fields"]) != set(expected):
            raise CommandError("Fixture fields do not exactly match the approved model schema.")
        for name, field in expected.items():
            value = row["fields"][name]
            if field.many_to_many:
                if not isinstance(value, list):
                    raise CommandError("Invalid many-to-many fixture value.")
                keys = [canonical_json(item) for item in value]
                if len(keys) != len(set(keys)):
                    raise CommandError("Duplicate many-to-many fixture relation.")
                values = value
            elif field.is_relation:
                values = [] if value is None else [value]
            else:
                continue
            related = field.remote_field.model
            for item in values:
                if hasattr(related, "natural_key"):
                    length = 3 if related._meta.label_lower == "auth.permission" else 1
                    if (
                        not isinstance(item, list)
                        or len(item) != length
                        or not all(isinstance(part, str) for part in item)
                    ):
                        raise CommandError("Natural-key relations must not contain database IDs.")
                elif type(item) is not int or item <= 0:
                    raise CommandError("Invalid fixture foreign key.")


def validate_package(package, models):
    keys = {
        "format_version",
        "created_at",
        "source_vendor",
        "schema",
        "counts",
        "model_sha256",
        "fixture_sha256",
        "fixture",
        "sha256",
    }
    if not isinstance(package, dict) or set(package) != keys:
        raise CommandError("Unrecognized package structure.")
    if type(package["format_version"]) is not int or package["format_version"] != FORMAT_VERSION:
        raise CommandError("Unsupported database-transfer format version.")
    if package["source_vendor"] not in {"sqlite", "postgresql"}:
        raise CommandError("Unsupported package source database.")
    checksum = package["sha256"]
    if not isinstance(checksum, str) or not hmac.compare_digest(
        checksum, digest({key: value for key, value in package.items() if key != "sha256"})
    ):
        raise CommandError("Package SHA-256 mismatch; no import was attempted.")
    validate_fixture(package["fixture"], models)
    summary = fixture_summary(package["fixture"], models)
    if any(package[key] != value for key, value in summary.items()):
        raise CommandError("Fixture counts or content SHA-256 do not match the package manifest.")


def assert_matching_schema(package, connection, models):
    if package["schema"] != schema_manifest(connection, models):
        raise CommandError("Source and target schema migrations or model fields do not match.")


def validate_infrastructure_relations(package, alias, models):
    # Migrate creates ContentTypes and Permissions with target-local IDs. A
    # hand-created source permission is not silently dropped or transplanted.
    # Clear Django's natural-key cache in case a caller has rebuilt its schema.
    ContentType.objects.clear_cache()
    permission_model = models["auth.permission"]
    for row in package["fixture"]:
        for name, field in serialized_fields(models[row["model"]]).items():
            if not field.is_relation or field.remote_field.model is not permission_model:
                continue
            keys = row["fields"][name] if field.many_to_many else [row["fields"][name]]
            for key in keys:
                if (
                    key is not None
                    and not permission_model._base_manager.using(alias)
                    .filter(
                        codename=key[0], content_type__app_label=key[1], content_type__model=key[2]
                    )
                    .exists()
                ):
                    raise CommandError(
                        "Target lacks a referenced natural-key permission. Define custom "
                        "permissions in code/migrations on both sides before transferring; "
                        "permission IDs will not be copied."
                    )


def empty_target_tables(connection, models):
    tables = table_models(models, BUSINESS_MODELS + TEMPORARY_MODELS)
    expected_tables = {
        model._meta.db_table
        for model in table_models(
            models, BUSINESS_MODELS + TEMPORARY_MODELS + INFRASTRUCTURE_MODELS
        )
    } | {"django_migrations"}
    actual_tables = set(connection.introspection.table_names())
    if actual_tables != expected_tables:
        raise CommandError("Target contains unexpected tables or is missing required tables.")
    if connection.vendor == "postgresql":
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL lock_timeout = '5s'")
            names = ", ".join(connection.ops.quote_name(model._meta.db_table) for model in tables)
            cursor.execute(f"LOCK TABLE {names} IN EXCLUSIVE MODE")
    occupied = [
        model._meta.label_lower
        for model in tables
        if model._base_manager.using(connection.alias).exists()
    ]
    if occupied:
        raise CommandError(
            "Target must have empty business AND temporary tables. Occupied: "
            + ", ".join(sorted(occupied))
            + ". No --force or clearing operation is provided."
        )
    return tables


def compare_database(package, connection, models):
    actual = fixture_summary(database_fixture(connection.alias, models), models)
    mismatched = [
        label
        for label in BUSINESS_MODELS
        if actual["counts"][label] != package["counts"][label]
        or actual["model_sha256"][label] != package["model_sha256"][label]
    ]
    if mismatched or actual["fixture_sha256"] != package["fixture_sha256"]:
        raise CommandError(
            "Database content verification failed for: "
            + ", ".join(mismatched)
            + ". No row contents are shown."
        )
    return actual


def reset_sequences(connection, models):
    # PostgreSQL setval(), used by loaddata, is NOT rolled back on failure. ALTER
    # SEQUENCE RESTART is transactional, so use it for this all-or-nothing import.
    for model in models:
        if model._meta.auto_field is None:
            continue
        maximum = model._base_manager.using(connection.alias).aggregate(value=Max("pk"))["value"]
        maximum = maximum or 0
        table = model._meta.db_table
        with connection.cursor() as cursor:
            if connection.vendor == "postgresql":
                cursor.execute(
                    "SELECT n.nspname, c.relname FROM pg_class c "
                    "JOIN pg_namespace n ON n.oid = c.relnamespace "
                    "WHERE c.oid = pg_get_serial_sequence(%s, %s)::regclass",
                    [table, model._meta.pk.column],
                )
                sequence = cursor.fetchone()
                if not sequence:
                    raise CommandError("A primary-key sequence is missing in the target schema.")
                identifier = ".".join(connection.ops.quote_name(part) for part in sequence)
                cursor.execute(f"ALTER SEQUENCE {identifier} RESTART WITH {maximum + 1:d}")
            else:
                cursor.execute("DELETE FROM sqlite_sequence WHERE name = %s", [table])
                cursor.execute(
                    "INSERT INTO sqlite_sequence (name, seq) VALUES (%s, %s)", [table, maximum]
                )


def import_package(package, alias):
    models = classified_models()
    validate_package(package, models)
    connection = transfer_connection(alias, writing=True)
    with transaction.atomic(using=alias):
        assert_matching_schema(package, connection, models)
        tables = empty_target_tables(connection, models)
        validate_infrastructure_relations(package, alias, models)
        order = {label: index for index, label in enumerate(BUSINESS_MODELS)}
        fixture = sorted(package["fixture"], key=lambda row: (order[row["model"]], row["pk"]))
        deferred = []
        with connection.constraint_checks_disabled():
            for obj in serializers.deserialize(
                "json",
                canonical_json(fixture),
                using=alias,
                ignorenonexistent=False,
                handle_forward_references=True,
            ):
                obj.save(using=alias)
                if obj.deferred_fields:
                    deferred.append(obj)
            for obj in deferred:
                obj.save_deferred_fields(using=alias)
        connection.check_constraints(table_names=[model._meta.db_table for model in tables])
        summary = compare_database(package, connection, models)
        reset_sequences(connection, table_models(models, BUSINESS_MODELS))
        return summary


def verify_package(package, alias):
    models = classified_models()
    validate_package(package, models)
    connection = transfer_connection(alias)
    with snapshot_transaction(connection):
        assert_matching_schema(package, connection, models)
        return compare_database(package, connection, models)


def command_arguments(parser, *, maintenance=False):
    parser.add_argument("path", help="Private JSON package path; import only a trusted package.")
    parser.add_argument("--database", default="default", help="Configured Django database alias.")
    if maintenance:
        parser.add_argument(
            "--maintenance-window",
            action="store_true",
            help="Confirm all source and target writers are stopped until verification/cutover.",
        )


@contextmanager
def safe_command_errors():
    try:
        yield
    except CommandError:
        raise
    except FileExistsError:
        raise CommandError("Package path already exists; it will never be overwritten.") from None
    except Exception as error:
        # Django deserializer/DB exception strings can contain passwords, emails,
        # tokens and full row contents. Never echo those values or chain the error.
        raise CommandError(
            f"Database transfer failed ({type(error).__name__}); no row contents are shown. "
            "Imports are atomic and business-data writes are rolled back on failure."
        ) from None


def write_summary(command, summary):
    for label in BUSINESS_MODELS:
        command.stdout.write(
            f"{label}: count={summary['counts'][label]} sha256={summary['model_sha256'][label]}"
        )
    command.stdout.write(f"fixture_sha256={summary['fixture_sha256']}")
