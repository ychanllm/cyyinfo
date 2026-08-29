# 用户级消息提醒 + 后台日记移动端上传修复 设计文档

日期：2026-08-29

## 背景与目标

两个小任务：

1. **用户级消息提醒**：注册用户的评论被回复时收到提醒；站长的日记被评论时站长收到提醒。小站右上角以小红点形式提示（不新增 icon），进入小站有新消息时弹窗列出未读摘要。
2. **Bug 修复**：管理后台日记在移动端编辑时无法上传照片。

### 已确认的需求决策

- 通知接收对象：回复评论 → 通知原评论的登录用户；日记被顶级评论 → 通知站长（admin）。
- 小红点点击 → 下拉列表（不新增页面）。
- 进入小站弹窗 → 每次进入有未读则弹，列出未读摘要，点击可跳转，关闭后本次会话不再自动弹。
- 方案 A：新通知表 + 评论绑定登录用户。

## 一、数据层（D1 迁移 `0022_notifications.sql`）

```sql
ALTER TABLE messages ADD COLUMN user_id INTEGER REFERENCES users(id);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('user','admin')),
  recipient_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('reply','comment')),
  message_id INTEGER NOT NULL REFERENCES messages(id),
  actor_nickname TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id INTEGER,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_notifications_unread
  ON notifications(recipient_type, recipient_id, is_read, id);
```

- `messages.user_id` 为 NULL 表示游客评论（不强制登录）。
- `target_type/target_id` 复制自触发评论本身，用于前端跳转。

## 二、后端（Worker）

### 评论创建挂通知（`worker/src/routes/public.ts` POST /api/messages）

- 仿 `likes.ts` 的 `optionalUserId` 模式：可选解析用户 JWT，登录用户发的评论 INSERT 时带 `user_id`（游客为 NULL，现有行为不变）。
- INSERT 成功后：
  - **回复**（有 parent_id）：查父评论的 `user_id`，存在且不等于当前回复者的 user id → 插一条 `type='reply'` 通知（recipient_type='user'）。游客评论被回复不产生通知（无法定位接收人）。
  - **日记顶级评论**（target_type='diary' 且无 parent_id）：查 `diaries.author_id`，作者不是当前评论者本人 → 插一条 `type='comment'` 通知（recipient_type='admin', recipient_id=author_id）。

### 新路由 `worker/src/routes/notifications.ts`

挂在 `worker/src/index.ts`（`app.route('/api', notificationRoutes)`）。中间件接受 user 或 admin 任一有效 JWT（仿 `likes.ts` 的 likerAuth 思路）：校验后得到 `{ recipient_type, recipient_id }`，两端通用同一实现。

- `GET /api/notifications/unread` → `{ count, items: [...] }`，items 为最近 20 条未读，含 `id, type, actor_nickname, target_type, target_id, is_read, created_at` 及关联评论的 `content` 摘要（JOIN messages 截取）。
- `POST /api/notifications/read` → body `{ ids?: number[] }`；不传 ids 则全部标记已读。只更新属于当前 recipient 的行。

未带有效 user/admin JWT → 401。游客（guest token）不支持通知。

## 三、前端（web/）

### 新组件 `web/src/components/NotificationBell.vue`

- 放进 `NavBar.vue` 右侧 `.right` 区域（用户头像旁），纯 CSS 小红圆点，不新增 icon。
- 仅在 `me`（`web/src/me.js`）或 admin token 存在时显示；有未读才显示红点。
- 点击红点 → 下拉列表展示未读通知摘要（"xx 回复了你的评论：…" / "xx 评论了你的日记"），点击条目跳转 `/diary/:target_id` 并标记该条已读；底部"全部已读"。

### 进入小站弹窗

- `App.vue`（或 NavBar 挂载时）拉一次 `GET /api/notifications/unread`；`count > 0` 且本次会话未弹过（sessionStorage `notif_popup_shown`）→ 弹窗列出未读摘要。
- 弹窗条目点击行为同下拉列表；"知道了"关闭并写 sessionStorage 标记。
- 未登录/游客不请求、不弹窗。

### 状态

沿用模块级 ref 模式（无 pinia）：可在 `NotificationBell.vue` 内自持状态，或新增 `web/src/notifications.js` 模块级 ref 供 App 弹窗与 Bell 共享未读数。选后者，避免重复请求。

## 四、Bug 修复：后台日记移动端无法上传照片

根因（高置信）：`worker/src/upload.ts:3-5` 的 MIME 白名单仅 `image/jpeg|png|webp|gif`。iPhone 拍摄默认 HEIC，且部分手机浏览器/文件选择器返回空 `file.type`，均被 400 "不支持的文件类型" 拒绝。

修复（`worker/src/upload.ts`）：

- 白名单加入 `image/heic`（`.heic`）、`image/heif`（`.heif`）。
- `file.type` 为空或不在白名单时，按文件名扩展名回退判断（jpg/jpeg/png/webp/gif/heic/heif），仍不匹配才报错。

## 五、错误处理

- 通知插入失败不阻断评论创建（try/catch 后仅记日志，评论仍返回 201/202）。
- `GET /api/notifications/unread` 401 时前端静默处理（不跳转登录页，避免游客被弹登录）——前端只在确认有 user/admin token 时才调用。
- 上传仍失败时后端返回具体错误文案（"不支持的文件类型"/"文件过大"），前端 alert 展示（现有行为）。

## 六、测试（worker/test/）

新增 `notifications.test.ts`：

- 注册用户评论日记 → 站长收到 `comment` 通知。
- A 用户评论，B 用户回复 → A 收到 `reply` 通知；自己回复自己不产生通知；游客评论被回复不产生通知。
- `GET /api/notifications/unread` 返回正确 count/items；无 token 401。
- `POST /api/notifications/read` 标记全部/单条已读，且不能标记他人通知。

补充 upload 测试：HEIC MIME 通过、空 MIME + `.jpg` 扩展名通过、非法扩展名拒绝。

运行：`cd worker && npm test`。
