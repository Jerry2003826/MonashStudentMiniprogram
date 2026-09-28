from django.core.management.base import BaseCommand

from apps.core.database_transfer import (
    command_arguments,
    read_package,
    safe_command_errors,
    verify_package,
    write_summary,
)


class Command(BaseCommand):
    help = "Read-only comparison of every business model's count and canonical content SHA-256."

    def add_arguments(self, parser):
        command_arguments(parser)

    def handle(self, *args, **options):
        self.stdout.write(
            "Read-only verification. Keep writers stopped for a cutover comparison; "
            "ordinary changes after export will cause a mismatch."
        )
        with safe_command_errors():
            summary = verify_package(read_package(options["path"]), options["database"])
        write_summary(self, summary)
        self.stdout.write(self.style.SUCCESS("All business counts and content hashes match."))
