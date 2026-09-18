# 管理列表分页搜索 + 热门相册统计口径 — 设计

日期:2026-08-25
状态:已获用户批准

## 背景

两个独立但都很小的需求:

1. 管理后台的照片(相册列表 + 相册内照片)、菜品、日记列表目前都是全量加载、无搜索,需要加分页和搜索。
2. 排行榜"热门相册"(`worker/src/routes/public.ts`)目前只统计相册自身的赞和浏览(`target_type='album'`),需要把相册下照片的点赞和浏览也并入。

经用户确认的关键决策:

- 照片页两层都加:相册列表分页+搜索;相册内照片分页+搜索。不新增独立的全量照片列表接口。
- 分页交互用页码翻页(返回 total),不用"加载更多"。
- 热门相册同时并入照片的点赞**和浏览**,榜上显示数字变为合计口径。

## 设计

### 1. 后端:admin 列表接口分页 + 搜索

模式沿用公开侧 `public.ts` 的先例:**不带参数时保持旧的数组返回结构(向后兼容现有调用方),带 `page`/`size`/`q` 参数时返回 `{ items, total, page, size }`**。

- 把 `public.ts` 内部的 `parsePagination(c, defaultSize, maxSize)` 抽到 `worker/src/` 的共享模块(如 `worker/src/pagination.ts`),`public.ts` 与 admin 路由共用,行为不变。
- 参数约定:`page` 从 1 开始,`size` 默认 20、上限 100,`q` 为模糊搜索(LIKE `%q%`,转义 `%`/`_`)。

改动的接口:

| 接口 | 分页对象 | 搜索字段 |
|---|---|---|
| `GET /admin/albums` | 相册列表 | `title`、`title_en` |
| `GET /admin/albums/:id` | 返回中 `photos` 字段变为分页对象(相册信息本身不变) | 照片 `caption` |
| `GET /admin/dishes` | 菜品列表 | `name`、`description` |
| `GET /admin/diaries` | 日记列表 | `title` |

注意点:

- `/admin/dishes` 目前会二次全量查 `dish_wants` 拼 `want_usernames`;分页后只查当前页菜品 id 的 wants(IN 查询)。
- `/admin/albums/:id` 带参数时返回 `{ ...album, photos: { items, total, page, size } }`;不带参数时保持 `{ ...album, photos: [...] }`。
- 排序保持现状:相册 `sort_order, id`;照片、菜品、日记维持各自现有 ORDER BY。

### 2. 前端:三个管理页接入

- 新增共享小组件 `web/src/components/AdminListBar.vue`:包含搜索输入框 + 页码条(上一页/下一页/页码 + 总数),props 传 `total/page/size`,emit `search(q)` 与 `page(p)`。避免在 PhotosView、DishesView、DiariesView 四处复制同一套 UI 逻辑。
- `admin/PhotosView.vue`:相册列表改为分页请求;选中相册后,相册内照片也是分页请求;切相册时照片页码归 1。
- `admin/DishesView.vue`、`admin/DiariesView.vue`:全量请求改为分页请求。
- 搜索输入 300ms 防抖;搜索词变化或翻页时重新拉取;搜索时页码归 1。
- i18n(`web/src/i18n/zh.js`)增加:搜索占位文案、总数/页码文案。
- 三个视图现在都在 Tab 容器里(/admin/media、/admin/food),状态保留在组件内部即可,不往 URL query 写。

### 3. 排行榜:热门相册并入照片的赞与浏览

`worker/src/routes/public.ts` 相册榜 SQL(现 `score = likes*5 + views`,取前 10)增加一个子查询,模式与日记榜并入留言赞一致:

- `photo_likes` = 相册下所有 `hidden = 0` 照片的 `SUM(likes.count)`(`target_type='photo'`,JOIN photos)
- `photo_views` = 同范围照片的 `SUM(view_counts.count)`(`target_type='photo'`)
- 返回的 `likes` = 相册赞 + photo_likes,`views` = 相册浏览 + photo_views(合计口径,前端 `LeaderboardView.vue` 不需要改,它直接渲染 `a.views`/`a.likes`)
- `score = likes*5 + views` 公式不变,只换口径;`WHERE` 的 `> 0` 过滤也用合计口径
- 隐藏照片(`hidden != 0`)排除,与照片榜口径一致

### 4. 测试与验证

- worker 侧补 Vitest(沿用 `worker/test/` 现有模式):
  - 三个 admin 接口:分页(page/size/total 正确)、搜索(q 过滤)、兼容性(不带参数返回旧结构)
  - `/admin/dishes` 分页时 `want_usernames` 只含当前页
  - 相册榜:照片赞/浏览并入合计、hidden 照片排除、score 排序正确
- 前端无测试框架:`cd web && npm run build` 通过 + 人工手测(翻页、搜索、防抖、切相册页码归零、榜单数字)。

### 5. 明确不做

- 不新增全量照片列表接口;不给 admin 其他页面(留言、账号等)加分页/搜索。
- 公开侧页面不变;日记榜、照片榜口径不变。
- 不做数据库迁移(likes/view_counts/photos 表结构已够用)。
