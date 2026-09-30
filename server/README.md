# 本地会员、内容与管理服务

Django 5.2 + Django Ninja，Python 3.12 及以上，依赖由 `uv.lock` 固定。实现微信身份交换、邮箱验证码、会员人工审核、卡片授权、管理员角色与浏览器配对登录。已增加活动、商家、首页、手册、联系方式、文字论坛与反馈的数据库接口和管理页面；小程序默认仍使用 mock 演示。

## 本地启动

在仓库的 `server/` 目录执行：

```sh
uv sync --locked
cp -n .env.example .env
```

需要完整本地演示时，在 `.env` 中明确设置 `ENABLE_DEV_LOGIN=true` 和 `WECHAT_CONTENT_SAFETY_MODE=fake`，保留 `DJANGO_DEBUG=true`，再运行：

```sh
uv run --env-file .env python manage.py migrate
uv run --env-file .env python manage.py seed_demo
uv run --env-file .env python manage.py seed_content
uv run --env-file .env python manage.py seed_forum
uv run --env-file .env python manage.py runserver 127.0.0.1:8000
```

`.env.example` 默认开启本地 DEBUG、关闭开发登录，文字安全模式默认为 `wechat`。上述 `fake` 仅适用于本机演示身份和 loopback 请求；共享测试必须改回 `wechat` 并配置真实凭据。不要将开发配置用于公网部署。`.env`、SQLite 数据库、验证码邮件和缓存都不进入版本控制。命令仅绑定 loopback 地址。

- 管理界面：[http://127.0.0.1:8000/manage/](http://127.0.0.1:8000/manage/)
- 本地接口文档：[http://127.0.0.1:8000/api/v1/docs](http://127.0.0.1:8000/api/v1/docs)
- 健康检查：[http://127.0.0.1:8000/healthz](http://127.0.0.1:8000/healthz)
- SQLite：`var/db.sqlite3`；重启服务不会清空数据。
- 本地邮件：`var/emails/`；验证码随机生成，没有真实发送，也不使用前端 mock 的固定 `123456`。

`seed_demo` 只创建明确的开发身份，不会重置已存在的角色、停用状态或会员审批结果。演示用户 `demo-student`，管理员 `demo-owner/demo-reviewer/demo-editor`。浏览器登录页的本地演示按钮须由操作者点击；它不是微信验证。

## 联调小程序

学生邮箱域名统一在服务端 `MEMBERSHIP_ALLOWED_EMAIL_DOMAINS` 配置，多个域名用逗号分隔（默认 `student.monash.edu`）。`GET /api/v1/membership/config` 无需登录，只公开标准化后的 `allowed_email_domains`；小程序读取它来展示和校验，不需要重编译来调整域名。配置为空或含非法域名时相关接口返回 503，小程序配置读取失败时禁止发送和提交，刷新成功后恢复。Mock 模式使用演示配置，不代表真实服务的域名列表。

在 `miniprogram/config.ts` 中将 `MOCK_IN_DEVELOP` 改为 `false`，将 `DEVELOPMENT_LOGIN_USERNAME` 从 `null` 改为一个上述开发身份。清除开发者工具中的 `auth_token` 并重新编译；开发者工具访问本机 HTTP 时，需要其本地调试设置允许未配置合法域名的请求。

开发身份只允许开发版、loopback API 和后端双开关都明确启用的环境。原配置默认 `null`，走 `wx.login`。不要把本地 URL 配成体验版/正式版地址。

验证流程：

1. 以 `demo-student` 打开会员申请页，填写用于本地演示的学生邮箱，发送验证码。
2. 查看新生成的 `var/emails/` 邮件文件，将验证码填入小程序；提交后必须显示“待审核”，不能显示有效会员卡。
3. 浏览器进入管理页面，以演示审核员或负责人登录，查看申请并明确批准或拒绝。
4. 小程序刷新状态：批准后才出现有效卡；拒绝显示处理意见；尚未审核时仍不能取得会员能力。
5. 以审核员访问账号管理 URL 应被拒绝；负责人可以创建/修改其他管理账号，停用或改角色后其旧会话权限立即变化。

6. 浏览器以负责人或内容编辑员进入「内容管理」，新增活动草稿；草稿不公开，发布后小程序活动列表和详情可见，下架后隐藏。
7. 有效演示会员在小程序提交纯文字帖子，详情显示待审核；后台「论坛审核」批准后公开，拒绝后作者能看见理由。
8. 评论同样须人工审核；公开数量只统计已批准评论。点赞幂等，举报可在后台查看原内容并记录处理结果。
9. 从小程序提交反馈，在「用户反馈」处理状态和备注。本地开发身份有本机测试标识，不会发送到学生会外部渠道。

`seed_content` / `seed_forum` 仅创建本地示例内容，不授予会员资格；再次运行不会重置已修改记录。示例图片网址、联系方式与正文不是正式内容；官方联系方式默认留空。需要回到原型时恢复 `MOCK_IN_DEVELOP=true`、`DEVELOPMENT_LOGIN_USERNAME=null` 并清除开发 token 后重新编译。

`seed_forum` 在本地演示库中创建六个板块。正式空库执行 migrations 后不会自动拥有板块，当前后台也没有板块创建入口；正式板块初始化仍是上线前待完成项。不要在真实环境开启开发开关或运行演示种子来填补这一缺口。

论坛当前仅支持文字。图片上传、头像上传和账号注销尚未实现；请勿按正式全功能服务验收。微信文字内容安全已接入昵称、帖子、评论和反馈，检测不可用时阻止保存；平台真实凭据尚未联调。人工审核仍保留，不能代替平台检测。

## 微信管理员确认登录

正式路径不使用管理员密码：

1. 浏览器进入登录页，生成短时配对码。
2. 已绑定管理账号的微信用户在小程序“我的 → 确认后台登录”输入该码，并明确点击确认。
3. 发起配对的原浏览器获得会话；其他浏览器仅凭同一个码不能取得该会话。

配对码过期或已消费后不能重放。数据库记录限制生成、确认和轮询频率；账号启用与角色在确认、消费及后续请求中重新验证。演示页面和端点在正式配置下不可使用。

首位正式负责人在该用户完成真实微信登录后，由服务器操作人员执行：

```sh
uv run --env-file .env python manage.py bootstrap_owner --user-id USER_ID
```

此命令要求目标库中不存在任何启用的负责人，包括 `demo-owner`；只初始化第一位负责人，不为用户创建密码，拒绝演示身份。真实测试库应与本地演示库分开，不要迁入演示负责人后直接执行此命令。后续通过现有负责人管理账号。不得从请求中的任意 `openid`、角色或 `is_staff` 字段建立权限。

## 检查

```sh
uv run ruff check .
uv run ruff format --check .
DJANGO_SETTINGS_MODULE=config.settings_test uv run python manage.py check
DJANGO_SETTINGS_MODULE=config.settings_test uv run python manage.py makemigrations --check --dry-run
uv run pytest
```

测试默认使用独立内存 SQLite 和 locmem 邮件，不触达微信或实际 SMTP。显式设置 `TEST_DATABASE_URL` 可在专用本地/CI PostgreSQL 实例执行全套测试；测试会创建并删除 `test_<数据库名>`，不得指向正式实例。普通 `DATABASE_URL` 不会被测试配置使用。CI 保留 SQLite 并增加 PostgreSQL 16 回归，其中包含双连接并发审核测试；远端结果在实际推送运行后才成立。

## Supabase / Google 数据库托管

正式存储统一使用 PostgreSQL，可选 Supabase 或 Google Cloud SQL for PostgreSQL。通过服务端 `DATABASE_URL` 切换，微信登录与权限仍在 Django 内，小程序不保存供应商数据库凭据。

- 配置解析集中在 `config/database.py`，支持 TLS/CA、Cloud SQL Unix socket 和 direct/session/transaction 模式。
- `env/supabase.env.example`、`env/cloudsql.env.example` 是数据库部分的配置模板，需与应用和 SMTP 配置合并。
- `export_database`、`import_database`、`verify_database` 提供维护窗口导出、空库原子导入与逐模型校验，保留业务编号和关联数据。
- Supabase 导入前须关闭本应用不用的 Data API；切换时 token/session 不搬迁，用户重新登录。

准备、迁移和回滚步骤见[数据库迁移说明](../docs/database-migration.md)，验证证据见[迁移准备报告](../docs/qa/2026-09-28-database-migration.md)。本轮不创建或连接真实云实例。

## 接入真实服务前

关闭 `DJANGO_DEBUG` 和 `ENABLE_DEV_LOGIN`，配置独立 `DJANGO_SECRET_KEY`、允许的主机、PostgreSQL `DATABASE_URL`、`WECHAT_APPID/WECHAT_APPSECRET` 及 SMTP。缺少必要配置时服务拒绝启动或相关接口明确报错，不会退回假登录或静默发送成功。Gunicorn、WhiteNoise 静态资源、HTTPS 代理配置、就绪检查与非 root 容器已补齐并验证；真实域名、云端凭据、网关策略和生产备份仍需部署验收。

完整约定见[会员与角色说明](../docs/plans/2026-09-28-membership-backend.md)和[内容与审核说明](../docs/plans/2026-09-28-content-backend.md)。

## 测试环境发布

选定 Cloud Run + Supabase PostgreSQL，保留迁到 Cloud SQL 的能力。完整步骤见[部署手册](../deploy/README.md)，实测结果见[上线准备报告](../docs/qa/2026-09-28-staging-readiness.md)。

```sh
uv run --env-file .env.staging python -m ops.preflight
# 填写真实服务、部署并迁移后；只连接 SMTP，不发送邮件
uv run --env-file .env.staging python -m ops.preflight --online --probe-api --check-owner
# 隔离的本地生产模式测试，自动清理本次创建的容器及卷
uv run python -m ops.container_smoke --report var/container-smoke-report.json
```

模板为 `env/staging.env.example`。实际 `.env.staging` 不进 Git 或镜像；缺少真实凭据应使预检失败。服务镜像启动仅运行 Gunicorn，数据库迁移与首位负责人初始化必须显式执行。
