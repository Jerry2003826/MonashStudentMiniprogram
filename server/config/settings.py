import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

from .database import build_databases, validate_pool_mode

BASE_DIR = Path(__file__).resolve().parent.parent


def env_bool(name, default=False):
    value = os.environ.get(name, str(default)).strip().lower()
    if value not in {"true", "1", "yes", "false", "0", "no"}:
        raise ImproperlyConfigured(f"{name} must be a boolean.")
    return value in {"true", "1", "yes"}


def env_nonnegative_int(name, default, maximum):
    value = os.environ.get(name, str(default)).strip()
    if not value.isascii() or not value.isdecimal() or len(value) > 10:
        raise ImproperlyConfigured(f"{name} must be a nonnegative integer.")
    result = int(value)
    if result > maximum:
        raise ImproperlyConfigured(f"{name} exceeds its allowed maximum.")
    return result


DEBUG = env_bool("DJANGO_DEBUG")
ENABLE_DEV_LOGIN = env_bool("ENABLE_DEV_LOGIN")
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
WECHAT_APPID = os.environ.get("WECHAT_APPID", "")
WECHAT_APPSECRET = os.environ.get("WECHAT_APPSECRET", "")
WECHAT_CONTENT_SAFETY_MODE = os.environ.get("WECHAT_CONTENT_SAFETY_MODE", "wechat")
if WECHAT_CONTENT_SAFETY_MODE not in {"wechat", "fake"}:
    raise ImproperlyConfigured("WECHAT_CONTENT_SAFETY_MODE must be wechat or fake.")
if WECHAT_CONTENT_SAFETY_MODE == "fake" and not (DEBUG and ENABLE_DEV_LOGIN):
    raise ImproperlyConfigured("Fake content safety requires DEBUG and ENABLE_DEV_LOGIN.")
if DEBUG and not SECRET_KEY:
    SECRET_KEY = "django-insecure-explicit-local-development-only"
if not DEBUG:
    if len(SECRET_KEY) < 32 or SECRET_KEY.startswith("django-insecure-"):
        raise ImproperlyConfigured("Production requires a strong DJANGO_SECRET_KEY.")
    if not WECHAT_APPID or not WECHAT_APPSECRET:
        raise ImproperlyConfigured("Production requires WECHAT_APPID and WECHAT_APPSECRET.")
    if ENABLE_DEV_LOGIN:
        raise ImproperlyConfigured("ENABLE_DEV_LOGIN must be disabled in production.")

ALLOWED_HOSTS = [
    value.strip()
    for value in os.environ.get(
        "DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,[::1]" if DEBUG else ""
    ).split(",")
    if value.strip()
]
if not DEBUG and (not ALLOWED_HOSTS or "*" in ALLOWED_HOSTS):
    raise ImproperlyConfigured("Production requires explicit DJANGO_ALLOWED_HOSTS.")

INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "apps.core",
    "apps.portal",
    "apps.content",
    "apps.forum",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
ROOT_URLCONF = "config.urls"
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ]
        },
    }
]
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

DB_POOL_MODE = validate_pool_mode(os.environ.get("DB_POOL_MODE", "direct"))
DATABASES = build_databases(os.environ, debug=DEBUG, base_dir=BASE_DIR)

AUTH_USER_MODEL = "core.User"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
LANGUAGE_CODE = "zh-hans"
TIME_ZONE = "Australia/Melbourne"
USE_I18N = True
USE_TZ = True
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "var" / "static"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

EMAIL_BACKEND = os.environ.get(
    "EMAIL_BACKEND",
    "django.core.mail.backends.filebased.EmailBackend"
    if DEBUG
    else "django.core.mail.backends.smtp.EmailBackend",
)
if not DEBUG and EMAIL_BACKEND != "django.core.mail.backends.smtp.EmailBackend":
    raise ImproperlyConfigured("Production email must use the SMTP backend.")
EMAIL_FILE_PATH = BASE_DIR / "var" / "emails"
EMAIL_HOST = os.environ.get("EMAIL_HOST", "")
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "587"))
EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", True)
EMAIL_USE_SSL = env_bool("EMAIL_USE_SSL")
EMAIL_TIMEOUT = 10
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", "noreply@localhost" if DEBUG else "")
MEMBERSHIP_ALLOWED_EMAIL_DOMAINS = [
    value.strip().lower()
    for value in os.environ.get("MEMBERSHIP_ALLOWED_EMAIL_DOMAINS", "student.monash.edu").split(",")
    if value.strip()
]
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
SESSION_COOKIE_SAMESITE = "Lax"
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_SSL_REDIRECT = env_bool("DJANGO_SECURE_SSL_REDIRECT", not DEBUG)
# Enable this only when all application traffic comes through a proxy which
# removes any client-supplied X-Forwarded-Proto and sets its own trusted value.
SECURE_PROXY_SSL_HEADER = (
    ("HTTP_X_FORWARDED_PROTO", "https") if env_bool("DJANGO_TRUST_PROXY_SSL_HEADER") else None
)
SECURE_REDIRECT_EXEMPT = [r"^healthz$", r"^readyz$"]
SECURE_HSTS_SECONDS = env_nonnegative_int(
    "DJANGO_SECURE_HSTS_SECONDS", 0 if DEBUG else 3600, 63_072_000
)
SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool("DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS")
SECURE_HSTS_PRELOAD = env_bool("DJANGO_SECURE_HSTS_PRELOAD")
if SECURE_HSTS_PRELOAD and (SECURE_HSTS_SECONDS < 31_536_000 or not SECURE_HSTS_INCLUDE_SUBDOMAINS):
    raise ImproperlyConfigured("HSTS preload requires a year and all subdomains to support HTTPS.")
SECURE_REFERRER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"
CSRF_TRUSTED_ORIGINS = [
    value.strip()
    for value in os.environ.get("CSRF_TRUSTED_ORIGINS", "").split(",")
    if value.strip()
]
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "loggers": {"httpx": {"level": "WARNING"}, "httpcore": {"level": "WARNING"}},
}
