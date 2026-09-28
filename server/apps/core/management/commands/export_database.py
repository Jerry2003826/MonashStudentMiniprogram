from django.core.management.base import BaseCommand, CommandError

from apps.core.database_transfer import (
    MAINTENANCE_NOTICE,
    command_arguments,
    export_package,
    safe_command_errors,
    write_package,
    write_summary,
)


class Command(BaseCommand):
    help = "Export an offline business-data package (private 0600 JSON; never overwrites)."

    def add_arguments(self, parser):
        command_arguments(parser, maintenance=True)

    def handle(self, *args, **options):
        self.stdout.write(MAINTENANCE_NOTICE)
        if not options["maintenance_window"]:
            raise CommandError("Stop all writers, then confirm with --maintenance-window.")
        with safe_command_errors():
            package = export_package(options["database"])
            write_package(options["path"], package)
        write_summary(self, package)
        self.stdout.write(
            self.style.SUCCESS("Private package exported. Protect it as a database backup.")
        )
