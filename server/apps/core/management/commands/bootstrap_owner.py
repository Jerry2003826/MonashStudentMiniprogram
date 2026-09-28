from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.core.models import AuditLog, StaffAccount, User


class Command(BaseCommand):
    help = "Grant the first owner role to an existing, real WeChat identity."

    def add_arguments(self, parser):
        parser.add_argument("--user-id", type=int, required=True)

    @transaction.atomic
    def handle(self, *args, **options):
        # Lock all active users in a stable order, including the chosen identity, so two bootstrap
        # commands on PostgreSQL cannot both observe an empty owner set and grant different owners.
        list(User.objects.select_for_update().filter(is_active=True).order_by("pk"))
        if StaffAccount.objects.filter(role="owner", is_active=True, user__is_active=True).exists():
            raise CommandError("An active owner already exists; use the management portal.")
        user = User.objects.filter(pk=options["user_id"], is_active=True).first()
        if not user or not user.openid or user.openid.startswith("dev:"):
            raise CommandError("Choose an active, real WeChat user; demo identities are forbidden.")
        account, _ = StaffAccount.objects.update_or_create(
            user=user, defaults={"role": "owner", "is_active": True}
        )
        AuditLog.objects.create(
            actor=user,
            action="staff.bootstrap_owner",
            target_type="staff_account",
            target_id=account.pk,
            details={"source": "management_command"},
        )
        self.stdout.write(self.style.SUCCESS(f"First owner initialized for user_id={user.pk}."))
