# 第 0 期实施计划：工程底座和假数据原型

> 执行方式：按任务顺序执行，每个任务结束时跑完检查再提交。步骤用 `- [ ]` 标记进度。
> 依据：[需求文档](../requirements.md)、[技术方案](../tech-design.md)。

**目标**：把开发者工具生成的 JS 模板改造成 TypeScript + TDesign 工程，搭好接口层和假数据机制，并用假数据做出技术方案 4.1 节里全部 12 个页面的可点击原型。

**架构**：页面只调用 `services/api/` 里的函数。请求统一经过 `services/request.ts`，开发版默认转给 `services/mock/` 里的假接口。假接口在内存里维护数据，能完整走通「学生认证 → 出示会员卡 → 发帖、评论、点赞、举报」。接口类型写在 `types/api.ts`，假接口和页面共用同一套类型。纯逻辑（请求封装、假接口路由和业务规则、格式化和校验工具）用 Vitest 写单元测试。

**技术栈**：原生小程序（开发者工具内置 TypeScript 编译）、TDesign 小程序组件库、TypeScript（strict）、Vitest、ESLint（typescript-eslint）、Prettier。

## 全局约束

- 小程序代码全部放在 `miniprogram/` 下，`project.config.json` 的 `miniprogramRoot` 为 `miniprogram/`。
- `app.json` 里不能有 `"style": "v2"`，否则 TDesign 组件样式会错乱。
- TypeScript 开启 `strict`，模块之间用相对路径导入。
- 接口字段用 snake_case，与技术方案 5.3 节一致。
- 界面文字全部用中文。
- 按错误码分支时用 `switch`，并在 `default` 里做 `never` 检查。
- 单元测试放在 `tests/miniprogram/`，不放进 `miniprogram/`，避免被打进小程序包。
- 假数据模式下验证码固定为 `123456`；标题、正文、评论或昵称里含「违规」两个字时，假接口返回 `CONTENT_RISKY`，用来演示内容安全拦截。
- 每个任务结束前必须通过 `npm run typecheck`、`npm run lint`、`npm test`；涉及页面的任务还要在开发者工具里打开，并截图确认。
- 提交信息只有标题，使用本计划里写好的那一条。
- 页面里要用新的 TDesign 图标时，先把名字加进 `scripts/build-icon-font.mjs` 的 `APP_ICONS`，再运行 `npm run build:icons`，否则图标显示不出来。

## 文件地图

```text
miniprogram/
├── app.ts                      # 启动时注册 401 处理函数并静默登录
├── app.json                    # 页面、自定义标签栏、全局组件
├── app.wxss                    # 品牌色等 CSS 变量，覆盖 TDesign 主题变量
├── sitemap.json
├── config.ts                   # 运行环境、接口地址、是否使用假数据
├── custom-tab-bar/             # 基于 t-tab-bar 的底部标签栏
├── components/
│   ├── merchant-card/          # 商家列表项
│   └── post-card/              # 帖子列表项
├── pages/                      # 12 个页面，见技术方案 4.1 节
├── services/
│   ├── errors.ts               # ApiError、错误码默认文案、showError
│   ├── token.ts                # token 读写
│   ├── request.ts              # 请求、上传、401 重试、假数据分流
│   ├── auth.ts                 # 静默登录、当前用户缓存
│   ├── api/                    # me.ts、membership.ts、home.ts、merchants.ts、forum.ts
│   └── mock/
│       ├── router.ts           # 路由匹配
│       ├── db.ts               # 内存里的假数据
│       ├── seed.ts             # 初始数据（虚构的商家、用户、帖子和评论）
│       ├── views.ts            # 把假数据转换成接口返回的格式
│       ├── helpers.ts          # 错误、内容检测、读取参数、分页
│       ├── routes.ts           # 汇总所有假接口
│       └── handlers/           # auth.ts、me.ts、membership.ts、home.ts、merchants.ts、forum.ts
├── types/api.ts                # 接口类型（前后端约定）
└── utils/
    ├── format.ts               # 日期、相对时间、时钟格式化
    ├── validate.ts             # 学生邮箱校验
    └── tab-bar.ts              # 同步标签栏选中状态
tests/miniprogram/              # Vitest 单元测试，目录结构和 miniprogram/ 对应
package.json、tsconfig.json、eslint.config.mjs、vitest.config.ts、.prettierrc、.prettierignore
.github/workflows/ci.yml
docs/contributing.md、docs/test-checklist.md
```

## 核心接口

后面各任务都依赖下面这些名字和类型，实现时不要改名。

**`types/api.ts`**

- `API_ERROR_CODES`（常量数组，14 个错误码，与技术方案 5.3 节一致）和 `ApiErrorCode = (typeof API_ERROR_CODES)[number]`
- `ErrorBody { code: ApiErrorCode; message: string }`
- `Paginated<T> { items: T[]; next_cursor: string | null }`（不叫 `Page`，避免和小程序全局的 `Page()` 重名）
- `MembershipState = 'none' | 'active' | 'expired' | 'revoked'`
- `MembershipInfo { state; member_no: string | null; email: string | null; expires_at: string | null; renewable: boolean }`
- `Me { id: number; nickname: string; avatar_url: string | null; banned_until: string | null; membership: MembershipInfo }`
- `LoginResult { token: string; me: Me }`
- `Banner { id; title; image_url; link_type: 'none' | 'merchant' | 'post'; link_id: number | null }`
- `Category { id; name }`、`Area { id; name }`、`MerchantFilters { categories: Category[]; areas: Area[] }`
- `MerchantSummary { id; name; logo_url; category: Category; area: Area; discount_summary }`
- `MerchantDetail extends MerchantSummary { intro; discount_terms; image_urls: string[]; address; latitude; longitude; phone; opening_hours }`
- `MerchantQuery { category?: number; area?: number; q?: string; cursor?: string }`
- `HomeData { banners: Banner[]; featured_merchants: MerchantSummary[] }`
- `Author { id; nickname; avatar_url: string | null }`
- `Board { id; name; intro; staff_only: boolean }`
- `ImageCheckStatus = 'pending' | 'pass' | 'risky'`、`PostImage { id; url; check_status }`
- `PostSummary { id; board: Board; title; excerpt; thumbnail_urls: string[]; author: Author; like_count; comment_count; is_pinned; created_at }`
- `PostDetail { id; board: Board; title; content; images: PostImage[]; author: Author; like_count; comment_count; liked: boolean; is_pinned; is_mine: boolean; created_at }`
- `PostQuery { board?: number; q?: string; author?: 'me'; cursor?: string }`
- `Comment { id; author: Author; reply_to: Author | null; content; created_at; is_mine: boolean }`
- `CreatePostBody { board_id; title; content; image_ids: number[] }`、`CreateCommentBody { content; reply_to_user_id?: number }`
- `LikeResult { liked: boolean; like_count: number }`
- `ReportReason = 'ad' | 'porn' | 'abuse' | 'illegal' | 'other'`、`CreateReportBody { target_type: 'post' | 'comment'; target_id; reason; detail?: string }`

**`services/errors.ts`**

- `ClientErrorCode = ApiErrorCode | 'NETWORK_ERROR'`
- `class ApiError extends Error { readonly code: ClientErrorCode; readonly status: number }`，构造函数 `(code, message, status = 0)`，内部调用 `Object.setPrototypeOf` 保证编译成 ES5 后 `instanceof` 仍然可用
- `isApiError(e: unknown): e is ApiError`
- `defaultMessage(code: ClientErrorCode): string`（`switch` + `never` 检查）
- `showError(e: unknown): void`（`wx.showToast`，非 `ApiError` 时显示通用文案）

**`config.ts`**

- `EnvVersion = 'develop' | 'trial' | 'release'`、`getEnvVersion(): EnvVersion`
- `isMockEnabled(): boolean`（开发版且 `MOCK_IN_DEVELOP` 为 `true`）
- `getApiBaseUrl(): string`（体验版和正式版的地址第 1 期再填，空字符串时抛出错误）
- `MOCK_DELAY_MS = 300`

**`services/token.ts`**：`getToken(): string | null`、`setToken(token: string): void`、`clearToken(): void`，存储键 `auth_token`。

**`services/request.ts`**

- `HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'`（`wx.request` 不支持 PATCH）、`Query = Record<string, string | number | undefined>`，定义在 `services/http.ts`，由 `request.ts` 重新导出
- `RequestOptions { method: HttpMethod; path: string; query?: Query; body?: unknown; auth?: boolean }`（`auth` 默认 `true`）
- `buildUrl(base: string, path: string, query?: Query): string`
- `request<T>(options: RequestOptions): Promise<T>`
- `uploadFile<T>(path: string, filePath: string): Promise<T>`
- `setUnauthorizedHandler(handler: () => Promise<void>): void`

**`services/mock/router.ts`**

- `MockRequest { params: Record<string, string>; query: Record<string, string>; body: unknown }`
- `MockHandler = (req: MockRequest) => unknown`、`MockRoute { method: HttpMethod; pattern: string; handler: MockHandler }`
- `matchRoute(routes, method, path): { route: MockRoute; params: Record<string, string> } | null`
- `resolveMock(routes, method, path, query?, body?): unknown`（找不到路由时抛 `ApiError('NOT_FOUND', ...)`）

**`services/mock/db.ts`**：`getDb(): MockDb`、`resetDb(): void`。**`services/mock/routes.ts`**：`mockRoutes: MockRoute[]`。

**`services/auth.ts`**：`ensureLogin(): Promise<void>`（并发调用只登录一次）、`relogin(): Promise<void>`、`fetchMe(): Promise<Me>`、`getCachedMe(): Me | null`、`setCachedMe(me: Me): void`、`isActiveMember(me: Me | null): boolean`、`logout(): void`。

**`services/mock/helpers.ts`**：`mockError(code, message?)`（按技术方案 5.3 节带上 HTTP 状态码）、`assertSafe(...texts)`（含「违规」时抛 `CONTENT_RISKY`）、`readString(body, key)`、`readNumber(body, key)`、`readNumberArray(body, key)`。

**`services/api/`**

- `me.ts`：`updateNickname(nickname)`、`uploadAvatar(filePath)`、`deleteAccount()`（读取当前用户统一用 `auth.ts` 的 `fetchMe()`；返回 `Me` 的接口会同步更新 `auth.ts` 里的缓存）
- `membership.ts`：`sendEmailCode(email)`、`verifyEmail(email, code)`（返回 `Me`）
- `home.ts`：`getHome()`
- `merchants.ts`：`getMerchantFilters()`、`listMerchants(query)`、`getMerchant(id)`
- `forum.ts`：`listBoards()`、`listPosts(query)`、`getPost(id)`、`createPost(body)`、`deletePost(id)`、`listComments(postId, cursor?)`、`createComment(postId, body)`、`deleteComment(id)`、`likePost(id)`、`unlikePost(id)`、`uploadPostImage(filePath)`、`reportContent(body)`

**`utils/`**

- `format.ts`：`formatDate(iso: string): string`（`YYYY-MM-DD`）、`formatClock(date: Date): string`（`HH:mm:ss`）、`formatRelativeTime(iso: string, now?: Date): string`
- `validate.ts`：`isStudentEmail(email: string): boolean`
- `tab-bar.ts`：`TabValue = 'home' | 'merchants' | 'forum' | 'profile'`、`syncTabBar(page: WechatMiniprogram.Page.TrivialInstance, value: TabValue): void`

## 任务

### 任务 1：改造为 TypeScript 工程并接入 TDesign

**文件**

- 删除：根目录的 `app.js`、`app.json`、`app.wxss`、`sitemap.json`、`pages/`、`utils/`（模板示例代码）
- 新建：`miniprogram/app.ts`、`miniprogram/app.json`、`miniprogram/app.wxss`、`miniprogram/sitemap.json`、`miniprogram/pages/home/index.{ts,json,wxml,wxss}`（临时占位）
- 新建：`package.json`、`tsconfig.json`、`eslint.config.mjs`、`vitest.config.ts`、`.prettierrc`、`.prettierignore`
- 修改：`project.config.json`

**步骤**

- [x] 新建 `package.json`：脚本 `typecheck`（`tsc --noEmit`）、`lint`（`eslint .`）、`test`（`vitest run`）、`format`（`prettier --write .`）；依赖 `tdesign-miniprogram`；开发依赖 `typescript`、`miniprogram-api-typings`、`eslint`、`@eslint/js`、`typescript-eslint`、`prettier`、`vitest`。运行 `npm install`，生成 `package-lock.json`。
- [x] 新建 `tsconfig.json`：`strict`、`target: ES2020`、`module: CommonJS`、`lib: ["ES2020"]`、`types: ["miniprogram-api-typings"]`、`skipLibCheck`、`paths` 把 `tdesign-miniprogram/*` 映射到 `./miniprogram/miniprogram_npm/tdesign-miniprogram/*`；`include` 为 `miniprogram/**/*.ts`、`tests/**/*.ts`、`vitest.config.ts`，排除 `miniprogram/miniprogram_npm`。
- [x] 新建 `eslint.config.mjs`（`@eslint/js` 推荐规则 + `typescript-eslint` 推荐规则，忽略 `node_modules`、`miniprogram/miniprogram_npm`）、`vitest.config.ts`（`include: ['tests/miniprogram/**/*.test.ts']`、`passWithNoTests: true`）、`.prettierrc`（`semi: false`、`singleQuote: true`、`printWidth: 100`）、`.prettierignore`（`miniprogram_npm`、`docs`、`package-lock.json`）。
- [x] 修改 `project.config.json`：`miniprogramRoot: "miniprogram/"`；`setting.useCompilerPlugins: ["typescript"]`；`setting.packNpmManually: true`；`setting.packNpmRelationList: [{ "packageJsonPath": "./package.json", "miniprogramNpmDistDir": "./miniprogram/" }]`。
- [x] 新建 `miniprogram/app.json`：去掉 `"style": "v2"`，保留 `componentFramework`、`lazyCodeLoading`、`sitemapLocation`；`pages` 只有 `pages/home/index`；导航栏标题「蒙纳士中国学生会」。`app.ts` 暂时只有 `App({})`。
- [x] 新建 `miniprogram/app.wxss`：在 `page` 上定义品牌色、背景色、文字色、圆角和间距变量，并用品牌色覆盖 TDesign 的 `--td-brand-color` 系列变量；学生会的视觉规范到位前先用蓝色系占位。
- [x] 首页占位放一个 `t-button`，用于确认 TDesign 可用。
- [x] 构建 npm：`/Applications/wechatwebdevtools.app/Contents/MacOS/cli build-npm --project "$PWD"`，确认生成了 `miniprogram/miniprogram_npm/tdesign-miniprogram/`。
- [x] 在开发者工具里打开项目，截图确认首页的 TDesign 按钮样式正常。
- [x] 运行 `npm run typecheck && npm run lint && npm test`，全部通过。
- [x] 提交：`改造为 TypeScript 工程并接入 TDesign`

### 任务 2：添加接口类型和错误模型

**文件**：新建 `miniprogram/types/api.ts`、`miniprogram/services/errors.ts`；测试 `tests/miniprogram/services/errors.test.ts`

**步骤**

- [x] 先写测试：
  - 遍历 `API_ERROR_CODES` 和 `'NETWORK_ERROR'`，`defaultMessage` 都返回非空字符串；
  - `new ApiError('CODE_INVALID', '验证码错误', 422)` 满足 `isApiError`，`instanceof Error` 为真，`code`、`status`、`message` 与传入值一致；
  - `isApiError(new Error('x'))` 和 `isApiError(null)` 为假。
- [x] 运行 `npm test`，确认因为模块不存在而失败。
- [x] 按「核心接口」一节实现 `types/api.ts` 和 `services/errors.ts`。
- [x] 运行三项检查，全部通过。
- [x] 提交：`添加接口类型和错误模型`

### 任务 3：添加请求封装和假数据机制

**文件**：新建 `miniprogram/config.ts`、`miniprogram/services/token.ts`、`miniprogram/services/request.ts`、`miniprogram/services/mock/router.ts`；测试辅助 `tests/miniprogram/helpers/wx.ts`（假的 `wx` 全局对象：内存存储、可控的 `request`、`uploadFile`、`login`、`getAccountInfoSync`、`showToast`）；测试 `tests/miniprogram/services/mock-router.test.ts`、`tests/miniprogram/services/request.test.ts`

**步骤**

- [x] 先写路由测试：
  - `/merchants/:id` 能匹配 `/merchants/12`，`params` 为 `{ id: '12' }`；
  - 方法不同、段数不同都不匹配；
  - `resolveMock` 找不到路由时抛出 `code` 为 `NOT_FOUND` 的 `ApiError`；
  - 查询参数里值为 `undefined` 的被丢掉，其余转成字符串传给处理函数。
- [x] 再写请求测试（用 `vi.mock` 控制 `config.ts` 的返回值）：
  - `buildUrl('https://a.com/api/v1', '/merchants', { q: '奶茶', area: 2, category: undefined })` 返回 `https://a.com/api/v1/merchants?q=%E5%A5%B6%E8%8C%B6&area=2`；
  - 真接口模式下带上 `Authorization: Bearer <token>`，`auth: false` 时不带；
  - 状态码 2xx 时返回响应体；
  - 非 2xx 且响应体是合法的 `ErrorBody` 时，抛出对应 `code` 的 `ApiError`；响应体不合法时抛 `INTERNAL_ERROR`；
  - `wx.request` 走 `fail` 回调时抛 `NETWORK_ERROR`；
  - 收到 `UNAUTHORIZED` 时调用已注册的处理函数并重试一次，重试后仍是 401 就抛错，不会无限重试；
  - 假数据模式下不调用 `wx.request`，返回假接口的结果。
- [x] 运行 `npm test`，确认失败。
- [x] 按「核心接口」一节实现四个文件。
- [x] 运行三项检查，全部通过。
- [x] 提交：`添加请求封装和假数据机制`

### 任务 4：添加登录状态和会员假接口

**文件**：新建 `miniprogram/services/auth.ts`、`miniprogram/services/api/me.ts`、`miniprogram/services/api/membership.ts`、`miniprogram/services/mock/db.ts`、`miniprogram/services/mock/handlers/auth.ts`、`miniprogram/services/mock/handlers/me.ts`、`miniprogram/services/mock/handlers/membership.ts`、`miniprogram/services/mock/routes.ts`、`miniprogram/utils/validate.ts`；修改 `miniprogram/app.ts`；测试 `tests/miniprogram/utils/validate.test.ts`、`tests/miniprogram/services/auth.test.ts`、`tests/miniprogram/services/mock/membership.test.ts`

**假接口规则**

- `POST /auth/wechat-login`：返回固定的假 token 和当前假用户。
- `POST /membership/email-code`：不是 `@student.monash.edu` 邮箱时返回 `EMAIL_DOMAIN_NOT_ALLOWED`；同一邮箱 60 秒内再次发送返回 `RATE_LIMITED`。
- `POST /membership/verify`：验证码不是 `123456` 时返回 `CODE_INVALID`；成功后会员状态变为 `active`，会员编号 `000123`，到期日为 365 天后；已是有效会员且距离到期超过 30 天时返回 `RENEWAL_NOT_OPEN`。
- `PUT /me`：昵称长度不在 1 到 20 之间时返回 `VALIDATION_ERROR`，含「违规」时返回 `CONTENT_RISKY`。
- `POST /me/avatar`：直接把本地临时文件路径当作头像地址。
- `DELETE /me`：把假用户恢复成初始状态（昵称「微信用户」、未认证）。

**步骤**

- [x] 先写测试：
  - `isStudentEmail`：`a@student.monash.edu` 为真，大写 `A@Student.Monash.edu` 为真，`a@monash.edu`、`a b@student.monash.edu`、空字符串为假；
  - `auth`：没有 token 时调用一次 `wx.login` 并保存 token；已有 token 时不调用；两个 `ensureLogin` 同时调用只登录一次；`relogin` 会清掉旧 token 再登录；
  - 会员假接口：覆盖上面「假接口规则」里 `email-code` 和 `verify` 的每一条（每个测试前调用 `resetDb()`）。
- [x] 运行 `npm test`，确认失败。
- [x] 实现上述文件；`app.ts` 在 `onLaunch` 里调用 `setUnauthorizedHandler(relogin)` 和 `ensureLogin()`，失败时 `showError`。
- [x] 运行三项检查，全部通过。
- [x] 提交：`添加登录状态和会员假接口`

### 任务 5：添加首页、商家和论坛的假接口

**文件**：新建 `miniprogram/services/api/home.ts`、`miniprogram/services/api/merchants.ts`、`miniprogram/services/api/forum.ts`、`miniprogram/services/mock/handlers/home.ts`、`miniprogram/services/mock/handlers/merchants.ts`、`miniprogram/services/mock/handlers/forum.ts`；修改 `miniprogram/services/mock/db.ts`（加入初始数据）、`miniprogram/services/mock/routes.ts`；测试 `tests/miniprogram/services/mock/merchants.test.ts`、`tests/miniprogram/services/mock/forum.test.ts`

**初始数据**：3 张轮播图；4 个分类（餐饮、奶茶甜品、购物、生活服务）；3 个区域（Clayton、Caulfield、City）；8 个虚构商家（名字都是编的，不用真实商家名，其中 3 个是精选）；6 个板块（官方公告为 `staff_only`）；12 个帖子（1 个置顶的官方公告，部分带图）；每个帖子 0 到 4 条评论。图片使用 `https://picsum.photos/seed/<关键字>/<宽>/<高>`，并给 `image` 设背景色，网络不通时也不会留白。

**假接口规则**

- 商家列表：按 `category`、`area` 筛选，按名称搜索（不区分大小写），每页 6 条，游标是偏移量。
- 帖子列表：按 `board`、`q`（标题或正文包含）、`author=me` 筛选；置顶帖在前，其余按发布时间从新到旧；每页 10 条。
- 发帖：非有效会员返回 `MEMBERSHIP_REQUIRED`；`staff_only` 板块返回 `FORBIDDEN`；标题 1 到 50 字、正文 1 到 5000 字、图片不超过 9 张，否则 `VALIDATION_ERROR`；含「违规」返回 `CONTENT_RISKY`。
- 评论：非有效会员返回 `MEMBERSHIP_REQUIRED`；1 到 500 字；含「违规」返回 `CONTENT_RISKY`；成功后帖子的 `comment_count` 加 1。
- 点赞和取消点赞：可重复调用，返回最新的 `liked` 和 `like_count`。
- 删除帖子和评论：只能删自己的，否则 `FORBIDDEN`；删掉的帖子不再出现在列表里。
- 上传帖子图片：返回 `check_status: 'pending'`，5 秒后在假数据里变成 `pass`。
- 举报：非有效会员返回 `MEMBERSHIP_REQUIRED`，否则直接成功。

**步骤**

- [x] 先写测试，覆盖上面每一条规则（图片审核用 `vi.useFakeTimers()` 快进 5 秒）。
- [x] 运行 `npm test`，确认失败。
- [x] 实现上述文件。
- [x] 运行三项检查，全部通过。
- [x] 提交：`添加首页、商家和论坛的假接口`

### 任务 6：添加底部标签栏

**文件**：新建 `miniprogram/custom-tab-bar/index.{ts,json,wxml,wxss}`、`miniprogram/utils/tab-bar.ts`、`miniprogram/pages/merchants/index.*`、`miniprogram/pages/forum/index.*`、`miniprogram/pages/profile/index.*`（占位）；修改 `miniprogram/app.json`（`tabBar.custom: true` 和四个标签页）、`miniprogram/pages/home/index.*`

**步骤**

- [x] 标签栏用 `t-tab-bar`，四项为首页 `home`、商家 `shop`、论坛 `chat`、我的 `user`（图标名先在 TDesign 图标库里确认存在）；切换时调用 `wx.switchTab`。
- [x] 内嵌图标字体（执行时新增）：TDesign 默认从腾讯 CDN 在线加载图标字体，从澳洲访问时快时慢（实测一次要 76 秒），开发者工具里也显示不出来。新增 `scripts/build-icon-font.mjs`（`npm run build:icons`），用 `subset-font` 把字体裁剪成 TDesign 组件内部用到的图标加上我们列出的图标，以 base64 写进 `miniprogram/styles/icon-font.wxss`，由 `app.wxss` 引入，并用 `.t-icon.t-icon` 覆盖 TDesign 的字体。
- [x] 四个标签页在 `onShow` 里调用 `syncTabBar(this, '<值>')`。
- [x] 在开发者工具里依次点四个标签，截图确认选中状态正确。
- [x] 运行三项检查，全部通过。
- [x] 提交：`添加底部标签栏`

### 任务 7：添加首页原型

**文件**：修改 `miniprogram/pages/home/index.*`；新建 `miniprogram/components/merchant-card/index.*`

**页面内容**

- 轮播图（`t-swiper`）：点击时按 `link_type` 跳转到商家详情或帖子详情。
- 会员卡入口：未认证显示「学生认证，免费成为会员」，跳到认证页；有效会员显示「出示会员卡」，跳到会员卡页；已过期显示「会员已过期，去续期」。
- 精选商家：用 `merchant-card` 组件（Logo、名称、分类和区域标签、折扣摘要），点击进入商家详情。

**步骤**

- [x] 实现组件和页面，`onShow` 时 `ensureLogin()` 后并行请求 `getHome()` 和 `fetchMe()`，失败时 `showError`。
- [x] （执行时调整）会员入口的文案按会员状态切换，写成纯函数 `utils/membership.ts` 的 `memberEntry(me)` 并加单元测试；它依赖的 `utils/format.ts` 从任务 10 提前到这里实现。轮播图改用原生 `swiper`，以便在图片上叠加标题。
- [x] 截图确认，再点一次轮播图和商家，确认能跳转（目标页面在后续任务里补齐前，先确认跳转路径正确）。
- [x] 运行三项检查，全部通过。
- [x] 提交：`添加首页原型`

### 任务 8：添加商家列表和详情原型

**文件**：修改 `miniprogram/pages/merchants/index.*`；新建 `miniprogram/pages/merchant-detail/index.*`；修改 `miniprogram/app.json`

**页面内容**

- 列表页：顶部 `t-search` 搜索商家名称；`t-dropdown-menu` 提供「分类」和「区域」两个筛选（都含「全部」）；列表用 `merchant-card`；支持下拉刷新和上拉加载更多；没有结果时显示 `t-empty`。
- 详情页：图片轮播；名称、分类和区域标签；折扣卡片（摘要和使用条件）；营业时间；电话（点击 `wx.makePhoneCall`）；地址（点击 `wx.openLocation`，旁边有「复制」按钮调用 `wx.setClipboardData`）；底部按钮「出示会员卡」，非会员时文案为「认证后享受折扣」并跳到认证页。

**步骤**

- [x] 实现两个页面。
- [x] 截图确认列表、筛选后的列表和详情页。
- [x] 运行三项检查，全部通过。
- [x] 提交：`添加商家列表和详情原型`

### 任务 9：添加「我的」、关于我们和协议页原型

**文件**：修改 `miniprogram/pages/profile/index.*`；新建 `miniprogram/pages/about/index.*`、`miniprogram/pages/agreement/index.*`；修改 `miniprogram/app.json`

**页面内容**

- 我的：头像按钮（`open-type="chooseAvatar"`，选完调用 `uploadAvatar`）；昵称输入框（`type="nickname"`，失焦时调用 `updateNickname`）；会员状态单元格（未认证、有效期至某日、已过期、即将到期可续期）；「我的帖子」「关于我们」「用户协议」「隐私政策」入口；「注销账号」确认弹窗，确认后调用 `deleteAccount`、`logout()`，再 `wx.reLaunch` 回首页。
- 关于我们、用户协议、隐私政策：显示示例文字，并注明「示例文字，正式内容由学生会提供」；协议页通过 `type=terms` 或 `type=privacy` 参数切换内容。

**步骤**

- [x] 实现三个页面。
- [x] 截图确认，并试一次改昵称（含「违规」时应提示失败）。
- [x] 运行三项检查，全部通过。
- [x] 提交：`添加「我的」、关于我们和协议页原型`

### 任务 10：添加学生认证和会员卡原型

**文件**：新建 `miniprogram/pages/verify/index.*`、`miniprogram/pages/member-card/index.*`、`miniprogram/utils/format.ts`；修改 `miniprogram/app.json`；测试 `tests/miniprogram/utils/format.test.ts`

**页面内容**

- 认证页：邮箱输入框（前端先用 `isStudentEmail` 校验）；「发送验证码」按钮，发送后倒计时 60 秒；6 位验证码输入框；「完成认证」按钮，成功后跳到会员卡页。假数据模式下在页面底部提示「假数据模式：验证码固定为 123456」。
- 会员卡页：流动的渐变背景（CSS 动画）、头像、昵称、会员编号、有效期至、每秒刷新的当前时间；计时器在 `onHide` 和 `onUnload` 时清除。未认证时引导去认证；已过期或已取消时显示灰色卡面和状态说明，已过期的显示「去续期」按钮。

**步骤**

- [x] 先写 `format.ts` 的测试：
  - `formatClock(new Date(2026, 8, 24, 9, 5, 3))` 返回 `09:05:03`；
  - `formatDate('2027-09-24T12:00:00+10:00')` 返回 `2027-09-24`；
  - `formatRelativeTime` 以固定的 `now` 计算：不到 1 分钟为「刚刚」，不到 1 小时为「N 分钟前」，不到 24 小时为「N 小时前」，24 到 48 小时为「昨天」，同一年为「M月D日」，跨年为 `YYYY-MM-DD`。
- [x] 运行 `npm test`，确认失败，再实现 `format.ts` 让测试通过。
- [x] 实现两个页面。
- [x] 在开发者工具里走一遍：输入非学生邮箱被拦、发送验证码后倒计时、输错验证码提示、输入 `123456` 成功、会员卡时间在走。截图确认。
- [x] 运行三项检查，全部通过。
- [x] 提交：`添加学生认证和会员卡原型`

### 任务 11：添加论坛首页和发帖原型

**文件**：修改 `miniprogram/pages/forum/index.*`；新建 `miniprogram/pages/post-create/index.*`、`miniprogram/components/post-card/index.*`；修改 `miniprogram/app.json`

**页面内容**

- 论坛首页：`t-search` 搜索；可横向滚动的板块标签（`t-tabs`，第一个是「全部」）；帖子列表用 `post-card`（标题、摘要、最多 3 张缩略图、作者头像和昵称、相对时间、点赞数、评论数、置顶标签）；下拉刷新、上拉加载更多；右下角 `t-fab`「发帖」，非会员点击时弹窗提示先完成学生认证。
- 发帖页：选择板块（不显示 `staff_only` 板块）；标题（最多 50 字）；正文（最多 5000 字，显示字数）；`t-upload` 最多 9 张图，选完逐张调用 `uploadPostImage`；「发布」按钮在板块、标题、正文都填了之后才可点；发布成功后返回论坛首页并刷新。

**步骤**

- [x] 实现组件和两个页面。
- [x] 截图确认；用会员身份发一条正常帖子和一条含「违规」的帖子，确认前者出现在列表里、后者被拦截并提示。
- [x] 运行三项检查，全部通过。
- [x] 提交：`添加论坛首页和发帖原型`

### 任务 12：添加帖子详情、评论和我的帖子原型

**文件**：新建 `miniprogram/pages/post-detail/index.*`、`miniprogram/pages/my-posts/index.*`；修改 `miniprogram/app.json`

**页面内容**

- 帖子详情：标题、板块标签、作者和时间、正文（保留换行）、图片九宫格（点击 `wx.previewImage`；自己的待审核图片显示「审核中」遮罩）；点赞按钮；评论列表（作者、「回复 @某人」、内容、时间，自己的评论可删除）；底部固定的评论输入栏，点某条评论后进入「回复 @某人」模式；右上角「更多」操作（`t-action-sheet`）：举报（选择原因后提交），自己的帖子还有删除。非会员点赞、评论、举报时弹窗提示先完成认证。
- 我的帖子：列表复用 `post-card`，支持下拉刷新和上拉加载更多；没有帖子时显示空状态和「去发帖」按钮。

**步骤**

- [x] 实现两个页面。
- [x] 截图确认，并走一遍：点赞后数字变化、发评论后出现在列表里、回复某人、删除自己的评论、举报、删除自己的帖子后返回列表。
- [x] 运行三项检查，全部通过。
- [x] 提交：`添加帖子详情、评论和我的帖子原型`

### 任务 13：添加 CI 和开发文档，并更新技术方案

**文件**：新建 `.github/workflows/ci.yml`、`docs/contributing.md`、`docs/test-checklist.md`；修改 `docs/tech-design.md`；本计划文件一起提交

**步骤**

- [x] `ci.yml`：在 push 和 pull request 时运行，`ubuntu-latest`、Node LTS，依次执行 `npm ci`、`npm run typecheck`、`npm run lint`、`npm run format:check`（执行时新增）、`npm test`。后端的 CI 在第 1 期加入。
- [x] `docs/contributing.md`：装环境（微信开发者工具、Node LTS、`npm install`、在开发者工具里「构建 npm」）、打开项目、分支和 PR 流程、代码风格、怎么新增一个页面、怎么新增一个假接口、提交信息的写法。
- [x] `docs/test-checklist.md`：12 个页面各自的手动测试清单，内容来自本计划各任务的「页面内容」和需求文档第 8 节的验收标准。
- [x] 更新 `docs/tech-design.md`：第 3 节的目录结构加上 `custom-tab-bar/`、`tests/miniprogram/` 和根目录的配置文件；第 4.5 节注明底部标签栏用 TDesign 的 `t-tab-bar` 自定义实现；第 8 节加上「`services/` 和 `utils/` 里的纯逻辑用 Vitest 写单元测试」；第 9 节把第 0 期的分工改成「技术负责人完成工程底座和全部页面的原型，组员负责打磨页面细节（加载状态、空状态、报错提示、动画）并维护测试清单」。
- [x] 运行三项检查，全部通过。
- [x] 提交：`添加 CI 和开发文档，并更新技术方案`

## 提交清单

| 任务 | 提交信息 |
| --- | --- |
| 1 | 改造为 TypeScript 工程并接入 TDesign |
| 2 | 添加接口类型和错误模型 |
| 3 | 添加请求封装和假数据机制 |
| 4 | 添加登录状态和会员假接口 |
| 5 | 添加首页、商家和论坛的假接口 |
| 6 | 添加底部标签栏 |
| 7 | 添加首页原型 |
| 8 | 添加商家列表和详情原型 |
| 9 | 添加「我的」、关于我们和协议页原型 |
| 10 | 添加学生认证和会员卡原型 |
| 11 | 添加论坛首页和发帖原型 |
| 12 | 添加帖子详情、评论和我的帖子原型 |
| 13 | 添加 CI 和开发文档，并更新技术方案 |
