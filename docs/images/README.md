# 当前界面截图

本目录的 `current-*.png` 于 **2026-09-28（Australia/Melbourne，AEST）**从运行中的应用截取，共 **11 张**。对应业务源码提交为 [`0d48ff0`](https://github.com/Jerry2003826/MonashStudentMiniprogram/commit/0d48ff0605b4a01a8033f539d790027f094b5847)，位于 `Jiarui/planning-alignment` 分支。此次 README 更新只修改文档和截图。

## 小程序：8 张开发演示截图

- 时间：18:40–18:42 AEST。
- 微信开发者工具，基础库 `3.17.3`；模拟器逻辑尺寸 **390 × 844**，导出的 PNG 为 **586 × 1266**。
- 使用当前源码的 `MOCK_IN_DEVELOP=true`、`DEVELOPMENT_LOGIN_USERNAME=null`，数据由前端 mock 提供。
- 会员申请通过实际页面输入、发送验证码和提交事件进入待审核；没有绕过审核或手工注入成功状态。未发送真实邮件，未授予会员资格。
- 截图完成后已恢复初始演示状态。以下内容不能用作真实会员资格、商家合作或线上服务可用性的证明。

| 图片                                         | 页面来源                       | 截图中的状态                                                   |
| -------------------------------------------- | ------------------------------ | -------------------------------------------------------------- |
| [首页](current-home.png)                     | `pages/home/index`             | 初始非会员状态；示例活动与申请入口                             |
| [活动](current-activities.png)               | `pages/activities/index`       | 最新活动分类与示例列表                                         |
| [商家优惠](current-merchants.png)            | `pages/merchants/index`        | 向下滚动展示筛选和列表；未申请定位、未展开地图                 |
| [论坛](current-forum.png)                    | `pages/forum/index`            | 预置演示帖子；其中图片为已有素材，不代表支持图片上传           |
| [我的](current-profile.png)                  | `pages/profile/index`          | 同一次模拟申请待审核；头像修改和注销仅为 mock 能力             |
| [会员申请待审核](current-verify-pending.png) | `pages/verify/index`           | 演示邮箱、验证码 `123456`；申请 `pending`、会员资格仍为 `none` |
| [新生手册](current-handbook.png)             | `pages/handbook/index`         | 明确标注为示例的章节和联系入口                                 |
| [帖子详情](current-post-detail.png)          | `pages/post-detail/index?id=1` | 纯文字公告和已有示例评论；未新增帖子或评论                     |

## 管理后台：3 张本地数据库截图

- 时间：18:44 AEST；Playwright Chromium，**1280 × 850** 浏览器视口，按视口截取。
- 当前源码在 `127.0.0.1:8011` 的专用服务中运行，读取原本地 SQLite 演示库的独立备份副本；没有使用旧进程来代表新代码。
- 显式启用本地 `DEBUG`、开发登录和模拟文字安全模式。页面读取真实 Django HTTP 服务和数据库，内容仍为已有演示记录，未连接云数据库。
- 只浏览表单，没有保存内容、审批会员或评论、修改角色。17 张业务表与原库比对一致；专用服务已关闭，原本地服务未改动。

| 图片                                     | 页面来源                             | 截图中的状态                                           |
| ---------------------------------------- | ------------------------------------ | ------------------------------------------------------ |
| [会员审核](current-admin-membership.png) | `/manage/applications/`              | 负责人查看待审核演示申请；尚未提交结果                 |
| [活动编辑](current-admin-content.png)    | `/manage/content/activities/4/edit/` | 已有本地联调示例的编辑表单；未保存，底部字段在视口下方 |
| [论坛审核](current-admin-forum.png)      | `/manage/forum/?kind=comments`       | 已有演示评论待审核；尚未提交结果                       |

页面中 `demo-reader`、`local.qa.editor` 等邮箱标识均用于演示，没有实际发送邮件。截图不代表微信真实登录、SMTP 送达、公网部署或真机验收已经通过。

## 历史图片

`01-*`、`alignment-*`、`backend-*`、`content-*` 及已有 GIF 保留供历史文档引用，不能代表当前功能。尤其是旧版四栏目、验证即开卡、图片发帖等画面，应以根目录 [README](../../README.md) 的当前范围说明为准。
