from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.core.models import User
from apps.forum.models import Board, ModerationStatus, Post


class Command(BaseCommand):
    help = "Seed explicit local forum examples without granting membership or resetting content."

    @transaction.atomic
    def handle(self, *args, **options):
        if not (settings.DEBUG and settings.ENABLE_DEV_LOGIN):
            raise CommandError("seed_forum requires DJANGO_DEBUG=true and ENABLE_DEV_LOGIN=true.")
        author = User.objects.filter(
            username="demo-editor", openid="dev:demo-editor", is_active=True
        ).first()
        if author is None or author.has_usable_password():
            raise CommandError("Run seed_demo first to create the local demo-editor identity.")
        boards = [
            ("二手闲置", "闲置物品转让和求购", False),
            ("租房合租", "找房、转租和找室友", False),
            ("学习交流", "选课与学习经验交流", False),
            ("吃喝玩乐", "分享校园周边与周末生活", False),
            ("求助问答", "同学之间互相帮助", False),
            ("官方公告", "学生会发布的通知与活动", True),
        ]
        created_posts = 0
        for name, intro, staff_only in boards:
            board, _ = Board.objects.get_or_create(
                name=name, defaults={"intro": intro, "staff_only": staff_only}
            )
            _, created = Post.objects.get_or_create(
                author=author,
                board=board,
                title=f"【示例】{name}板块使用说明",
                defaults={
                    "content": (
                        "这是一条本地开发示例，不代表真实通知、交易或活动。\n\n"
                        "论坛当前开放纯文本内容；帖子和评论提交后须人工审核，"
                        "审核通过前仅本人和内容管理员可见。微信内容安全与图片上传尚未开放。"
                    ),
                    "status": ModerationStatus.APPROVED,
                    "reviewer": author,
                    "reviewed_at": timezone.now(),
                },
            )
            created_posts += int(created)
        self.stdout.write(f"Created {created_posts} local example posts; no membership granted.")
