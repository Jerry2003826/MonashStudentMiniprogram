from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.core.models import AuditLog, StaffAccount, User


class Command(BaseCommand):
    help = "Create explicit local demonstration identities; never valid in production."

    @transaction.atomic
    def handle(self, *args, **options):
        if not (settings.DEBUG and settings.ENABLE_DEV_LOGIN):
            raise CommandError("seed_demo requires DJANGO_DEBUG=true and ENABLE_DEV_LOGIN=true.")
        for role in ["owner", "reviewer", "editor", "student"]:
            username = f"demo-{role}"
            user, created = User.objects.get_or_create(
                username=username,
                defaults={
                    "openid": f"dev:{username}",
                    "nickname": f"演示{role}",
                },
            )
            if user.openid != f"dev:{username}":
                raise CommandError(f"Username {username} belongs to a non-demo user; refusing.")
            if created:
                user.set_unusable_password()
                user.save(update_fields=["password"])
            if role != "student":
                account, staff_created = StaffAccount.objects.get_or_create(
                    user=user, defaults={"role": role}
                )
                if staff_created:
                    AuditLog.objects.create(
                        actor=user,
                        action="demo.seed",
                        target_type="staff_account",
                        target_id=account.pk,
                        details={"role": role},
                    )
            self.stdout.write(f"{username}: user_id={user.pk} (local demonstration only)")
