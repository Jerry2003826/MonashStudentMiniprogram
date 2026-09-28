# 测试版本上线准备验证

日期：2026-09-28。分支：`Jiarui/planning-alignment`。本报告记录当前工作区的本地验证，未代表远端 CI、真实云环境或微信上传结果。

## 结论

生产容器、PostgreSQL、微信内容安全接入、上线预检和小程序体验版构建已准备。选定 Cloud Run + Supabase PostgreSQL，数据库仍可迁移至 Cloud SQL。

**尚未上线。** 没有创建云数据库/Cloud Run 服务，没有真实 API URL 或体验版二维码。当前缺少云项目开通、微信 AppSecret、SMTP、微信认可的 HTTPS 域名，以及运营方确认的公开隐私信息。空配置预检返回失败，符合预期。

## 实际执行结果

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| Node 24 类型 / ESLint | 通过 | Node 23 不满足当前依赖要求，`.nvmrc`、engines、CI 已统一 Node 24 |
| 前端完整测试 | 238 通过，32 个文件 | 包含真实/演示模式隔离、构建配置、请求重试、会员和权限 |
| 后端 SQLite | 424 通过，1 跳过 | 唯一跳过为 PostgreSQL 专用并发锁测试 |
| 后端 PostgreSQL 16 | 425 通过 | 本次创建的独立临时 Docker 数据库，结束后已删除 |
| Ruff / Django check / migrations | 通过 | 无新增待生成迁移 |
| 生产容器，Linux arm64 | 20 项通过 | Gunicorn + PostgreSQL 16，DEBUG=false |
| 生产容器，Linux amd64 | 20 项通过 | 已实际构建并通过同一套测试，适用于 Cloud Run 所需 CPU 架构 |
| `check --deploy --fail-level ERROR` | 无错误，2 个已知警告 | HSTS 子域覆盖与 preload 未启用；未确认全部子域 HTTPS，保留关闭，不隐藏警告 |
| Cloud Build 上传文件集合 | 通过 | 89 个文件；不含 `.env*`、本地数据库、导出数据、虚拟环境、pytest fixtures |
| 缺少真实配置的预检 | 正确失败 | 明确指出数据库、微信密钥、邮件及 HTTPS 地址缺失，未发生联网探测 |
| 微信开发者工具实际编译 | 18 页通过，最终改动的 4 页复验通过 | 390px、基础库 3.17.3；0 脚本异常、0 console error、0 网络尝试；不代表真实后端/真机联调 |

本地原始记录位于被 Git 忽略的 `server/var/container-smoke-report.json`、`server/var/container-smoke-amd64-report.json`、`server/var/postgresql16-tests.txt`。临时容器仅清理本次随机项目及其卷，没有修改其他 Docker 服务或已有本地演示数据库。

amd64 镜像标识：`miniprogram-api:staging-amd64-check`，本次本地镜像 ID：`sha256:3805f8ffe1cc53a84b122a06b93b7ff2d91e5b269e0fe8df4d7dc2bab5c93824`。未推送镜像仓库；实际云端发布仍需重新构建/推送并记录云端 digest。

## 生产行为验证

完整的 20 项容器检查覆盖：

- 测试用 `check_text → pass` fixture、pytest、环境密钥文件和本地数据库不在镜像中。
- 未迁移数据库时 `/readyz` 返回 503；显式迁移后返回 200。
- HTTP 业务请求跳 HTTPS；经过可信 HTTPS 代理的真实首页和管理登录页面正确响应，预检识别其数据结构和 CSRF 表单。
- 调试文档不存在；匿名会员接口 401；开发登录入口拒绝访问。
- 首页、活动、商家公开读取成功；DEBUG=false 管理登录页与哈希静态资源可加载。
- HSTS 生效、Cookie 带 Secure；容器重启后独立数据库中的测试活动保留。
- 尝试用 DEBUG=true 启动生产镜像会失败。

## 内容安全与前端行为

微信 `stable_token` 与 `msgSecCheck v2` 已接入昵称、帖子、评论和反馈；使用服务器保存的真实登录身份。服务不可用、超时、异常响应或风险内容都不保存。需人工复核的论坛内容保持待审；昵称复核结果不直接公开。

锁等待、获取 token、分段检测和最多一次 token 刷新共用 10 秒预算。异步网络 I/O 在期限到达时取消并关闭响应流，同步请求返回后不继续发起晚到的检测。新增慢阶段、持续流式响应和慢 DNS 回归测试。真实微信调用尚未验收，本地测试使用受控传输响应。

体验版构建使用独立的公开配置，关闭 mock 和开发身份，强制 HTTPS `/api/v1`。写请求给予 30 秒，不自动重放；不确定结果时提示先刷新核对，减少重复提交。真实模式中头像上传、论坛图片和自助注销明确未开放；隐私页区分本地演示与持久保存，公开信息必须先配置。

DevTools 验证发现并修复了论坛/我的帖子加载失败后缺少持续提示和重试、个人页会员状态标题被挤断两个问题；新增 5 项回归测试。390px 截图确认修复。

最终离线产物为 `server/var/trial-synthetic-offline-v3`：305 个运行文件，656,471 字节（约 641 KiB），全部 SHA256 与 manifest 一致，合法域名检查开启。v1 完整 18 页与 v3 改动页证据分别在 `server/var/trial-devtools-evidence-v1/` 和 `server/var/trial-devtools-evidence-v3/`。

`synthetic` 版本用于离线检查，API 入口主动拒绝联网。构建清单保留 `uploaded:false` 与 `networkVerified:false`；不能把离线产物当成已发布测试版。

## 开放测试前必须取得的真实证据

1. 云端 PostgreSQL 已迁移、Cloud Run HTTPS 实际业务路径通过预检，Secret Manager 权限与指定版本已验证。
2. 微信后台接受 request 合法域名，真机开启域名检查后登录成功；微信内容安全权限与调用成功。
3. 指定测试者实际收到验证码邮件，申请待审→管理员批准→测试卡的闭环成功；预检 SMTP NOOP 不能替代收件验证。
4. 真实首位负责人已绑定，后台配对和角色权限通过；不导入本地演示用户或自动授予会员资格。
5. 隐私保护指引、实际运营联系渠道和保留政策已确认；位置同意/拒绝两条路径真机验证，地图底图在真实设备可用。
6. 体验版上传回执、测试者授权及二维码已取得；备份恢复与前一版本回滚路径已记录。

执行步骤、费用和账号依赖见 [部署方案](../../deploy/README.md)。数据库搬迁能力见 [迁移验证](2026-09-28-database-migration.md)。

## 推送前的全新环境验证

补齐 `npm run prepare:components`，从锁文件指定的 TDesign npm 发布目录准备组件及内嵌依赖，不依赖开发者工具此前生成的文件。全新临时源文件副本初始没有 `node_modules` 或 `miniprogram_npm`，实际执行 `npm ci`、组件准备、类型、ESLint、格式和全套测试全部通过（238 项）。1,177 个准备文件与锁定发布目录 SHA256 一致，内嵌字体未改变。原始报告保存在忽略的 `server/var/fresh-clone-components-check/`。CI 已为 `main` 和 `Jiarui/**` 推送及 PR 配置四组检查；远端结果以对应提交的 Actions 回执为准。
