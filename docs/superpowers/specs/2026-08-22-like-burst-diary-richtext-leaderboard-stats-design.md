# 设计：连赞特效、日记富文本、排行榜定位跳转、后台统计页

日期：2026-08-22
状态：已获用户批准，待写实现计划

## 背景

项目为 Vue 3 前端（`web/`）+ Cloudflare Worker/Hono 后端（`worker/`，D1 + R2）。本次新增四个功能：

1. 抖音式连赞（真连击计数 + 飘心特效）
2. 日记富文本（Markdown + 内嵌 HTML：居中插图、字体颜色、字号）
3. 排行榜 Top Photos 点击放大，灯箱内跳转相册对应照片位置；日记榜点击跳日记详情
4. 管理后台新增独立「统计」页（站点总览 + 用户维度汇总）

## 关键决策（用户已确认）

- 连赞为**真连击计数**：同一用户对同一目标可累加多个赞，每用户每目标上限 50。
- 取消方式：**长按**（≥500ms）一次性撤回自己的全部赞；点按 = +1。
- 日记格式保持 **Markdown + 内嵌 HTML**，不引入富文本编辑器，不迁移存量数据。
- 排行榜交互：点缩略图 = 页内灯箱放大；灯箱内「在相册中查看」按钮 = 跳转相册并定位。
- 统计页内容：站点总览卡片 + 用户维度汇总表；changelog 的「数据变动」tab 保持原样不动。

---

## 1. 连赞

### 数据层

新增迁移 `worker/migrations/0013_like_counts.sql`：

```sql
ALTER TABLE likes ADD COLUMN count INTEGER NOT NULL DEFAULT 1;
```

`UNIQUE(user_id, target_type, target_id)` 不变——一人一目标一行，连击累加在 `count` 上。

所有计数从 `COUNT(*)` 改为 `SUM(count)`，共 6 处：

- `worker/src/routes/likes.ts`：`GET /`（约 :19）、`GET /batch`（约 :80）的目标计数子查询。
- `worker/src/routes/public.ts`：leaderboard 的 likes 子查询（:282，三个榜共用同一 SQL 模板）。

排行榜计分公式 `score = likes*5 + views` 不变，likes 自然变为总赞数。

### API（`worker/src/routes/likes.ts`）

- 新增 `POST /api/likes/burst`（`userAuth`）：body `{target_type, target_id, delta}`，`delta` 限定整数 1–10。行不存在则创建（`count = min(delta, 50)`）；存在则 `count = min(count + delta, 50)`。返回 `{liked: true, count: <目标总赞数 SUM(count)>}`。
- 现有 `POST /api/likes/toggle` 语义收窄：已赞 → 删行（撤回全部）；未赞 → 创建 `count=1`（兼容旧前端调用）。
- `GET /` 与 `GET /batch` 的 `liked` 判定不变（行存在即已赞）。

### 前端（`web/src/components/LikeButton.vue`）

组件 props/emit 接口不变（`{targetType, targetId, count, liked}`，emit `update`），所有使用点（AlbumsView、AlbumDetailView、Lightbox、DiariesView、DiaryDetailView、MessageBoard）无需改动。

- **点按**：本地乐观 `count+1`，在点击位置生成心形粒子（上飘 + 随机左右偏移 + 缩放，约 0.8s 后移除）——连点即抖音式连续飘心。300ms 节流，把累计 delta 聚合成一次 `POST /api/likes/burst` 发送；失败时回滚乐观增量。
- **长按**（pointerdown 起 ≥500ms）：调 `toggle` 删行，清零并置未赞；长按触发后抑制本次的点按行为。用 pointerdown/pointerup/pointerleave + 计时器实现。
- **上限**：本地 count 达 50 后停止累加并 toast 提示（i18n 补 key，中英）。
- 未登录点击行为不变（跳登录页）。

### 测试

`worker/test/likes.test.ts` 新增用例：

- burst 首次创建行、累加、delta 非 1–10 整数时返回 400
- 上限 50 钳制
- toggle 已赞删行（撤回全部）、未赞创建
- `GET /`、`GET /batch` 返回 SUM(count)
- 确认 `worker/test/leaderboard.test.ts` 计分仍通过

---

## 2. 日记富文本

存储格式不变：Markdown 纯文本（`diaries.content_md` / `content_md_en`）。样式需求通过内嵌 HTML 实现，marked 透传，预览与详情页 `v-html` 渲染天然生效。

### 上传

`worker/src/routes/admin.ts` 新增 `POST /api/admin/diaries/:id/images`（multipart，admin 鉴权），复用 `saveUpload(env, file, 'image', 'diary')`，R2 前缀 `diary/`，返回 `{url: "/uploads/diary/<uuid>.<ext>"}`。与封面上传 `POST /diaries/:id/cover` 同模式（日记先创建后编辑，id 必存在）。

### 编辑器（`web/src/views/admin/DiaryEditView.vue`）

工具栏三组按钮，作用于当前 tab 的 textarea：

- **插入图片**：隐藏 file input（accept image）→ `apiUpload` → 光标处插入：
  ```html
  <p align="center"><img src="URL" alt=""></p>
  ```
- **字体颜色**：预设色板（默认/红/橙/蓝/绿/紫），选中文字包裹 `<span style="color:...">...</span>`；「默认」移除包裹。
- **字号**：预设 小(0.85em)/默认/大(1.25em)/特大(1.5em)，选中文字包裹 `<span style="font-size:...">...</span>`。
- 未选中文字时点颜色/字号：提示先选择文字（i18n）。

### 展示（`web/src/views/DiaryDetailView.vue`）

`.content` CSS 兜底：`img { display: block; max-width: 100%; margin: 0 auto; }`。

划线评论、版本历史、数据格式均不改动。注意点：`highlightQuotes` 的引用文本匹配在含内嵌 HTML 的正文中可能跨节点，实现后需手动验证含 span/img 段落的划线评论仍正常。

### 测试

`worker/test/diaries.test.ts` 新增图片上传用例（成功返回 url、非图片 400、未授权 401）。前端编辑器交互手动验证。

---

## 3. 排行榜放大 + 跳转

### LeaderboardView.vue

Top Photos 缩略图点击 → 页内打开 Lightbox：`photos` 传榜上照片数组（字段 `id/filename/caption` 与 Lightbox props 兼容），可左右切换。浏览量上报沿用 Lightbox 内置的 `reportView('photo')`，无需额外处理。

### Lightbox.vue

新增可选 prop `albumLink`（函数 `photo => path` 或每张照片携带 `album_id` 后内部构造）。传了则在灯箱角落显示「在相册中查看」按钮（i18n），点击跳转：

```
/:lang/albums/:album_id?photo=<photoId>
```

AlbumDetailView 现有用法不传此 prop，行为不变。

### AlbumDetailView.vue

挂载时读 `route.query.photo`：在照片列表中找到该 id 的 index，用 instant 滚动（非平滑）定位到对应拍立得 slide，`activeIndex` 同步；找不到则忽略参数（停留顶部）。与现有 `onScroll`/`goTo` 逻辑协调：初始定位在首次渲染完成后执行一次。

### 日记榜

条目点击跳转 `/:lang/diaries/:id`；若现有已是该链接，仅确认不改。

### 测试

前端手动验证：排行榜点图 → 灯箱放大/切换 → 跳转相册定位正确照片；相册被删照片时参数容错。

---

## 4. 后台统计页

### 后端（`worker/src/routes/admin.ts`）

新增 `GET /api/admin/stats`（admin 鉴权），返回：

```json
{
  "overview": {
    "users": 0, "likes": 0, "views": 0, "messages": 0,
    "photos": 0, "albums": 0, "diaries": 0
  },
  "users": [
    {
      "id": 1, "username": "...", "avatar": "...", "created_at": "...",
      "checkins": 0, "points": 0, "likes": 0, "messages": 0
    }
  ]
}
```

- `overview.likes` = `SUM(likes.count)`（连赞改造后的总赞数）；`overview.views` = `SUM(view_counts.views)`。
- `users` 一条 SQL：`users` LEFT JOIN 聚合 `checkins`(COUNT)、`likes`(SUM(count))、`messages`(COUNT)，按 `created_at` 倒序，全量返回（用户量级小，无分页）。

### 前端

- `web/src/views/admin/StatsView.vue` 新页面：顶部一排数字卡片（沿用现有 CSS 变量风格），下方用户汇总表格（头像、用户名、注册时间、签到次数、积分、总赞数、留言数）。
- `AdminLayout.vue` 导航插入「统计」项（建议放首位）；`web/src/router.js` 加 `/admin/stats` 路由（与现有 admin 页面同一鉴权机制）。
- i18n：`web/src/i18n/zh.js` / `en.js` 补 `admin.stats` 及统计页全部文案 key。

### 测试

`worker/test/` 新增 stats 用例（返回结构、聚合数值正确、未授权 401）。前端手动验证。

---

## 影响文件清单

**后端**
- `worker/migrations/0013_like_counts.sql`（新）
- `worker/src/routes/likes.ts`（burst 端点、toggle 语义、SUM 计数）
- `worker/src/routes/public.ts`（leaderboard likes 子查询改 SUM）
- `worker/src/routes/admin.ts`（日记图片上传、stats 端点）
- `worker/test/likes.test.ts`、`worker/test/diaries.test.ts`、新增 `worker/test/stats.test.ts`

**前端**
- `web/src/components/LikeButton.vue`（连击、飘心、长按）
- `web/src/components/Lightbox.vue`（albumLink prop + 跳转按钮）
- `web/src/views/LeaderboardView.vue`（点击放大）
- `web/src/views/AlbumDetailView.vue`（query 定位）
- `web/src/views/admin/DiaryEditView.vue`（工具栏：插图/颜色/字号）
- `web/src/views/DiaryDetailView.vue`（图片居中 CSS）
- `web/src/views/admin/StatsView.vue`（新）、`AdminLayout.vue`（导航）、`web/src/router.js`（路由）
- `web/src/i18n/zh.js`、`web/src/i18n/en.js`（新 key）

**迁移执行**：`npm run migrate:local`（本地开发）/ `migrate:apply`（生产）。

## 不做的事（YAGNI）

- 不引入富文本编辑器，不迁移存量日记数据。
- 排行榜点赞权重公式不变（likes*5 + views）。
- 积分系统与点赞不挂钩，无需改动。
- changelog「数据变动」tab 保持原位，不迁入统计页。
- 统计页无分页、无时间筛选。
- 日记正文图片不做点击放大（仅居中显示）。
