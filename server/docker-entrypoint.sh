#!/bin/sh
set -eu

if [ "${DJANGO_SETTINGS_MODULE:-config.settings}" != "config.settings" ]; then
    printf '%s\n' 'The application image requires config.settings at runtime.' >&2
    exit 1
fi
export DJANGO_SETTINGS_MODULE=config.settings

# This image is the deployment runtime. Local demo accounts and public debug
# documentation belong to the local development server, never this entrypoint.
python - <<'PY'
import os
import sys

for name in ("DJANGO_DEBUG", "ENABLE_DEV_LOGIN"):
    if os.environ.get(name, "false").strip().lower() not in {"false", "0", "no"}:
        sys.exit("Deployment runtime requires DJANGO_DEBUG=false and ENABLE_DEV_LOGIN=false.")
PY

# Run migrate as an explicit release job. Workers never migrate or seed data.
exec gunicorn --config gunicorn.conf.py config.wsgi:application "$@"
