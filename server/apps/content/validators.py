import math
from urllib.parse import urlsplit

from django.core.exceptions import ValidationError
from django.core.validators import URLValidator


def validate_https_url(value):
    if not value:
        return
    URLValidator(schemes=["https"])(value)
    try:
        parsed = urlsplit(value)
        if parsed.username or parsed.password:
            raise ValidationError("网址不能包含用户名或密码。")
    except ValueError as exc:
        raise ValidationError("请填写有效的 HTTPS 网址。") from exc


def validate_article_url(value):
    if not value:
        return
    validate_https_url(value)
    parsed = urlsplit(value)
    if (
        parsed.hostname != "mp.weixin.qq.com"
        or parsed.port not in {None, 443}
        or not (parsed.path == "/s" or parsed.path.startswith("/s/"))
    ):
        raise ValidationError("文章链接仅支持 https://mp.weixin.qq.com 公众号原文。")


def validate_image_urls(value):
    if not isinstance(value, list) or len(value) > 9:
        raise ValidationError("图片必须是最多 9 个 HTTPS 网址组成的列表。")
    for url in value:
        if not isinstance(url, str) or not url or len(url) > 1000:
            raise ValidationError("每张图片需要一个不超过 1000 字的 HTTPS 网址。")
        validate_https_url(url)


def validate_latitude(value):
    if not math.isfinite(value) or not -90 <= value <= 90:
        raise ValidationError("纬度必须是 -90 到 90 之间的有限数值。")


def validate_longitude(value):
    if not math.isfinite(value) or not -180 <= value <= 180:
        raise ValidationError("经度必须是 -180 到 180 之间的有限数值。")
