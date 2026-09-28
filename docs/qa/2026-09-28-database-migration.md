# 数据库迁移准备验证记录

日期：2026-09-28。目标：未来可将现有业务库托管到 Supabase PostgreSQL 或 Google Cloud SQL for PostgreSQL。

## 验证环境

- Django 5.2、psycopg 3、项目锁定依赖；本机 Python 3.13。
- 实际 PostgreSQL 14.20 独立临时集群，只开放当前用户私有目录的 Unix socket，不监听 TCP；没有使用系统现有 PostgreSQL 数据目录。
- 原始数据为本地联调的 SQLite 演示库。通过 SQLite backup API 创建一致性副本，再从静止副本导出；原库和正在运行的演示后端没有切换托管商。
- CI 新增 PostgreSQL 16 service，但本轮没有推送，不能把本机 PostgreSQL 14 结果称为远端 PostgreSQL 16 已运行。

## 代码与测试

| 项目 | 结果 |
| --- | --- |
| SQLite 全量 pytest | 299 passed，1 skipped（仅 PG 行锁并发用例） |
| PostgreSQL 全量 pytest | 300 passed，包含双连接并发续期和迁移测试 |
| 最终改动后的 SQLite 迁移范围复测 | 22 passed |
| Ruff check / format | 通过，77 个 Python 文件格式检查通过 |
| Django system check | 无问题 |
| makemigrations --check --dry-run | 无未生成的模型迁移 |

新增覆盖包括 URL 特殊字符、TLS、CA、Unix socket、池模式、非法参数不回显凭据、测试环境不使用真实 `DATABASE_URL`，以及导入包校验、权限自然键重映射、FK/M2M、微秒时间、空库保护、错误回滚和回滚后重试。

实测并修复了后台配对登录在 PostgreSQL 的问题：可空 `approved_by` 关联的外连接不能被无条件 `FOR UPDATE` 锁定，现改为只锁配对记录本身。并发回归使用两个独立数据库连接，确认同一申请同时被审批时只续期一次、只生成一条审批审计。

迁移的两个测试也按 PostgreSQL 真实语义修正：关联表调用 `nextval` 后发生事务回滚，可以留下编号间隙；测试中的伪造昵称须遵守真实 `varchar(20)` 长度。这些修正保留业务行/关联行回滚和导入后可继续写入的断言。

## 实际数据搬迁

执行成功：

1. SQLite 副本导出 → 原副本校验。
2. PostgreSQL 空库执行完整 migrations → 导入 → 校验。
3. 独立于迁移工具序列化器，直接用 Django ORM 对两个库的全部持久字段逐项比较，并核对 M2M 自然键。
4. PostgreSQL 再导出 → 新 SQLite 空库 migrations → 导入 → 校验，验证反向恢复路径。

两次搬迁均为 **19 个模型、56 条业务记录**。内容摘要保持一致：

```text
5b05eddbc77110d7d27ab875f777967c1247127a6cad9f9ac12a97cf4b33f24d
```

| 业务范围 | 记录数 |
| --- | ---: |
| 用户 / 管理员 / 会员 / 申请 / 审计 | 4 / 3 / 1 / 2 / 17 |
| 活动 / 商家分类 / 区域 / 商家 | 4 / 1 / 1 / 1 |
| 轮播 / 手册 / 联系配置 / 反馈 | 0 / 1 / 1 / 2 |
| 论坛板块 / 帖子 / 评论 / 点赞 / 举报 | 6 / 8 / 2 / 1 / 1 |
| Django 权限组 | 0 |

- 主键、会员编号、跨实体关联、JSON、状态、时间微秒精度一致。
- 18 个业务模型的自增序列逐一调用 `nextval`，结果均大于现有最大主键；成功导入后的新增用户与权限组关联另有自动测试覆盖。
- 当前演示库没有权限组；有组和权限关联的迁移由专门测试覆盖，并故意改变目标 content type / permission 的 ID，验证自然键仍能正确恢复关联。
- API token、邮箱验证码、邮箱节流、后台配对码、配对节流、浏览器 session 六类目标表均为空，符合重新登录约定。
- 导出包为 `0600` 权限，数据库副本、包、日志保存在被 Git 忽略的 `server/var/`。临时 PostgreSQL 集群在验证后关闭。

## 未覆盖的正式环境条件

本轮没有创建或连接真实 Supabase / Google Cloud 项目，没有上传数据。实际云端的网络路由、TLS 证书、连接额度、IAM/账号权限、备份恢复时效、故障切换和实际所选 PostgreSQL 版本仍须部署时验证；真实微信、SMTP 和正式域名也不因本次数据库回归而变成已验收。

工具适用于停写维护窗口，包上限 64 MiB。数据库附件文件、托管商专属 schema/角色/扩展及在线增量复制不在范围。完整配置、切换与回滚边界见[数据库迁移说明](../database-migration.md)。
