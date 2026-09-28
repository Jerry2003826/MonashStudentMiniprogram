"""Unauthenticated, non-diagnostic readiness probe for the application database."""

import logging

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_safe

logger = logging.getLogger(__name__)


@never_cache
@require_safe
def readyz(request):
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            if cursor.fetchone() != (1,):
                return JsonResponse({"status": "unavailable"}, status=503)
        executor = MigrationExecutor(connection)
        executor.loader.check_consistent_history(connection)
        if executor.migration_plan(executor.loader.graph.leaf_nodes()):
            return JsonResponse({"status": "unavailable"}, status=503)
    except Exception as exc:
        # Do not log SQL, DSNs, credentials or exception text on a public probe.
        logger.warning("Readiness check unavailable (%s)", type(exc).__name__)
        return JsonResponse({"status": "unavailable"}, status=503)
    return JsonResponse({"status": "ok"})
