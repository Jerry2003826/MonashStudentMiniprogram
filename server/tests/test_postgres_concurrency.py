"""Real independent-connection concurrency coverage, skipped on SQLite."""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier

import pytest
from django.db import close_old_connections, connection, connections
from django.utils import timezone

from apps.core.errors import ServiceError
from apps.core.models import Application, AuditLog, Membership, StaffAccount, User
from apps.core.services import add_calendar_year, review_application


@pytest.mark.django_db(transaction=True)
@pytest.mark.skipif(connection.vendor != "postgresql", reason="Requires PostgreSQL row locking")
def test_concurrent_approval_renews_membership_only_once():
    actor = User.objects.create_user(username="parallel-reviewer", openid="parallel-reviewer")
    StaffAccount.objects.create(user=actor, role="reviewer")
    student = User.objects.create_user(username="parallel-student", openid="parallel-student")
    now = timezone.now()
    old_expiry = now + timedelta(days=7)
    membership = Membership.objects.create(
        user=student,
        email="parallel@student.monash.edu",
        approved_at=now - timedelta(days=358),
        expires_at=old_expiry,
    )
    application = Application.objects.create(user=student, email=membership.email)
    starting_line = Barrier(2, timeout=10)

    def approve():
        close_old_connections()
        worker_connection = connections["default"]
        try:
            with worker_connection.cursor() as cursor:
                # Bound both SQL waiting and the rendezvous so a locking regression
                # fails the test instead of hanging a local run or CI worker.
                cursor.execute("SET lock_timeout = '5s'")
                cursor.execute("SET statement_timeout = '10s'")
                cursor.execute("SELECT pg_backend_pid()")
                backend_pid = cursor.fetchone()[0]
            reviewer = User.objects.get(pk=actor.pk)
            starting_line.wait()
            try:
                reviewed = review_application(reviewer, application.pk, "approved", "并发审核测试")
                return backend_pid, "approved", reviewed.pk
            except ServiceError as error:
                return backend_pid, error.code, error.message
        finally:
            worker_connection.close()
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(approve), executor.submit(approve)]
        results = [future.result(timeout=20) for future in futures]

    assert len({result[0] for result in results}) == 2
    assert sorted(result[1] for result in results) == ["VALIDATION_ERROR", "approved"]
    rejected = next(result for result in results if result[1] == "VALIDATION_ERROR")
    assert "已经处理" in rejected[2]
    assert Membership.objects.filter(user=student).count() == 1
    membership.refresh_from_db()
    assert membership.expires_at == add_calendar_year(old_expiry)
    application.refresh_from_db()
    assert application.status == "approved"
    assert (
        AuditLog.objects.filter(
            action="membership.review", target_type="application", target_id=application.pk
        ).count()
        == 1
    )
