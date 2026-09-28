# Build context: server/ (docker build -t student-union-api ./server).
FROM ghcr.io/astral-sh/uv:0.9.27 AS uv

FROM python:3.12-slim AS builder
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY . ./
RUN .venv/bin/python manage.py collectstatic --noinput --settings=config.settings_build

FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH" DJANGO_SETTINGS_MODULE=config.settings PORT=8000
WORKDIR /app
RUN groupadd --gid 10001 app && useradd --uid 10001 --gid app --no-create-home app
COPY --from=builder /app /app
RUN chmod 755 /app/docker-entrypoint.sh && chown -R app:app /app/var
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD python -c 'import os,urllib.request; urllib.request.urlopen("http://127.0.0.1:"+os.environ.get("PORT","8000")+"/readyz",timeout=8).read()'
ENTRYPOINT ["/app/docker-entrypoint.sh"]
