# 消息提醒范围扩展 设计文档

日期：2026-08-29

## 背景

通知系统（2026-08-29 上线）当前仅覆盖两类事件：评论被回复 → 通知原作者（user）；日记被评论 → 通知站长（admin）。本次扩大覆盖范围。

### 已确认的需求决策

- 新事件四类：
  1. **照片/留言板新评论 → 站长**：提交立即通知（不等待审核；未审核内容摘要已有 `is_approved` 保护，显示为空）。
  2. **点赞通知**：同一操作者对同一目标当天（北京时间自然日）首次点赞才通知。日记/照片/相册被赞 → 站长；评论被赞 → 评论作者（仅登录用户可定位）。
  3. **日记讨论串订阅**：登录用户在某日记下评论过后，该日记有新顶级评论时通知所有参与过的其他登录用户；回复不触发（仍只走 reply 通知）；自己的评论不通知自己。
  4. **奖品核销/取消退款 → 用户**：站长核销 →「已核销」；站长取消 →「已取消，积分已退回」。用户自己核销（points.ts）不通知；签到/抽奖等用户主动行为不通知。
- 方案 A：扩展现有 notifications 表（单表单 API）。

## 一、数据层（迁移 0023，重建 notifications 表）

SQLite/D1 不支持 ALTER 改列约束，按标准流程：建新表 → 拷贝 → drop 旧表 → rename → 重建索引。

```sql
CREATE TABLE notifications_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('user','admin')),
  recipient_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('reply','comment','like','thread','prize')),
  message_id INTEGER REFERENCES messages(id),
  actor_nickname TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id INTEGER,
  detail TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO notifications_new SELECT id, recipient_type, recipient_id, type, message_id, actor_nickname, target_type, target_id, NULL, is_read, created_at FROM notifications;
DROP TABLE notifications;
ALTER TABLE notifications_new RENAME TO notifications;
CREATE INDEX idx_notifications_unread ON notifications(recipient_type, recipient_id, is_read, id);
```

变化点：`message_id` 可空（like/prize 无关联评论）；`type` 扩展五种；新增 `detail TEXT`（like/prize 的展示文本）。

`target_type/target_id` 语义泛化为**跳转目的地**，生成时解析好：

| 事件 | target_type | target_id |
|---|---|---|
| reply/comment（日记） | diary | 日记 id |
| comment（照片/留言板，给站长） | photo / site | 照片 id / NULL |
| like（日记） | diary | 日记 id |
| like（相册） | album | 相册 id |
| like（照片） | album | **所在相册 id**（查 photos.album_id） |
| like（评论） | 评论所在 target | 评论的 target_id |
| thread | diary | 日记 id |
| prize | points | NULL |

## 二、后端生成点

### 1. 照片/留言板新评论（`worker/src/routes/public.ts` POST /messages）

- 现有日记分支不变；photo/site 顶级评论新增：向每位 `admin_users`（实际即站长一人，取 `SELECT id FROM admin_users LIMIT 1` 或全部）插 `type='comment'` 通知，actor 为评论昵称。
- 立即生成，不等审核；excerpt 保护见第三节。

### 2. 点赞（`worker/src/routes/likes.ts` toggle / burst）

- 触发点：toggle 结果 `liked=true`；burst 实际增量 `applied > 0`。
- 去重：插入前查当天（北京时间）是否已有同 actor + 同目标（解析后的跳转目标）的 like 通知，有则跳过。去重键含接收人（同一人当天对同一接收人的同一目标只通知一次）：

```sql
SELECT 1 FROM notifications
WHERE type = 'like' AND actor_nickname = ? AND target_type = ? AND target_id IS ?
  AND recipient_type = ? AND recipient_id = ?
  AND date(created_at, '+8 hours') = ?
LIMIT 1
```

- 接收人解析：
  - diary/album/photo → 站长（admin_users 全量，一人）。
  - message → 被赞评论的 `user_id`（NULL 则不发）；评论的跳转目标取其 `target_type/target_id`（site 则 target_id NULL）。
  - 自己赞自己（操作者即接收人）不发。
- `actor_nickname` 存点赞者 username（liker.username，管理员为归属用户时可另定，取 payload.username 即可）。
- `detail` 存对象描述，如「日记」「照片」「你的评论」——前端文案拼或用 detail 直接展示（见前端节）。

### 3. 日记讨论串（`worker/src/routes/public.ts` POST /messages）

- 日记顶级评论成功插入后（现有站长通知逻辑之外）：
  - 查该日记下所有 `user_id IS NOT NULL` 的去重用户：`SELECT DISTINCT user_id FROM messages WHERE target_type='diary' AND target_id=? AND user_id IS NOT NULL`。
  - 排除当前评论者本人；对每个用户插 `type='thread'` 通知，actor 为新评论者昵称。
- 回复（有 parent_id）不触发 thread。

### 4. 奖品核销/取消（`worker/src/routes/adminPrizes.ts`）

- 核销成功（:117 附近 UPDATE 生效后）：插 `type='prize'` 通知给该 prize_record 的 user_id，`detail = '你兑换的「' || 奖品名 || '」已被核销'` 由后端拼好存入。actor_nickname 存站长 username。
- 取消成功（:131 附近）：`detail = '你兑换的「奖品名」已被取消，积分已退回'`。
- `points.ts:284` 用户自己核销不生成通知。

### 通用

- 通知生成失败不阻断主流程（沿用 try/catch 惯例；likes 的 toggle/burst 同理）。

## 三、查询层（`worker/src/routes/notifications.ts`）

- unread 查询改 `LEFT JOIN messages`（message_id 可空）：

```sql
SELECT n.id, n.type, n.actor_nickname, n.target_type, n.target_id, n.detail, n.created_at,
       CASE WHEN n.detail IS NOT NULL THEN NULL
            WHEN m.is_approved = 1 THEN substr(m.content, 1, 60) END AS excerpt
FROM notifications n LEFT JOIN messages m ON m.id = n.message_id
WHERE n.recipient_type = ? AND n.recipient_id = ? AND n.is_read = 0
ORDER BY n.id DESC LIMIT 20
```

（detail 类通知前端直接用 detail 文案，excerpt 给 NULL。）

- read 路由不变。

## 四、前端（web/）

- `notifications.js` 的 `notificationText(n)` 扩展：
  - `reply`：`xx 回复了你的评论：excerpt`（不变）
  - `comment`：diary → `xx 评论了你的日记：excerpt`；photo/site → `xx 在照片/留言板留了言，待审核`
  - `like`：`xx 赞了你的{detail}`
  - `thread`：`xx 也评论了你参与的日记：excerpt`
  - `prize`：直接显示 `detail`
- `go(n)` 跳转扩展：diary → `/diaries/:id`；album → `/albums/:id`；points → `/points`；photo/site 的 comment（站长）→ `/admin/messages`；其余 → `/`。
- 红点/弹窗/已读机制不动。

## 五、错误处理

- 所有生成点 try/catch 吞掉通知失败，主流程不受影响。
- like 去重查询失败（catch 内）则不通知，不漏主流程点赞结果。

## 六、测试（worker/test/，追加到 notifications.test.ts 或新 describe）

- photo/site 评论 → 站长立即收到 comment 通知，未审核时 excerpt 为 null。
- 点赞：首次赞日记 → 站长收到 like；当天再赞/连赞不重复；评论被赞 → 评论作者收到，游客评论被赞不发；自己赞自己不发。
- thread：A 评论日记后，B 顶级评论 → A 收到 thread；A 自己再评论不收；回复不触发 thread。
- prize：站长核销 → 用户收到「已核销」；取消 → 「已取消，积分已退回」；用户自己核销不收。
- unread 对 like/prize 通知 detail 直通、excerpt 为 null。
- 原有通知用例全量回归；迁移 0023 后旧数据（reply/comment）完好。
