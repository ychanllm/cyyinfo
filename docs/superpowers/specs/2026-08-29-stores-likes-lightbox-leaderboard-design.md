# 探店点赞 + 想吃图片灯箱 + 排行榜扩展 设计文档

日期：2026-08-29

## 背景与目标

三个小功能，都围绕「想吃」板块：

1. **探店点赞**：探店（stores）卡片接入全站统一的点赞体系（连赞 burst 样式，与相册/日记一致）。
2. **排行榜扩展**：新增「探店榜」（按点赞数）和「点菜榜」（按想吃数）。
3. **图片灯箱**：想吃两个 tab（探店/点菜）的封面图点击放大，复用相册的 Lightbox 组件。

### 已确认的需求决策

- 点赞只加探店（点菜已有"想吃"按钮，用户视为已有互动）。
- 排行榜口径：探店按点赞数（score = 赞×5，与现有口径一致，不新增浏览量统计）；点菜按 `dish_wants` 想吃数。
- 方案 A：likes 表重建扩展 `store` 类型，复用 LikeButton / Lightbox 组件。

## 一、数据层（迁移 `0024_likes_store.sql`）

SQLite 不能改 CHECK，照搬 0011 的重建模式（保留 0013/0021 加的列与 0018 的索引）：

```sql
CREATE TABLE likes_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('album','photo','diary','message','store')),
  target_id INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  daily_count INTEGER NOT NULL DEFAULT 0,
  daily_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, target_type, target_id)
);
INSERT INTO likes_new SELECT id, user_id, target_type, target_id, count, daily_count, daily_date, created_at FROM likes;
DROP TABLE likes;
ALTER TABLE likes_new RENAME TO likes;
CREATE INDEX IF NOT EXISTS idx_likes_target ON likes(target_type, target_id);
```

（实际列以 0009+0011+0013+0021 演进后的现状为准，迁移前用 `.schema likes` 核对。）

## 二、后端

### 点赞支持 store（`worker/src/routes/likes.ts`）

- `TARGET_TYPES` 加 `'store'`（parseTarget 与 /batch 自动支持）。
- `notifyLike` 加 store 分支：店存在（`SELECT id FROM stores WHERE id = ?`）才通知；接收人 = 站长（admin_users 首行）；`detail = '店铺'`；jump = `store/{id}`；站长本人操作跳过（`liker.role === 'admin'` 时不发，与相册/照片一致）。去重沿用现有（含接收人维度）。
- 浏览量不加（VIEW_TARGET_TYPES 不动）。

### 排行榜（`worker/src/routes/public.ts` GET /leaderboard）

返回体加两个数组：

- `stores`：`SELECT s.id, s.name, COALESCE(l.likes,0) AS likes, COALESCE(l.likes,0)*5 AS score FROM stores s LEFT JOIN (likes where target_type='store' GROUP BY target_id) l ON l.target_id = s.id WHERE s.is_active = 1 AND likes > 0 ORDER BY score DESC, s.id ASC LIMIT 10`。
- `dishes`：`SELECT d.id, d.name, COUNT(w.id) AS wants FROM dishes d JOIN dish_wants w ON w.dish_id = d.id GROUP BY d.id ORDER BY wants DESC, d.id ASC LIMIT 10`（dishes 表字段以 0015 为准，若有 is_active/隐藏类字段则过滤）。

## 三、前端（web/）

### 探店卡片点赞（`web/src/views/StoresView.vue`）

- 卡片加 `LikeButton`（`target-type="store"`、`:target-id="s.id"`），本地 `likeStates` map + `@update` 整体替换（沿用 MessageBoard/AlbumDetailView 模式）。
- 挂载拉列表后调 `api('/likes/batch?target_type=store&ids=' + ids)` 初始化（ids ≤100 注意，现无分页，量小）。
- 样式位置与卡片现有布局协调（封面图旁或标题行右侧，参照相册卡片做法）。

### 灯箱（StoresView.vue + DishesView.vue）

- 封面 `<img>` 加 `@click` 打开：`lightboxIndex = ref(null)`，点击时 `lightboxIndex = 0`，模板加 `<Lightbox :photos="lightboxPhotos" v-model:index="lightboxIndex" />`，`lightboxPhotos` 为当前卡片单图 `[{ filename: s.image }]`（无 id → Lightbox 自动隐藏点赞、单图无箭头）。
- 仅有点图时才可点（`v-if="s.image"` 已有）；图片加 `cursor: zoom-in`。

### 排行榜（`web/src/views/LeaderboardView.vue`）

- 加「探店」「点菜」两个榜单区块，沿用现有榜单样式；点击条目跳转 `/food?tab=stores` / `/food?tab=dishes`。

### 通知跳转（`web/src/notifications.js`）

- `notificationLink` 加：`target_type === 'store'` → `/food?tab=stores`。
- `notificationText` 的 like 文案 `赞了你的{detail}` 自动兼容（detail='店铺'）。

## 四、错误处理

- 点赞/灯箱均为纯增量，无破坏性路径；通知失败不阻断点赞（既有 try/catch）。
- 排行榜新榜为空时返回空数组，前端不显示该区块或显示占位（沿用现有榜的空态处理）。

## 五、测试（worker/test/）

- likes：`target_type='store'` toggle/burst 成功；非法类型仍 400；赞店铺 → 站长收到 like 通知（detail='店铺'）；当日去重（含接收人维度）仍生效；迁移后旧点赞数据完好（抽查 count/daily 字段）。
- 排行榜：stores 榜按赞数排序、无赞店不进榜；dishes 榜按想吃数排序。
- 前端无测试设施，`cd web && npm run build` 验证。
