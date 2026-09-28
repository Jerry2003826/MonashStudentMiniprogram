# 会员人工审核与管理后台：本地实现

本阶段接续[前端规划对齐](2026-09-28-planning-alignment.md)，范围为身份、邮箱验证、会员申请/审核、会员卡授权与管理员账号权限。活动、商家、论坛、反馈等真实内容接口不属于本阶段。旧需求中“验证邮箱立即开卡”“换微信号自动转移资格”和“管理员使用用户名密码登录”不再作为实现目标。

## 状态与默认规则

微信登录只确定用户身份，邮箱验证码只证明邮箱控制权。提交有效验证码后创建待审核申请；管理员批准后才创建或延长会员资格。申请状态 `pending/approved/rejected` 与资格状态 `none/active/expired/revoked` 分开保存。

沿用原型的学生邮箱域、12 个月有效期与到期前 30 天续期窗口。续期审批前保持旧的到期时间，不能因为提交申请自动延期；申请被拒绝不会提前撤销仍有效的旧资格。新资格从批准日开始，未到期续期从旧到期日延长。具体校务政策以后可调整，当前是项目开发默认值。

同一用户、同一邮箱最多各有一份待审申请；重复审核只能有一个生效结果。邮箱归属其他微信账号时拒绝自动转移；已撤销资格不能通过重新提交验证码恢复。

## 角色与界面

| 角色 | 审核会员 | 管理账号与角色 | 备注 |
| --- | --- | --- | --- |
| 负责人 `owner` | 可以 | 可以 | 保留至少一位有效负责人 |
| 会员审核员 `reviewer` | 可以 | 不可以 | 直接访问账号页面或接口同样被拒绝 |
| 内容编辑 `editor` | 不可以 | 不可以 | 为后续内容管理预留，本阶段没有内容 CRUD |
| 普通用户 | 不可以 | 不可以 | 只能查询本人状态、申请及使用有效会员能力 |

每次服务端请求重新检查账号是否启用以及当前角色。前端菜单仅负责显示入口，不参与授予权限。后台会话、API token 都不能在管理员停用或撤权后继续执行旧权限。

管理员通过微信身份确认浏览器登录：浏览器生成短时配对码，管理员在小程序“我的 → 确认后台登录”输入并明确确认，原浏览器取得该管理员会话。配对码与浏览器高熵秘密分别保存，具有过期、限流和单次消费限制。浏览器写操作使用 CSRF 校验。

正式首位负责人由有服务器操作权限的人绑定到已完成微信登录的真实用户。其他账号由负责人在后台创建和配置。不会为真实管理员设置默认密码。

## 接口约定

基础路径 `/api/v1`，错误统一为 `{code,message}`。输入白名单外的角色、审核状态等字段不能随普通用户请求生效。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/auth/wechat-login` | 服务器向微信兑换 code，返回自有随机 token 与 Me |
| GET / PATCH | `/me` | 本人状态与受限资料更新 |
| POST | `/membership/email-code` | 发送邮箱验证码，受冷却、总量、过期和猜测次数限制 |
| POST | `/membership/applications` | 验证邮箱并提交待审核申请，返回 Me |
| GET | `/membership/card` | 服务端检查有效资格后返回卡资料 |
| GET | `/staff/applications` | 审核员/负责人查询申请 |
| POST | `/staff/applications/{id}/review` | 人工批准或拒绝并记录审计信息 |
| GET / POST | `/staff/accounts` | 负责人查询/创建管理账号 |
| PATCH | `/staff/accounts/{id}` | 负责人修改角色或停用账号 |
| POST | `/staff/login/confirm` | 已登录管理员确认浏览器配对码 |

`Me.membership` 在原字段上增加 `application`，无申请时为 `null`，否则包含 `id/email/status/submitted_at/reviewed_at/review_note`。`Me.staff_role` 是当前有效管理角色或 `null`，不允许客户端修改。

正式微信密钥仅在后端环境变量中配置；API 不接受客户端自行提交 openid，也不向客户端返回微信 session_key。登录 token 和邮箱验证码以哈希形式存储。

## 开发模式与真实服务的区别

小程序默认仍使用本地 mock，会员申请演示同样停在待审，不再自动发卡。前端里的固定演示验证码只适用于 mock。

本地 Django 使用 SQLite 文件持久化，验证码邮件写入 `server/var/emails/`，不会实际发送。`seed_demo` 提供 `demo-student/demo-owner/demo-reviewer/demo-editor`，开发登录端点与页面必须同时满足 `DJANGO_DEBUG=true`、`ENABLE_DEV_LOGIN=true` 及本地访问限制。正式配置不允许开启此旁路，开发接口不能登录任意真实用户。

后端真实模式需要 PostgreSQL、独立密钥、微信 AppID/AppSecret 与邮件服务配置。本阶段未创建收费资源、外发邮件、部署或发布。真实微信服务、SMTP、PostgreSQL 并发和真机授权须分别验证，不能由 SQLite 单元测试代替。

切换前端到本地后端时，在 `miniprogram/config.ts` 将 `MOCK_IN_DEVELOP` 改为 `false`，按需要将 `DEVELOPMENT_LOGIN_USERNAME` 设为种子账号（默认 `null`）。演示身份仅允许开发版及 loopback 接口；切换身份后清除 `auth_token` 并重新编译。体验版和正式版始终走微信登录。尚未实现的内容接口会显示未加载，不能宣称整站已经切换到真实后端。

运行命令和验证结果在后端 README 与本阶段验证报告中记录。

## 参考文档

- [Django 5.2 身份与会话](https://docs.djangoproject.com/en/5.2/topics/auth/default/)
- [Django CSRF](https://docs.djangoproject.com/en/5.2/ref/csrf/)
- [Django Ninja 自定义认证](https://django-ninja.dev/guides/authentication/)
- [微信 code2Session](https://developers.weixin.qq.com/miniprogram/dev/server/API/user-login/api_code2session.html)
