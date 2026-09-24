# 贡献指南

写给小程序组的每一位同学：从装环境到提交 PR 的完整流程。架构和接口细节见[技术方案](./tech-design.md)。

## 1. 准备环境

1. 安装[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)（稳定版）。
2. 安装 Node.js 22 或 24（长期支持版），用 `node -v` 检查版本。
3. 安装 git，并确认能访问项目的 GitHub 仓库。
4. 请技术负责人在小程序后台把你加为「开发者」，否则不能在手机上预览。

## 2. 第一次运行

```bash
git clone <仓库地址>
cd <仓库目录>
npm ci
```

1. 打开微信开发者工具，选择「导入项目」，目录选**仓库根目录**，不是 `miniprogram/`。
2. 点菜单「工具 → 构建 npm」，生成 `miniprogram/miniprogram_npm/`。这个目录不提交到 git，每个人在自己电脑上构建。
3. 点「编译」，模拟器里出现首页就说明成功了。

现在默认是**假数据模式**：所有接口都由 `miniprogram/services/mock/` 里的假接口返回，不需要后端。

- 学生认证的验证码固定是 `123456`。
- 标题、正文、评论或昵称里带「违规」两个字，会模拟内容安全拦截。
- 假数据保存在内存里，重新编译后会恢复初始状态。

## 3. 开发流程

1. 从最新的 `main` 拉一个分支：

   ```bash
   git switch main && git pull
   git switch -c feat/<简短描述>   # 修 bug 用 fix/<简短描述>
   ```

2. 写代码。提交前在本地跑一遍检查：

   ```bash
   npm run typecheck   # 类型检查
   npm run lint        # 代码检查
   npm run format      # 自动格式化
   npm test            # 单元测试
   ```

3. 在开发者工具里，按[手动测试清单](./test-checklist.md)把改动涉及的页面过一遍。
4. 提交并推送，在 GitHub 上开 PR。CI 会自动跑类型检查、代码检查、格式检查和单元测试。
5. 技术负责人 review 通过后，用 squash 方式合并。

提交信息用中文，一句话说清楚做了什么，比如「商家列表支持按区域筛选」。

## 4. 代码约定

- 页面不直接调用 `wx.request`，只调用 `services/api/` 里封装好的函数。
- 接口字段保持和后端一致的 snake_case（比如 `next_cursor`），前端不改名。
- 接口出错统一用 `showError(err)` 提示用户。
- 按错误码或枚举值分支时用 `switch`，并在 `default` 里写 `never` 检查，写法参考 `utils/membership.ts`。这样以后新增一种状态，编译器会指出哪里没处理。
- 颜色、间距用 `app.wxss` 里定义的 CSS 变量，不要写死颜色值。
- 注释只用来解释「代码本身看不出来的原因」，不要复述代码在做什么。

## 5. 常见任务

### 新增一个页面

1. 在 `miniprogram/pages/<页面名>/` 下新建 `index.ts`、`index.wxml`、`index.wxss`、`index.json` 四个文件，页面名用小写字母加连字符。
2. 在 `miniprogram/app.json` 的 `pages` 里加上 `pages/<页面名>/index`。
3. 用到的 TDesign 组件写在页面 `index.json` 的 `usingComponents` 里。
4. 新建文件后，如果开发者工具报「module ... is not defined」，点一次「编译」；还不行就关掉项目重新打开。

### 新增一个接口

1. 在 `miniprogram/types/api.ts` 里加请求和响应的类型，和技术方案 5.3 节保持一致。
2. 在 `miniprogram/services/api/` 对应的模块里加调用函数。
3. 在 `miniprogram/services/mock/handlers/` 里写假接口，并在 `mock/routes.ts` 里注册。
4. 在 `tests/miniprogram/services/mock/` 里给假接口的规则写单元测试。

### 使用新的图标

TDesign 的图标字体是裁剪后内嵌进来的，只包含用到的图标，没列进去的图标会显示成空白。要用新图标时：

1. 在 TDesign 图标库里找到图标名。
2. 把名字加进 `scripts/build-icon-font.mjs` 的 `APP_ICONS`。
3. 运行 `npm run build:icons`，把重新生成的 `miniprogram/styles/icon-font.wxss` 一起提交。

## 6. 常见问题

- **`npm install` 报 `Cannot read properties of null (reading 'edgesOut')`**：这是 npm 10 的 bug，安装 Vitest 这类依赖时会触发。改用 `npx npm@11 install <包名>`，或者升级到 Node 24。平时用 `npm ci` 按锁文件安装不受影响。
- **图标显示成空白**：图标名没有加进 `APP_ICONS`，按上面「使用新的图标」处理。
- **提示找不到 TDesign 组件**：重新执行「工具 → 构建 npm」。
- **模拟器显示「模拟器启动失败」**：先点「编译」重试；还不行就完全退出开发者工具，再重新打开项目。
