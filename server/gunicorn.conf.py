"""WSGI process settings; Django alone interprets explicitly trusted proxy headers."""

import os


def positive_env(name, default, maximum):
    value = os.environ.get(name, str(default)).strip()
    if not value.isascii() or not value.isdecimal() or len(value) > 10:
        raise ValueError(f"{name} must be a positive integer.")
    result = int(value)
    if not 1 <= result <= maximum:
        raise ValueError(f"{name} is outside its supported range.")
    return result


bind = f"0.0.0.0:{positive_env('PORT', 8000, 65535)}"
workers = positive_env("WEB_CONCURRENCY", 2, 64)
threads = positive_env("GUNICORN_THREADS", 2, 64)
worker_class = "gthread"
timeout = positive_env("GUNICORN_TIMEOUT", 30, 300)
graceful_timeout = 30
keepalive = 5
max_requests = 1000
max_requests_jitter = 100
accesslog = "-"
errorlog = "-"
# Never put query strings, Authorization, Referer or request bodies into logs.
access_log_format = '%(h)s %(t)s "%(m)s %(U)s %(H)s" %(s)s %(b)s %(L)s'
forwarded_allow_ips = ""
secure_scheme_headers = {}
