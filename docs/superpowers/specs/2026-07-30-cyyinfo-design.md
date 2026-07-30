# 情侣纪念独立站 — 设计文档

日期：2026-07-30
状态：已获用户确认

## 1. 概述

一个情侣/纪念性质的个人独立站，部署在 Cloudflare，包含五大功能：

1. **桌宠**：将 `cyy/` 下的羽毛球女孩像素桌宠移植到网页，悬浮陪伴
2. **照片**：相册分组展示，后台上传管理
3. **日记**：长篇文章（类似微信公众号文章），Markdown 写作
4. **音乐**：陶喆三张专辑（David Tao / I'm OK / 黑色柳丁）在线播放，音频资源由用户自行补充
5. **后台**：多账号管理后台，支持访客留言审核、纪念日倒计时配置、整站访客口令

定位：情侣/纪念站，偏纪念册风格。面向自己和亲友。

## 2. 架构（方案 A：镜像 ysoho）

与 `ysoho/` 完全同构：**Cloudflare Pages（前端 SPA）+ Workers（Hono API）+ D1（数据）+ R2（文件）**。

```
cyyinfo/
├── worker/                  # Cloudflare Worker（Hono + TypeScript）
│   ├── wrangler.toml        # D1 binding DB + R2 binding UPLOADS + [vars]
│   ├── migrations/          # 编号 SQL：0001_initial.sql ...
│   └── src/
│       ├── index.ts         # CORS 白名单 + 安全响应头 + 路由挂载
│       ├── types.ts         # Env 接口
│       ├── security.ts      # 单 isolate 内存滑动窗口限流
│       └── routes/
│           ├── public.ts    # /api 公开接口
│           ├── admin.ts     # /api/admin 登录 + 管理接口（JWT）
│           └── storage.ts   # /uploads/:path 从 R2 读文件
├── web/                     # Vue 3 + Vite SPA，部署到 Cloudflare Pages
│   ├── functions/           # Pages Functions 同源代理（免 CORS）：
│   │   ├── api/[[path]].ts      # /api/*      → Worker
│   │   └── uploads/[[path]].ts  # /uploads/*  → Worker
│   ├── public/
│   │   ├── _headers         # CSP 等安全头
│   │   ├── _routes.json     # 排除 /assets/*
│   │   └── pet/             # 桌宠静态资源（见 §5）
│   └── src/
│       ├── api.js           # 同源 fetch 封装，JWT 存 localStorage，401 自动跳登录
│       ├── views/           # 前台页面 + admin/ 后台页面
│       └── components/
├── scripts/
│   └── upload_music.py      # 音乐批量导入脚本（见 §8）
└── docs/
```

- Worker：名 `cyyinfo-api`，`compatibility_flags = ["nodejs_compat"]`，主入口 `src/index.ts`
- 敏感配置走 `wrangler secret`：`JWT_SECRET`、`ADMIN_USERNAME`、`ADMIN_PASSWORD`（首个管理员初始化用）；非敏感走 `[vars]`：`JWT_EXPIRE_HOURS`
- 部署：Worker 用 `wrangler deploy` + `wrangler d1 migrations apply`；Pages CI 构建命令 `cd web && npm install && npm run build`，输出 `web/dist`
- 开发：`worker/` 下 `wrangler dev`；`web/` 下 `vite`，`vite.config.js` proxy 把 `/api`、`/uploads` 转发到本地 wrangler
- 不复制 ysoho 的 `server/`（遗留 FastAPI）和 `document/`（旧 MySQL DDL）

## 3. 数据模型（D1 / SQLite）

```sql
admin_users   (id, username UNIQUE, password_hash, display_name, created_at)
albums        (id, title, description, cover_photo_id NULL, sort_order, created_at)
photos        (id, album_id → albums, filename, caption, taken_at NULL, sort_order, created_at)
diaries       (id, author_id → admin_users, title, slug UNIQUE, content_md,
               cover_filename NULL, status TEXT CHECK(status IN ('draft','published')),
               published_at NULL, created_at, updated_at)
music_albums  (id, title, cover_filename NULL, year, sort_order)
songs         (id, album_id → music_albums, title, track_no, filename, duration NULL, created_at)
messages      (id, nickname, content, target_type TEXT CHECK(target_type IN ('diary','photo','site')),
               target_id NULL, is_approved INTEGER DEFAULT 0, created_at)
settings      (key TEXT PRIMARY KEY, value TEXT)
```

- `settings` 键：`site_name`、`anniversary_date`（纪念日起始日期，ISO 日期）、`site_passcode_hash`（bcrypt，空 = 站点公开）
- 预置三张音乐专辑：David Tao(1997)、I'm OK(1999)、黑色柳丁(2002)（migration 里 seed）
- 文件名统一 uuid，R2 内按前缀区分：`photos/`、`music/`、`covers/`

## 4. 认证与安全

### 4.1 管理员（多账号）

- `POST /api/admin/login` 签发 JWT（`jose`，HS256），密码 bcrypt（`bcryptjs`）
- `admin_users` 表为空时，用 wrangler secret 的 `ADMIN_USERNAME`/`ADMIN_PASSWORD` 初始化首个管理员
- 账号管理接口：列表/新增/改密/禁用
- 管理路由统一 `adminRoutes.use('*')` 中间件校验 `Authorization: Bearer`

### 4.2 访客口令（可选，整站级）

- 后台「站点设置」可设置/修改/清除口令；**为空 = 站点公开**
- `POST /api/passcode/verify` 验证口令，通过则签发**访客 JWT**（role=`guest`，7 天有效），前端存 localStorage
- 启用口令后，所有公开内容接口（相册/照片/日记/音乐/留言）要求带访客 JWT 或管理员 JWT；口令为空时直接放行
- 前端路由守卫：无有效凭证且站点启用了口令 → 全部前台页面跳 `/gate`（全屏单输入框口令页）
- 管理接口始终只认管理员 JWT，不受访客口令影响
- 留言无需账号：访客通过口令后即可留昵称 + 留言

### 4.3 限流与防护（复用 ysoho security.ts 模式）

- 登录：5 次/15 分钟/IP；口令验证：5 次/15 分钟/IP；留言：10 条/小时/IP
- 留言服务端限长；上传校验 MIME 类型与大小；CORS 白名单；安全响应头
- 错误统一 `{ detail: msg }` + HTTP 状态码

## 5. 桌宠移植

源：`cyy/resources/app/`（Electron 版，纯 canvas 像素 sprite 播放器）。

- 拷入 `web/public/pet/`：`renderer.js`（~127 行，纯 canvas，无 Electron 依赖的动画播放核心）、`skins/default/{skin.json, spritesheet.webp}`
- 新写 `web/public/pet/pet-adapter.js` 适配层，替换 renderer 的两个 `window.petAPI` 触点：
  - 初始皮肤加载：`invoke('skin-current')` → `fetch('/pet/skins/default/skin.json')`
  - `onPet(...)` 命令通道 → 页面内函数调用；`send('drag-begin'/'once-done')` 等打桩或改为回调
- 行为（基础陪伴级）：待机循环动画 + 随机台词气泡（来自 skin.json `events` 池）+ 点击切换动作/台词；悬浮页面右下角，桌面端可拖动
- 全局组件 `<DesktopPet>`，挂在 SPA 根布局，路由切换不消失
- 不做：亲密度/心情/喂食/成就（Electron `main.js` 的完整状态系统），YAGNI

## 6. API 设计

### 6.1 公开 API（启用口令时需访客凭证）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/passcode/verify` | 验证访客口令 → 访客 JWT |
| GET | `/api/site/status` | 是否启用口令、站点名、纪念日配置（始终公开，供口令页/倒计时） |
| GET | `/api/albums` | 相册列表 |
| GET | `/api/albums/:id` | 相册详情 + 照片列表 |
| GET | `/api/diaries?page=` | 已发布日记列表（倒序分页） |
| GET | `/api/diaries/:slug` | 日记正文（Markdown） |
| GET | `/api/music/albums` | 音乐专辑列表 |
| GET | `/api/music/albums/:id` | 专辑详情 + 曲目列表 |
| GET | `/api/messages?target_type=&target_id=` | 已审核留言 |
| POST | `/api/messages` | 提交留言（待审核，限流） |

### 6.2 管理 API（`/api/admin/*`，管理员 JWT，登录限流）

- 认证：`POST /api/admin/login`
- 账号：`GET/POST /api/admin/users`、`PUT/DELETE /api/admin/users/:id`
- 相册：`GET/POST/PUT/DELETE /api/admin/albums(/:id)`
- 照片：`POST /api/admin/photos`（multipart 上传 → R2，uuid 文件名，类型/大小校验）、`PUT/DELETE /api/admin/photos/:id`、排序、设相册封面
- 日记：`GET/POST/PUT/DELETE /api/admin/diaries(/:id)`（草稿/发布、slug 由作者手动填写、缺省回退用数字 id 访问、封面图上传）
- 音乐：`GET/POST/PUT/DELETE /api/admin/music/albums(/:id)`、`POST/PUT/DELETE /api/admin/music/songs(/:id)`（音频上传 → R2、排序）
- 留言：`GET /api/admin/messages?pending=1`、`POST /api/admin/messages/:id/approve`、`DELETE /api/admin/messages/:id`
- 设置：`GET/PUT /api/admin/settings`（站点名、纪念日起始日期、访客口令设置/清除）

### 6.3 文件读取

`GET /uploads/:path` — 从 R2 读取，30 天 cache-control。

## 7. 前端页面

### 7.1 前台（Vue SPA）

- `/` 首页 — 纪念日倒计时（在一起 X 天）、最新日记摘要、随机照片、桌宠悬浮
- `/albums`、`/albums/:id` — 相册墙 → 照片网格 + 灯箱
- `/diaries`、`/diaries/:slug` — 日记列表 → 公众号式长文阅读页（Markdown 渲染，居中单栏，封面头图），底部留言区
- `/music`、`/music/:id` — 专辑封面墙 → 曲目列表；底部固定迷你播放器（播放/暂停/上一首/下一首/进度条/音量），原生 `<audio>`，SPA 路由切换不中断；不做歌词
- `/gate` — 访客口令页（启用口令时）

### 7.2 后台（`/admin/*`）

登录、仪表盘、照片管理（按相册分组）、日记编辑（Markdown 编辑 + 预览 + 发布/草稿）、音乐管理（专辑 + 逐首上传）、留言审核、账号管理、站点设置（含访客口令、纪念日）。

### 7.3 前端错误处理

`api.js` 统一封装：遇 401 按上下文跳 `/gate`（访客）或 `/admin/login`（管理员）；上传前端预校验类型/大小并给友好提示。

## 8. 音乐资源导入

音频资源由用户自行补充，两种方式都支持：

1. **后台逐首上传**：「音乐管理」页传 mp3/m4a + 填歌名/曲目号，适合零散补传
2. **批量脚本** `scripts/upload_music.py`（参考 ysoho `compress_and_upload.py`）：本地按 `music/专辑名/01_歌名.mp3` 组织文件，脚本批量 `wrangler r2 object put` 并生成 songs 表 INSERT SQL，适合首次整专辑导入

**版权注意**：陶喆歌曲为版权音乐，站点仅自用，不公开传播；建议启用访客口令控制访问。

## 9. 测试

- Worker：vitest + `@cloudflare/vitest-pool-workers` 路由级测试 — 认证（管理员/访客口令）、限流、各资源 CRUD 主路径
- 前端组件与桌宠适配层：手动验证清单（见实施计划）
- 不上 e2e（与 ysoho 一致）

## 10. 明确不做（YAGNI）

- 桌宠完整状态系统（亲密度/心情/喂食/成就）
- 歌词显示
- 留言回复/楼中楼
- 照片 EXIF 解析、自动压缩管线（首版直接上传原图，后续需要再加）
- 邮件通知（ysoho 有 Resend，本站首版不做）
