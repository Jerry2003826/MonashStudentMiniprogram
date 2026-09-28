"""Only for collectstatic in the image build; never an application runtime setting.

No application models, database, WeChat or SMTP configuration is loaded here.
"""

from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
SECRET_KEY = "collectstatic-build-only-no-runtime-credentials"
INSTALLED_APPS = ["django.contrib.staticfiles"]
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "var" / "static"
STATICFILES_DIRS = sorted(path for path in (BASE_DIR / "apps").glob("*/static") if path.is_dir())
STORAGES = {
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}
