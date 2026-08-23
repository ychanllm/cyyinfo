# 照片隐藏 + 全量操作日志 — 设计

日期：2026-08-23

## 需求 1：照片隐藏

管理后台照片可隐藏：隐藏后前台不再显示，但 R2 文件不删除；后台仍可见并带状态徽标与开关。

- 迁移 `0014_photo_hidden.sql`：`ALTER TABLE photos ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0`。
- 前台过滤 `hidden = 0`：相册详情照片列表、排行榜照片；封面联表加 `AND p.hidden = 0`（隐藏的封面 → 相册无封面，按需求确认）。
- 后台：相册照片列表返回 `hidden`；`PUT /admin/photos/:id` 支持更新 `hidden`。
- 前端 PhotosView：每张照片显示状态徽标（可见/已隐藏）+ 开关切换。

## 需求 2：全量操作日志

`audit_logs` 记录所有用户与管理员操作，在后台「日志 → 数据变动」栏展示。

### 新增埋点

- 用户侧：`user_login`（登录）、`like`/`unlike`/`like_burst`（含次数）、`message_post`（留言，actor=nickname）、`checkin`、`box_draw`、`redeem`、`prize_use`。
- 管理员侧：`admin_login`、`photo_upload`/`photo_delete`/`photo_hide`/`photo_unhide`、`album_create`/`album_update`/`album_delete`、`diary_create`/`diary_update`/`diary_delete`、`music_create`/`music_delete`、`message_review`（通过/删除留言）、`settings_update`、`prize_create`/`prize_update`/`prize_delete`、奖品记录状态变更。

### 接口与展示

- `GET /admin/audit-logs?type=&offset=&limit=50`：支持类型筛选 + offset 分页。
- ChangelogView 数据变动栏：类型下拉筛选 +「加载更多」；新增类型的 i18n 标签（zh/en）。

## 测试

worker vitest：隐藏照片前台过滤（列表/封面/排行榜）、后台仍可见；登录/点赞写日志；audit-logs 筛选与分页。
