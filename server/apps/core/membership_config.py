from django.conf import settings
from django.core.validators import EmailValidator

from .errors import ServiceError


def allowed_email_domains() -> list[str]:
    """The public allowlist and email validation must use the same configuration."""
    configured = settings.MEMBERSHIP_ALLOWED_EMAIL_DOMAINS
    if not isinstance(configured, (list, tuple)) or not configured:
        raise ServiceError(503, "INTERNAL_ERROR", "学生邮箱配置暂不可用，请稍后重试")
    domains = []
    for value in configured:
        domain = value.strip().lower() if isinstance(value, str) else ""
        if len(domain) > 253 or not EmailValidator.domain_regex.fullmatch(domain):
            raise ServiceError(503, "INTERNAL_ERROR", "学生邮箱配置暂不可用，请稍后重试")
        if domain not in domains:
            domains.append(domain)
    return domains
