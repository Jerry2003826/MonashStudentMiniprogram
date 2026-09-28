from django.core.management.base import BaseCommand, CommandError

from apps.core.database_transfer import (
    MAINTENANCE_NOTICE,
    command_arguments,
    import_package,
    read_package,
    safe_command_errors,
    write_summary,
)


class Command(BaseCommand):
    help = "Atomically import a trusted package into an empty, already-migrated database."

    def add_arguments(self, parser):
        command_arguments(parser, maintenance=True)

    def handle(self, *args, **options):
        self.stdout.write(MAINTENANCE_NOTICE)
        if not options["maintenance_window"]:
            raise CommandError("Stop all writers, then confirm with --maintenance-window.")
        with safe_command_errors():
            summary = import_package(read_package(options["path"]), options["database"])
        write_summary(self, summary)
        self.stdout.write(
            self.style.SUCCESS("Import verified and committed; primary-key sequences reset.")
        )
