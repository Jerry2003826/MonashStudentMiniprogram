from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.content.models import Activity, Area, Category, HandbookSection, Merchant, SupportSettings


class Command(BaseCommand):
    help = (
        "Create explicitly labeled example content for local development without overwriting edits."
    )

    @transaction.atomic
    def handle(self, *args, **options):
        if not (settings.DEBUG and settings.ENABLE_DEV_LOGIN):
            raise CommandError("seed_content requires DJANGO_DEBUG=true and ENABLE_DEV_LOGIN=true.")
        category, _ = Category.objects.get_or_create(name="餐饮")
        area, _ = Area.objects.get_or_create(name="Clayton")
        Merchant.objects.get_or_create(
            name="示例校园咖啡馆（非真实商家）",
            defaults={
                "category": category,
                "area": area,
                "discount_summary": "示例优惠，不能实际使用",
                "intro": "仅用于演示商家信息页，不代表真实合作、地址或营业状态。",
                "discount_terms": (
                    "这是示例商家，所有优惠均不能实际使用。请等待学生会录入正式资料。"
                ),
                "address": "示例坐标：Monash Clayton 校区附近，并非商家实际地址",
                "latitude": -37.9105,
                "longitude": 145.1362,
                "opening_hours": "待正式资料确认",
                "published": True,
                "featured": True,
                "is_example": True,
            },
        )
        for activity_category, title in [
            ("latest", "示例活动：校园迎新见面会"),
            ("news", "示例资讯：学生会服务介绍"),
            ("past", "示例回顾：校园交流精彩瞬间"),
        ]:
            Activity.objects.get_or_create(
                title=title,
                defaults={
                    "category": activity_category,
                    "summary": "用于演示页面的示例内容，非正式活动或通知。",
                    "location": "待官方公布",
                    "content": "这是一条明确标注的示例内容，用于本地查看页面效果。\n\n"
                    "不代表已举办或即将举办的活动，也不开放报名。真实时间、地点和公众号原文待学生会提供。",
                    "published": True,
                    "is_example": True,
                },
            )
        HandbookSection.objects.get_or_create(
            title="示例手册：认识校园",
            defaults={
                "content": "示例章节，非正式指引。这里将整理校园与学生服务信息。"
                "正式内容须经学生会审核；请勿据此处理入学、出行或住宿安排。",
                "published": True,
                "sort_order": 1,
            },
        )
        SupportSettings.objects.get_or_create(pk=1)
        self.stdout.write(
            self.style.SUCCESS(
                "Example content initialized. Existing edits and official contacts were preserved."
            )
        )
