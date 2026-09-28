# 数据库托管与迁移

本项目统一使用 **PostgreSQL + Django ORM** 作为正式数据库接口。托管目标可以是 Supabase PostgreSQL，也可以是 Google Cloud SQL for PostgreSQL。SQLite 只用于本地开发和快速测试。这里的 Google 方案指关系数据库 Cloud SQL；若将来选择 Firestore，需要另行重做存储模型，不能直接套用本流程。

小程序 → Django API → PostgreSQL。微信登录、会员资格、管理员权限和内容审核仍由现有后端负责；数据库连接串只放在服务端。不引入 Supabase Auth、前端直连数据库或托管商特有表结构，因此切换数据库供应商不要求修改页面。

## 连接配置

在 `server/` 中运行管理命令。先从 `.env.example` 复制出被 Git 忽略的 `.env.target`，再参考 `env/supabase.env.example` 或 `env/cloudsql.env.example` 替换数据库部分。供应商模板只包含数据库设置，不能代替微信、SMTP 和应用安全配置。填写真实配置并限制文件权限；示例值不能直接用于上线。

```sh
cp -n .env.example .env.target
chmod 600 .env.target
```

| 设置 | 用途 |
| --- | --- |
| `DATABASE_URL` | 标准 PostgreSQL URI；用户名、密码、数据库名中的特殊字符须百分号编码 |
| `DB_POOL_MODE` | `direct`、`session` 或 `transaction`，默认 `direct` |
| `DB_CONN_MAX_AGE` | Django 连接保留秒数，默认 60；短生命周期服务可设 0 |
| URL 的 `sslmode` | 远程连接默认 `require`，拒绝明文降级；服务器身份验证用 `verify-full` |
| URL 的 `sslrootcert` | `verify-full` 使用的 CA 证书绝对路径 |
| URL 的 `connect_timeout` | 建立连接的超时秒数 |
| URL 的 `host` | 仅接受绝对 Unix socket 目录，例如 `/cloudsql/project:region:instance` |

事务池模式会关闭服务端游标和 psycopg 自动预编译语句。配置不会创建供应商连接池或自动设置连接额度；部署时还需按工作进程数量和实例额度分配连接预算。**建表、导入、导出和校验使用 direct 或 session 连接。**

### Supabase

从项目 Dashboard 的 Connect 面板复制真实连接串。常驻后端优先直连；只有 IPv4 的网络可使用 session pooler。不要根据区域拼接池地址。事务池仅作为应用运行选项，不能用来执行本项目搬迁命令。[官方连接说明](https://supabase.com/docs/guides/database/connecting-to-postgres)

启用 SSL enforcement；需要验证服务器身份时下载该连接端点适用的 CA，并配置 `sslmode=verify-full&sslrootcert=...`。连接加密和服务器身份验证是两个不同设置。

**导入用户数据前，关闭这个专用项目的 Data API。** 本应用不使用 Supabase 的 REST/GraphQL 数据接口，Django 权限并不能保护绕过 Django 的请求。不要把业务表加入 Realtime publication，不给客户端分发数据库密码或 service-role key。若以后要启用 Data API，须单独设计 exposed schema、grants 和 RLS 后再开。[官方 Data API 安全配置](https://supabase.com/docs/guides/api/securing-your-api)

### Google Cloud SQL

选择 PostgreSQL 实例，通过 Cloud SQL Auth Proxy 或部署平台提供的 Cloud SQL Unix socket 连接。代理的 IAM 授权与数据库用户认证是两层配置；模板使用数据库用户名/密码，不假定已启用自动 IAM 数据库认证。

运行在服务器同一环境的代理只绑定 loopback，例如：

```sh
cloud-sql-proxy --address 127.0.0.1 --port 5433 PROJECT:REGION:INSTANCE
```

对应模板的 URL 使用 `127.0.0.1:5433`；Unix socket 模板也已提供。`sslmode=disable` 仅适用于应用到本机代理/socket 这一段，代理到 Cloud SQL 的连接由代理加密。不要将该配置改成远程裸数据库地址。[Cloud SQL Auth Proxy 文档](https://docs.cloud.google.com/sql/docs/postgres/connect-auth-proxy)

## 搬迁包的范围

`export_database` / `import_database` / `verify_database` 用于当前规模的维护窗口迁移。不是在线复制或双写系统；包上限 **64 MiB** 且会载入内存，正式迁移前须在同规模副本上测量耗时和内存。源端、目标端都使用同一代码版本和完整 Django migrations。

- 保留用户、管理角色、会员编号、申请与审核记录、审计、活动、商家、首页内容、手册、反馈、论坛、点赞和举报；保留主键、外键、权限组与权限关联、JSON 和时间精度。
- 不搬迁 API token、浏览器 session、邮箱验证码和节流记录、后台配对码及配对节流记录。切换后用户和管理员重新登录，未完成的邮箱验证/后台配对需要重做。
- Django content type 和 permission 的系统记录在目标库由 `migrate` 重建；权限关联使用自然键匹配，不依赖两边相同的系统表 ID。
- 包带格式版本、迁移版本清单、模型计数及内容摘要。新增未分类模型时工具会报错，要求先更新搬迁范围。
- 导出文件以 `0600` 新建，拒绝覆盖现有文件。导入只接受空业务库，先验证包和版本，再在事务中导入、重置序列、检查关联与内容；失败回滚。没有强制清库选项。

摘要用于发现损坏或数据差异，不是签名或加密。只导入自己生成、通过可信渠道保管的文件。包包含个人资料和账号字段，保存在 `server/var/` 等受保护、被 Git 忽略的位置；若离开机器应加密传输和存储。数据库以外的图片/附件文件不在包中；当前图片为 URL，未来接入对象存储时需单独迁移文件和访问权限。

## 正式切换步骤

1. 固定代码版本，核对两边 PostgreSQL 版本、区域、网络访问、连接额度和备份策略。目标应是专用于本项目的空库。先在副本完成下面整套流程；不要对已有业务库运行 seed 命令。
2. 准备 `.env.source` 和 `.env.target`，限制权限为 `0600`。生产文件关闭 DEBUG 和开发登录，并配置真实微信、SMTP、域名和服务端密钥。环境变量已有同名值时可能覆盖 env 文件；使用干净的运维进程，核对实际数据库目标且不要把连接串打印到日志。
3. 停止源端所有写入方，包括 API、后台、任务和维护脚本。保留源库备份。SQLite 使用其 backup API 获取一致备份，不能在 WAL 模式下只拷贝正在写入的主文件；PostgreSQL 使用平台快照/逻辑备份。
4. 停写期间导出，并确认包完整。`--maintenance-window` 表示操作者已完成停写，命令本身不会替你停止服务。

```sh
uv run --env-file .env.source python manage.py export_database var/cutover.json --maintenance-window
uv run --env-file .env.source python manage.py verify_database var/cutover.json
```

5. 保持目标应用关闭，先建表，再导入和核对。不要跳过迁移错误；目标存在任何业务/临时登录记录时，改用新空库或由操作者调查，不能覆盖已有数据。

```sh
uv run --env-file .env.target python manage.py check
uv run --env-file .env.target python manage.py migrate --noinput
uv run --env-file .env.target python manage.py import_database var/cutover.json --maintenance-window
uv run --env-file .env.target python manage.py verify_database var/cutover.json
uv run --env-file .env.target python manage.py migrate --check
```

6. 在开放写入前核对会员有效期与卡号、负责人/审核员/编辑权限、待审申请与帖子、商家分类与区域、历史审计，以及导入后的新增记录能否正常生成编号。使用目标后端验证真实微信重新登录、后台配对和 SMTP；数据库一致不等于外部服务已验收。
7. 将后端运行环境切到目标 `DATABASE_URL`，重新启动工作进程。API 域名保持不变时小程序无须改动。放开流量，观察错误率、数据库连接和审批流程。保留源库只读副本及导出包直到回滚窗口结束。

**回滚边界：** 目标尚未产生新业务写入时，可以停掉目标后端并恢复源端配置。目标已经接收新写入后，不能直接切回旧库，否则会丢掉这段数据；必须再次停写，把目标的完整最新业务数据迁到一个已验证的恢复库，再切换。不要双边同时开放写入。

以后 Supabase ↔ Cloud SQL 的小规模迁移也可用同一工具，但它只处理本应用列出的数据；供应商的 `auth`、`storage`、扩展、触发器、RLS、角色和外部文件不在范围。规模增长后，应以 PostgreSQL 原生备份或复制方案取代全量内存搬迁包，并重新演练恢复。

## 回归与边界

默认 `uv run pytest` 使用 SQLite。PostgreSQL 回归只接受显式 `TEST_DATABASE_URL`，使用专用本地/CI 实例；测试需要创建和删除测试数据库的权限，**不要指向正式实例**。配置会忽略业务 `DATABASE_URL`，防止普通测试误用它。

CI 包含 SQLite 和 PostgreSQL 16 两组后端检查。新增字段须提供 Django migration；新增模型还须更新搬迁分类与测试。数据库相关功能应在 PostgreSQL 测试通过后合并。CI 配置在实际推送后才会产生远端执行结果。

本轮本地验证与实际云端连接的边界见[迁移准备验证报告](qa/2026-09-28-database-migration.md)。游标、序列与数据库差异的依据见 [Django 数据库文档](https://docs.djangoproject.com/en/5.2/ref/databases/)，预编译配置依据见 [psycopg 文档](https://www.psycopg.org/psycopg3/docs/advanced/prepare.html)。
