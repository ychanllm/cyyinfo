# 点赞每日上限 50 次 & 移除长按取消点赞 — 设计

日期：2026-08-26

## 需求

1. 点赞限制从「单用户单目标终身 50 次」改为「每人每天（北京时间）对同一作品最多点赞 50 次」。
2. 移除前端长按取消点赞手势；后端 `/likes/toggle` 接口保留（管理员工具/测试仍可用）。
3. 用户当天点满 50 次后再点，前端弹出「今日已达上限」提示。

## 后端（worker/）

### 迁移

新增迁移 `worker/migrations/0021_like_daily.sql`：

```sql
ALTER TABLE likes ADD COLUMN daily_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE likes ADD COLUMN daily_date TEXT;
```

- `count` 列保持累计总数语义不变（排行榜、总数统计不受影响）。
- `daily_count` / `daily_date` 记录该用户当日已赞次数与对应日期（UTC+8 的 `YYYY-MM-DD`）。

### `worker/src/routes/likes.ts`

- `MAX_PER_USER` 重命名为 `MAX_PER_DAY`（值仍为 50），语义改为每人每天单目标上限。
- 今日日期：`new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)`（北京时间）。
- `POST /likes/burst`：
  - 先 `SELECT count, daily_count, daily_date` 取出该用户该目标的行。
  - `dailyUsed = (row && row.daily_date === today) ? row.daily_count : 0`（跨天自动归零）。
  - `allowed = Math.min(delta, MAX_PER_DAY - dailyUsed)`。
  - 有行则 `UPDATE count = count + allowed, daily_count = dailyUsed + allowed, daily_date = today`；无行则按 `allowed` 插入。
  - 响应：`{ liked: true, count, daily_remaining }`，其中 `daily_remaining = MAX_PER_DAY - (dailyUsed + allowed)`。
- `GET /likes` 与 `GET /likes/batch`：登录用户响应附带 `daily_remaining`；未登录用户不带（前端缺省按 50 处理）。
- `POST /likes/toggle`：不改动（删除整行，连带清除当日计数，属可接受行为）。

### 测试（worker/test/likes.test.ts）

- 「单用户上限 50 钳制」用例改为每日语义，并校验响应含 `daily_remaining: 0`。
- 新增跨天重置用例：burst 满 50 后，直接 SQL 把该行 `daily_date` 改成昨天，再 burst 应能继续加（`daily_remaining` 重新计算，累计 `count` 继续增长）。
- 校验 `GET /likes`、`GET /likes/batch` 对登录用户返回 `daily_remaining`。

## 前端（web/）

### `web/src/components/LikeButton.vue`

- 删除长按相关逻辑：`LONG_PRESS_MS`、`pressTimer`、`longPressed`、`cancelAll`、`busy` 以及 `onPointerDown` / `onPointerUp` / `onPointerCancel`；按钮改为 `@click` 直接触发 `tap`。
- 新增可选 prop `dailyRemaining`（默认 `null`，内部按 50 处理）。
- 乐观更新与 `@update` 载荷携带 `daily_remaining`；flush 后以服务端返回值为准。
- `dailyRemaining === 0` 时再点：不产生增量，弹「今日已达上限」提示（复用现有 `maxTip` 样式）。
- `MAX_TAPS` 会话级钳制保留但仅作兜底（真正上限由服务端裁决）。
- 按钮 `title` 不再引用 `likes.unlikeAll`。

### 视图接入

以下处给 LikeButton 增加 `:daily-remaining` 绑定（数据随 likeState 对象流动，机械改动）：

- `web/src/views/AlbumsView.vue`（album 列表）
- `web/src/views/AlbumDetailView.vue`（album 头部 + photo 网格）
- `web/src/views/DiariesView.vue`（diary 列表）
- `web/src/views/DiaryDetailView.vue`（diary 详情 + 留言弹层两处）
- `web/src/components/Lightbox.vue`（photo 灯箱）
- `web/src/components/MessageBoard.vue`（留言及回复两处）

### i18n

- `likes.max` 文案改为「今日点赞已达上限」语义（项目仅 `web/src/i18n/zh.js` 单语言）。
- 移除 `likes.unlikeAll` 键（前后端均无引用后）。

## 不做的事

- 不删除 `/likes/toggle` 接口及其测试。
- 不改动排行榜/统计的口径（仍按累计 `count`）。
- 不引入按天历史表。
