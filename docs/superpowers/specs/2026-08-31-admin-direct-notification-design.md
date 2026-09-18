# 管理员直发用户提醒 — 设计文档

日期：2026-08-31

## 背景

现有通知系统（`notifications` 表 + `/notifications/unread|read` + 前端铃铛/弹窗）已支持 reply / comment / like / thread / prize 五种类型。其中 `prize` 类型是"纯文本直通"模式：`detail` 存文本、`message_id` 为 NULL、点击不跳转业务页。本功能复用该模式，新增管理员在后台直接向指定注册用户发送提醒的能力。

## 需求

- 管理员在后台用户管理页对某个用户发一条文本提醒
- 用户登录后通过铃铛/弹窗看到"站长消息：……"
- 点击该通知只标记已读，不跳转
- 只支持指定单个用户，不做群发（YAGNI）

## 方案

新增 `message` 通知类型（被拒绝的备选：复用 `prize` 类型，语义混乱且跳转/文案不匹配）。

## 改动清单

### 1. 迁移 `worker/migrations/0025_notification_message_type.sql`

参照 `0023_notifications_expand.sql` 重建表，CHECK 约束 type 增加 `'message'`：

```sql
CREATE TABLE notifications_new (
  ... 同 0023，type CHECK 增加 'message'
);
INSERT INTO notifications_new SELECT * FROM notifications;
DROP TABLE notifications;
ALTER TABLE notifications_new RENAME TO notifications;
CREATE INDEX idx_notifications_unread ON notifications(recipient_type, recipient_id, is_read, id);
```

部署时需 `npm run migrate:apply`（远程 D1）。

### 2. 后端 `POST /admin/notifications`（`worker/src/routes/admin.ts`）

- 挂在 `adminAuth` 之后（`admin.use('/notifications', adminAuth)`）
- body：`{ user_id: number, content: string }`
- 校验：`user_id` 为整数且用户存在（不存在 404"用户不存在"）；`content` trim 后 1–200 字（空/超长 400）
- 插入：

```
recipient_type='user', recipient_id=user_id, type='message',
message_id=NULL, actor_nickname=管理员 display_name 或 username,
target_type='message', target_id=NULL, detail=content
```

- `logAudit('admin_notify', username, '给用户#id发提醒：前30字')`
- 返回 `{ ok: true }`；插入失败返回 500（插入即主逻辑，不静默）

### 3. 前端发送入口 `web/src/views/admin/UsersView.vue`

- 用户列表每行加"发提醒"按钮 → 展开行内小表单（textarea + 发送/取消），参照该页现有内联编辑风格
- 发送中禁用按钮、显示错误；成功后清空并提示

### 4. 前端展示 `web/src/notifications.js`

- `notificationText`：`case 'message'` → `站长消息：${n.detail}`
- `notificationLink`：`target_type === 'message'` → 返回 `null`
- `NotificationBell.vue` / `NotificationPopup.vue` 的 `go(n)`：`notificationLink` 返回 null 时只 `markRead`，不 `router.push`

### 5. i18n

站点锁定中文（无 en.js），`web/src/i18n/zh.js` 的 `adminUsers` 增加 `notify`、`notifyPh`、`notifyRequired`、`notifySend`、`notifySending` 键。

### 6. 测试 `worker/test/admin-notifications.test.ts`

- 管理员发提醒成功，用户 `/notifications/unread` 能看到 `type='message'` 且 detail 直通
- 用户不存在 → 404
- content 为空 / 超 200 字 → 400
- 非管理员 token → 401

## 错误处理

- 前端：发送失败在行内显示 `error`
- 后端：参数校验 400/404；DB 异常 500 并带通用提示

## 验证

- `cd worker && npm test`
- `cd web && npm run build`
- 部署后：后台给用户发提醒 → 该用户登录见铃铛 → 点击已读不跳转
