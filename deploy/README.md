# 测试环境部署方案

更新于 2026-09-28。代码和本地生产容器已准备；本文是执行方案，不代表云资源已创建或微信体验版已上传。验证结果见 [测试报告](../docs/qa/2026-09-28-staging-readiness.md)。

## 选定架构与费用边界

微信小程序 → HTTPS API → Cloud Run（Django / Gunicorn）→ Supabase PostgreSQL。微信身份、会员、管理员权限和内容审核保留在 Django，客户端不接触数据库凭据或 Supabase service role。文件上传本次不开放。

**基础设施约束（用户确认，2026-09-28）：不依赖微信云资源。** 不启用微信云开发 / CloudBase、微信云函数、微信云托管、微信云数据库或微信云存储，也不以腾讯云资源作为上线前提。此处 Cloud Run 指 **Google Cloud Run**。

小程序通过 `wx.request` 调用自建 HTTPS API；业务代码运行在 Google，业务数据保存在 Supabase PostgreSQL，后续可迁至 Google Cloud SQL。未来如开放文件上传，使用可替换的独立存储服务，不绑定微信云文件 ID。现有源码、依赖和项目配置未发现 `wx.cloud`、CloudBase SDK 或云函数目录配置。

微信平台接口仍保留：`wx.login`、服务器 `code2Session`、文字内容安全检测，以及小程序发布/合法域名配置。这些是当前小程序功能的平台接入，不需要为业务后端开通微信云环境；AppSecret 仅供独立后端调用平台接口。以后扩展 Web 或其他客户端时，继续复用自建 API。

| 部分     | 首批内测配置                                                                                                       | 后续迁移                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| 后端     | 独立 Google Cloud 测试项目；Cloud Run，1 vCPU / 512 MiB，最少 0、最多 2 个实例，单实例并发 4，1 worker / 4 threads | 容器可搬到其他平台                                       |
| 数据库   | 独立 Supabase 项目，优先悉尼；使用控制台实际提供的 Session pooler + TLS，关闭 Data API                             | 改 DATABASE_URL 搬至 Cloud SQL；已有导出、导入、校验工具 |
| 密钥     | Secret Manager，服务账号仅有指定密钥的读取权限                                                                     | 版本固定，更新时发新 revision                            |
| 邮件     | 经过发件人验证的 SMTP，TLS 587；真实学生邮箱验证码                                                                 | 更换 SMTP 配置即可                                       |
| API 域名 | 真实 HTTPS 域名，必须被微信后台接受为 request 合法域名                                                             | 不把云平台默认域名当作已获微信认可                       |

区域是建议，开通后须按实际区域填写隐私说明。Google 与 Supabase 是两个供应商；同城并不等于同网络，仍需真机测延迟和连接可靠性。

Supabase Free 当前包含 500 MB 数据库，闲置一周会暂停，适合少量内测，不承诺持续可用。Cloud Run 按用量计费，免费额度按账单账户共享，构建、镜像、出网及域名/邮件另计。建议先设 **US$10/月预算提醒**，达到提醒后人工检查；预算提醒和实例限制都不是硬性费用封顶。此方案尚未启用付费资源。价格以开通时控制台为准：[Supabase 定价](https://supabase.com/pricing)、[Cloud Run 定价](https://cloud.google.com/run/pricing)。

本机已登录 Google Cloud，当前默认项目名为 Gemini API。应新建独立测试项目，所有命令显式传 `--project`，避免把本项目资源混入现有用途。

## 已准备的文件

- `server/Dockerfile`：非 root 生产镜像，构建时收集静态文件；启动不自动迁移或填充演示数据。
- `server/env/staging.env.example`：服务端完整配置模板；实际值放在 gitignored、权限 0600 的 `server/.env.staging`。
- `deploy/cloudrun.env.example.yaml`：Cloud Run 的非密钥配置；复制后填写真实值。
- `deploy/trial-config.example.json`：小程序公开 API、版本、运营方、联系方式、存储区域和保留政策。
- `server/ops/preflight.py`：配置检查及可选在线探测，不输出密钥，不发送邮件或用户文本。
- `scripts/prepare-components.mjs`：从锁定版本的 npm 包准备小程序组件及其内嵌依赖，新克隆和 CI 均可运行。
- `scripts/prepare-trial.mjs`：独立小程序编译包、文件哈希和体积报告；不会自动上传。
- `deploy/compose.smoke.yaml`：仅用于隔离的本地生产模式验证，内含合成密码，禁止用作线上配置。

## 开通与配置顺序

1. 确认专用 Google Cloud 项目及账单账户，创建 Artifact Registry、Secret Manager 与 Cloud Run 运行服务账号。启用 `run.googleapis.com`、`artifactregistry.googleapis.com`、`cloudbuild.googleapis.com`、`secretmanager.googleapis.com`。构建账号需要该镜像仓库的写入权限；运行账号只读必需密钥，不授予项目 Editor。
2. 登录 Supabase，创建独立空测试项目，关闭本应用不用的 Data API。连接串必须从 Connect 面板复制，不能按区域拼主机名。Session pooler 支持 IPv4；选 `DB_POOL_MODE=session`、`DB_CONN_MAX_AGE=0`。最低 `sslmode=require`，建议下载供应商 CA 后使用 `verify-full` 并挂载证书。供应商入口见 [连接说明](https://supabase.com/docs/guides/database/connecting-to-postgres)。
3. 微信管理员取得当前 AppID 的 AppSecret，并检查服务器 API 权限/调用 IP 配置；填入服务端密钥文件。不得改为假登录或假安全审核绕过。开通 SMTP 并验证发件人，填真实凭据。
4. 确定可用 API 域名/证书，在微信后台配置 request 合法域名，并按实际收集项完善隐私保护指引和地理位置权限。默认 `run.app` 域名是否可用必须在后台实际验证；不通过时使用运营方持有的合规域名。公众号 web-view 另需对应业务域名；尚未配置的功能保持关闭。
5. 确认公开运营方、支持邮箱、真实存储区域、数据保留与删除联系流程；填写 `deploy/trial-config.json`。这些信息不可由构建器虚构。内测卡不作真实折扣凭证，示例商家不能当成已签约商家发布。

密钥文件不要贴到聊天、提交 Git 或放进小程序。`.dockerignore` 和 `.gcloudignore` 会同时排除 `.env*`、本地数据库、测试代码和导出文件。首次上线使用空数据库，不上传本地演示用户/邮箱/申请数据。

## 本地预检与生产镜像

以下先在仓库根目录执行（Node 24、uv、Docker）：

```sh
npm ci
npm run prepare:components
npm run typecheck
npm run lint
npm run format:check
npm test
cd server
uv sync --locked
uv run ruff check .
uv run ruff format --check .
uv run pytest
uv run --env-file .env.staging python -m ops.preflight
uv run python -m ops.container_smoke --report var/container-smoke-report.json
```

当前空模板预检应失败，这是缺少真实服务配置的明确提示。`--online` 才连接数据库、SMTP 和微信：数据库必须已迁移；SMTP 只鉴权和 NOOP，不能据此声称验证码已送达；微信只验证 AppSecret，不传用户文本。

Cloud Run 需要 Linux x86_64 镜像。Apple Silicon 本地默认构建的 arm64 镜像不能直接当作云端成品；使用 Cloud Build 构建，或 `docker buildx build --platform linux/amd64`。[容器约定](https://cloud.google.com/run/docs/container-contract)

## 云端执行手册

本节是待执行命令，`PROJECT_ID`、`IMAGE`、域名和密钥版本须替换为开通后的真实值。创建资源/上传源码会产生云账单。不要在尚未确认的默认项目上运行。

在仓库根目录设置非敏感变量：

```sh
MNP_PROJECT='PROJECT_ID'
MNP_REGION='australia-southeast1'
MNP_IMAGE="${MNP_REGION}-docker.pkg.dev/${MNP_PROJECT}/miniprogram/api:0.1.0"
MNP_ACCOUNT="miniprogram-runtime@${MNP_PROJECT}.iam.gserviceaccount.com"
gcloud builds submit ./server --project "$MNP_PROJECT" --tag "$MNP_IMAGE"
```

首次部署前在 Secret Manager 建立以下密钥并记录**数字版本**：`mnp-django-key`、`mnp-database-url`、`mnp-wechat-secret`、`mnp-smtp-user`、`mnp-smtp-password`。通过控制台或 `--data-file` 上传，避免把值作为命令参数或写进 YAML。对这五个密钥分别给运行账号 `roles/secretmanager.secretAccessor`。下例假设全部为首个版本；轮换后应使用实际版本。[Cloud Run 密钥配置](https://cloud.google.com/run/docs/configuring/services/secrets)

```sh
MNP_SECRET_REFS='DJANGO_SECRET_KEY=mnp-django-key:1,DATABASE_URL=mnp-database-url:1,WECHAT_APPSECRET=mnp-wechat-secret:1,EMAIL_HOST_USER=mnp-smtp-user:1,EMAIL_HOST_PASSWORD=mnp-smtp-password:1'
```

填写 `deploy/cloudrun.env.yaml`，`DJANGO_ALLOWED_HOSTS` 包含真实 API 域名及平台健康检查需要的 `localhost,127.0.0.1`，不能用 `*`。同一正式域名写入 `PUBLIC_API_ORIGIN`、`CSRF_TRUSTED_ORIGINS`。反向代理必须覆盖客户端提供的转发协议头，才可保持 `DJANGO_TRUST_PROXY_SSL_HEADER=true`。

先单独运行迁移 job，使用与服务**同一个镜像版本**，任务数/并发均为 1，失败不自动反复执行：

```sh
gcloud run jobs create miniprogram-migrate --project "$MNP_PROJECT" --region "$MNP_REGION" \
  --image "$MNP_IMAGE" --service-account "$MNP_ACCOUNT" \
  --env-vars-file deploy/cloudrun.env.yaml --set-secrets "$MNP_SECRET_REFS" \
  --command python --args manage.py,migrate,--noinput \
  --tasks 1 --parallelism 1 --max-retries 0 --task-timeout 10m \
  --cpu 1 --memory 512Mi --execute-now --wait
```

后续版本用 `gcloud run jobs update` 更新同名 job 后执行。迁移成功才部署服务：

```sh
gcloud run deploy miniprogram-api --project "$MNP_PROJECT" --region "$MNP_REGION" \
  --image "$MNP_IMAGE" --service-account "$MNP_ACCOUNT" \
  --env-vars-file deploy/cloudrun.env.yaml --set-secrets "$MNP_SECRET_REFS" \
  --port 8080 --cpu 1 --memory 512Mi --cpu-throttling \
  --min 0 --max 2 --max-instances 2 --concurrency 4 --timeout 30s \
  --startup-probe httpGet.path=/readyz,httpGet.port=8080,timeoutSeconds=10,periodSeconds=10,failureThreshold=12 \
  --allow-unauthenticated
```

公开的是访客内容/API 入口，会员与管理接口仍由应用鉴权。生产 `/api/v1/docs`、开发身份入口均关闭。保持最少实例 0 会有冷启动；测试时记录首次打开耗时。不要通过自动 ping 强保活来规避费用。

配置实际域名映射并确认 TLS 后，在 `server/` 运行：

```sh
uv run --env-file .env.staging python -m ops.preflight --online --probe-api
```

该命令同时检查健康、数据库迁移、真实首页与管理登录页面，防止“健康端点正常，但业务路径 HTTPS 循环跳转”的误判。Cloud Run 自带的 Docker HEALTHCHECK 不替代上面的平台 startup probe。入口失败时先读该 revision 的错误摘要，不输出数据库 URL、微信 secret 或用户文本。

## 微信体验版与验收

在仓库根目录执行：

```sh
npm run check:trial -- --config deploy/trial-config.json
npm run prepare:trial -- --config deploy/trial-config.json --output artifacts/trial-0.1.0
```

输出目录必须不存在；工具不会覆盖旧包。只导入产物中的 `project.config.json`，保持合法域名检查开启。用微信开发者工具编译、管理员确认上传，公众平台设为体验版并加入测试者。`trial-manifest.json` 的 `uploaded:false/networkVerified:false` 是构建时事实；上传/真机验证应另附实际回执，不把它手工改成成功。带 `synthetic` 的版本仅供离线构建检查，其 API 入口主动抛错，禁止发布。

首位负责人先完成真实微信登录，再由部署操作人员核实用户 ID、用同一版本和密钥配置单独执行 `python manage.py bootstrap_owner --user-id USER_ID`。只初始化第一位负责人，后续角色由负责人在后台管理。运行 job 时覆盖 entrypoint 为 `python`，不能把命令追加到 Gunicorn 启动脚本后。然后再次运行预检并加 `--check-owner`。

真机必须完成以下闭环后才能邀请一般测试者：微信登录；真实邮箱收验证码；申请待审→负责人审核→测试会员卡；文字帖/评论安全检测与人工审核；反馈在后台可见；管理员配对、角色拒绝访问；定位同意/拒绝均可浏览；退出/重新登录不越权。邮件试发需要明确测试收件人；目前只验证了连接能力设计，没有实际发送邮件。

## 备份、迁移与回滚

Free 数据库不可当作已有每日备份保障。邀请测试者前做一次加密导出并验证恢复，指定保管位置与负责人；后续按约定频率导出并定期恢复演练。导出含个人信息，不能加入镜像或 Git。本轮已验证的搬迁流程见 [数据库迁移说明](../docs/database-migration.md)。

每次发布记录镜像 digest、Cloud Run revision、迁移列表和体验版号。失败时将流量切回前一个兼容 revision；数据库不自动降级、删除或覆盖。涉及破坏性 schema 变化先做备份与双版本兼容演练；体验版也保留前一版本目录。

迁到 Cloud SQL 时保持 PostgreSQL 与 Django 数据模型不变，按维护窗口导出→空库迁移→导入→逐模型校验→切 DATABASE_URL；令牌/会话不迁，要求重新登录。不需要重写小程序的数据访问层。
