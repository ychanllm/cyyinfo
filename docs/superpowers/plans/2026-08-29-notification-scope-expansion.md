# 消息提醒范围扩展 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把消息提醒从 2 类事件（reply/comment）扩展到 5 类（+like/thread/prize），覆盖：照片/留言板新评论→站长、点赞→作者（当日同目标去重）、日记讨论串新评论→参与用户、奖品核销/取消→用户。

**Architecture:** 迁移 0023 重建 `notifications` 表（`message_id` 可空、新增 `detail`、type 扩五种）；生成逻辑挂在 `public.ts`（评论）、`likes.ts`（点赞）、`adminPrizes.ts`（核销/取消）三处现有代码；unread 查询改 LEFT JOIN 透出 detail；前端只扩 `notifications.js` 的文案与跳转函数。

**Tech Stack:** Hono + Cloudflare Worker + D1（worker/），Vue 3 模块级 ref（web/），Vitest + @cloudflare/vitest-pool-workers（worker/test/）。

**Spec:** `docs/superpowers/specs/2026-08-29-notification-scope-expansion-design.md`

## Global Constraints

- 两空格缩进，保留现有风格；不新增依赖；Conventional Commits（`feat:`/`fix:`/`test:`）。
- 迁移只追加：新文件 `worker/migrations/0023_notifications_expand.sql`，不改旧迁移。
- 通知生成失败不得阻断主流程（每处生成点 try/catch 吞掉）。
- 测试串行共享 D1/R2：独立 target_id（用 9500+ 号段）、独立 IP 桶（`10.13.N.1`）、增量断言、产生的待审核 site/photo 留言用 admin DELETE 清理（删除已级联清 notifications）。
- 站点锁定中文，前端文案直接写中文；`web/src/App.vue` 等文件含 CRLF 行尾，Edit 时注意。
- 仓库根 `D:\vibeProject\kimiProject\cyyinfo`；Worker 命令在 `worker/`、前端在 `web/` 下执行。
- 点赞去重口径：同一操作者（actor_nickname）对同一接收人（recipient_type + recipient_id）的同一跳转目标当天（北京时间，`date(created_at, '+8 hours')`）只通知一次。

---

### Task 1: 迁移 0023 重建 notifications 表 + unread 查询透出 detail

**Files:**
- Create: `worker/migrations/0023_notifications_expand.sql`
- Modify: `worker/src/routes/notifications.ts:32-37`（unread 查询）
- Test: `worker/test/notifications.test.ts`（追加 describe）

**Interfaces:**
- Consumes: 现有 `notifications` 表（0022）、`GET /api/notifications/unread`。
- Produces: notifications 新结构（`message_id` 可空、`detail TEXT`、type 五种）；unread items 增加 `detail` 字段、`message_id` 为 NULL 的行也能返回。Task 2-4 依赖此结构与查询。

- [ ] **Step 1: 写迁移文件 `worker/migrations/0023_notifications_expand.sql`**

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
INSERT INTO notifications_new
  SELECT id, recipient_type, recipient_id, type, message_id, actor_nickname, target_type, target_id, NULL, is_read, created_at
  FROM notifications;
DROP TABLE notifications;
ALTER TABLE notifications_new RENAME TO notifications;
CREATE INDEX idx_notifications_unread ON notifications(recipient_type, recipient_id, is_read, id);
```

- [ ] **Step 2: 追加失败测试到 `worker/test/notifications.test.ts` 末尾**

文件已有 helper：`admin`（token 字符串）、`alice`、`bob`、`getUnread(token)`、`markRead(token, body?)`、`notifCount(rtype, rid)`。追加：

```ts
describe('通知表扩展（0023）', () => {
  it('message_id 可空 + detail 透出：prize 类通知在 unread 可见且 excerpt 为 null', async () => {
    await env.DB.prepare(
      "INSERT INTO notifications (recipient_type, recipient_id, type, message_id, actor_nickname, target_type, target_id, detail) VALUES ('user', ?, 'prize', NULL, '站长', 'points', NULL, '你兑换的「测试」已被核销')"
    ).bind(alice.id).run();
    const data = (await (await getUnread(alice.token)).json()) as any;
    const item = data.items.find((n: any) => n.type === 'prize');
    expect(item).toBeTruthy();
    expect(item.detail).toBe('你兑换的「测试」已被核销');
    expect(item.excerpt).toBeNull();
    await markRead(alice.token);
  });

  it('旧 reply/comment 数据迁移后完好', async () => {
    // 本文件前面的用例生成的通知行仍在（type 仍在 CHECK 集合内）
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM notifications WHERE type IN ('reply','comment')"
    ).first<{ n: number }>();
    expect(row!.n).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd worker && npm run migrate:local && npm test -- --run test/notifications.test.ts`
Expected: 新 describe 第一个用例 FAIL（`detail` 列不存在 / prize 行 unread 查不出——JOIN 是 INNER 且 message_id NULL）。

- [ ] **Step 4: 改 `worker/src/routes/notifications.ts` unread 查询（:32-37）**

替换 SELECT 语句为：

```ts
  const { results } = await db.prepare(
    `SELECT n.id, n.type, n.actor_nickname, n.target_type, n.target_id, n.detail, n.created_at,
            CASE WHEN n.detail IS NOT NULL THEN NULL
                 WHEN m.is_approved = 1 THEN substr(m.content, 1, 60) END AS excerpt
     FROM notifications n LEFT JOIN messages m ON m.id = n.message_id
     WHERE n.recipient_type = ? AND n.recipient_id = ? AND n.is_read = 0
     ORDER BY n.id DESC LIMIT 20`
  ).bind(r.type, r.id).all();
```

同时把上方注释（:28）改为：`// 未读通知：count + 最近 20 条摘要（detail 类直通 detail；评论类 excerpt 截断且未审核不返回）`

- [ ] **Step 5: 跑测试确认通过**

Run: `cd worker && npm test -- --run test/notifications.test.ts && npm run typecheck`
Expected: PASS（含既有全部用例），typecheck 无错误。

- [ ] **Step 6: Commit**

```bash
git add worker/migrations/0023_notifications_expand.sql worker/src/routes/notifications.ts worker/test/notifications.test.ts
git commit -m "feat: expand notifications schema with detail and nullable message_id"
```

---

### Task 2: 照片/留言板评论通知站长 + 日记讨论串订阅

**Files:**
- Modify: `worker/src/routes/public.ts:240-257`（POST /messages 的通知生成 try 块）
- Test: `worker/test/notifications.test.ts`（追加 describe）

**Interfaces:**
- Consumes: Task 1 的表结构；`optionalPayload`（public.ts 现有）；现有通知 INSERT 模式。
- Produces: photo/site 顶级评论 → admin `comment` 通知（立即，excerpt 由查询层保护）；日记顶级评论 → 参与过的其他登录用户 `thread` 通知。

- [ ] **Step 1: 追加失败测试到 `worker/test/notifications.test.ts` 末尾**

```ts
describe('通知范围：评论类扩展', () => {
  it('photo/site 新评论立即通知站长，未审核 excerpt 为 null', async () => {
    const before = await notifCount('admin', 1);
    const p = await postMsg({ nickname: '拍客', content: '照片真好看', target_type: 'photo', target_id: 9501 });
    expect(p.status).toBe(202);
    const s = await postMsg({ nickname: '过客', content: '留言板报到', target_type: 'site' });
    expect(s.status).toBe(202);
    expect(await notifCount('admin', 1)).toBe(before + 2);

    const data = (await (await getUnread(admin)).json()) as any;
    const photoN = data.items.find((n: any) => n.type === 'comment' && n.target_type === 'photo' && n.actor_nickname === '拍客');
    expect(photoN).toBeTruthy();
    expect(photoN.excerpt).toBeNull(); // 待审核内容不透出

    // 清理待审核留言（admin DELETE 级联清 notifications）
    const authH = { Authorization: `Bearer ${admin}` };
    const pending = await (await SELF.fetch('http://x/api/admin/messages?pending=1', { headers: authH })).json() as any[];
    for (const m of pending.filter((m) => ['照片真好看', '留言板报到'].includes(m.content))) {
      await SELF.fetch(`http://x/api/admin/messages/${m.id}`, { method: 'DELETE', headers: authH });
    }
  });

  it('日记讨论串：参与过的登录用户收到 thread；自己/回复不触发', async () => {
    // 独立日记隔离订阅者
    const create = await SELF.fetch('http://x/api/admin/diaries', {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '串测试日记' }),
    });
    const tid = ((await create.json()) as any).id;

    // alice 参与讨论
    await postMsg({ nickname: '爱丽丝', content: '串- alice 先评', target_type: 'diary', target_id: tid }, alice.token);
    const baseAlice = await notifCount('user', alice.id);
    // bob 顶级评论 → alice 收 thread；bob 自己收不到自己的
    await postMsg({ nickname: '鲍勃', content: '串- bob 新评', target_type: 'diary', target_id: tid }, bob.token);
    expect(await notifCount('user', alice.id)).toBe(baseAlice + 1);
    const thread = await env.DB.prepare(
      "SELECT type, actor_nickname, target_type, target_id FROM notifications WHERE recipient_type = 'user' AND recipient_id = ? AND type = 'thread' ORDER BY id DESC"
    ).bind(alice.id).first<any>();
    expect(thread).toMatchObject({ actor_nickname: '鲍勃', target_type: 'diary', target_id: tid });

    // 回复不触发 thread：alice 回复 bob 的评论 → alice 的 thread 数不变
    const bobTop = await env.DB.prepare("SELECT id FROM messages WHERE content = '串- bob 新评'").first<{ id: number }>();
    const threadBefore = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM notifications WHERE type = 'thread'"
    ).first<{ n: number }>();
    await postMsg({ nickname: '爱丽丝', content: '串- alice 回复', target_type: 'diary', target_id: tid, parent_id: bobTop!.id }, alice.token);
    const threadAfter = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM notifications WHERE type = 'thread'"
    ).first<{ n: number }>();
    expect(threadAfter!.n).toBe(threadBefore!.n);

    // 游客评论不进入订阅（user_id NULL）：游客再评 → alice 仍收 thread（游客是新评论者），但游客自己永远收不到
    const guestBefore = await notifCount('user', alice.id);
    await postMsg({ nickname: '游客丙', content: '串- 游客评', target_type: 'diary', target_id: tid });
    expect(await notifCount('user', alice.id)).toBe(guestBefore + 1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd worker && npm test -- --run test/notifications.test.ts`
Expected: 新 describe FAIL（photo/site 不产生通知、无 thread 类型）。

- [ ] **Step 3: 改 `worker/src/routes/public.ts` 通知生成 try 块（:240-257）**

将 try 块整体替换为：

```ts
  // 生成通知；失败不阻断评论
  try {
    if (parentId && parent!.user_id && parent!.user_id !== userId) {
      // 回复 → 通知父评论作者（仅登录用户发的评论可定位接收人）
      await c.env.DB.prepare(
        'INSERT INTO notifications (recipient_type, recipient_id, type, message_id, actor_nickname, target_type, target_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind('user', parent!.user_id, 'reply', inserted!.id, nickname.trim(), target_type, target_id).run();
    } else if (!parentId && target_type === 'diary' && target_id) {
      // 日记顶级评论 → 通知站长作者；站长自己评论自己除外
      const diary = await c.env.DB.prepare('SELECT author_id FROM diaries WHERE id = ?')
        .bind(target_id).first<{ author_id: number }>();
      const isAuthor = payload?.role === 'admin' && Number(payload.sub) === diary?.author_id;
      if (diary && !isAuthor) {
        await c.env.DB.prepare(
          'INSERT INTO notifications (recipient_type, recipient_id, type, message_id, actor_nickname, target_type, target_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind('admin', diary.author_id, 'comment', inserted!.id, nickname.trim(), 'diary', target_id).run();
      }
      // 讨论串订阅：通知在该日记评论过的其他登录用户（自己的评论不通知自己）
      const { results: subscribers } = await c.env.DB.prepare(
        'SELECT DISTINCT user_id FROM messages WHERE target_type = ? AND target_id = ? AND user_id IS NOT NULL'
      ).bind(target_type, target_id).all<{ user_id: number }>();
      for (const s of subscribers) {
        if (s.user_id === userId) continue;
        await c.env.DB.prepare(
          'INSERT INTO notifications (recipient_type, recipient_id, type, message_id, actor_nickname, target_type, target_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind('user', s.user_id, 'thread', inserted!.id, nickname.trim(), 'diary', target_id).run();
      }
    } else if (!parentId && (target_type === 'photo' || target_type === 'site')) {
      // 照片/留言板新评论（待审核）→ 立即通知全体站长；excerpt 由查询层 is_approved 保护
      const { results: admins } = await c.env.DB.prepare('SELECT id FROM admin_users').all<{ id: number }>();
      for (const a of admins) {
        if (payload?.role === 'admin' && Number(payload.sub) === a.id) continue; // 站长自己留的不通知
        await c.env.DB.prepare(
          'INSERT INTO notifications (recipient_type, recipient_id, type, message_id, actor_nickname, target_type, target_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind('admin', a.id, 'comment', inserted!.id, nickname.trim(), target_type, target_id).run();
      }
    }
  } catch { /* 通知失败不影响评论 */ }
```

- [ ] **Step 4: 跑测试确认通过 + 评论回归**

Run: `cd worker && npm test -- --run test/notifications.test.ts test/comment-replies.test.ts test/messages.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/public.ts worker/test/notifications.test.ts
git commit -m "feat: notify admin on photo/site comments and subscribers on diary threads"
```

---

### Task 3: 点赞通知（toggle / burst）

**Files:**
- Modify: `worker/src/routes/likes.ts`（likerAuth :45-57 扩上下文；新增 notifyLike；toggle :68-89 与 burst :92-136 挂接）
- Modify: `worker/src/types.ts:17`（Variables.liker 扩字段）
- Test: `worker/test/notifications.test.ts`（追加 describe）

**Interfaces:**
- Consumes: Task 1 表结构；`todayCN()`（likes.ts:15）；`resolveLikerId` 既有语义（admin → 归属用户）。
- Produces: like 通知（`detail` 为「日记/相册/照片/评论」）；`liker` context 变为 `{ id, username, role, sub }`。

- [ ] **Step 1: 追加失败测试到 `worker/test/notifications.test.ts` 末尾**

```ts
describe('通知范围：点赞', () => {
  const likeToggle = (token: string, target_type: string, target_id: number) =>
    SELF.fetch('http://x/api/likes/toggle', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_type, target_id }),
    });
  const likeNotifs = (rtype: string, rid: number) =>
    env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'like' AND recipient_type = ? AND recipient_id = ?")
      .bind(rtype, rid).first<{ n: number }>().then((r) => r?.n ?? 0);

  it('首次赞日记通知站长；取消再赞当天不重复；burst 连赞也只一次', async () => {
    const mk = async (title: string) => {
      const res = await SELF.fetch('http://x/api/admin/diaries', {
        method: 'POST',
        headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      return ((await res.json()) as any).id as number;
    };
    const d1 = await mk('点赞通知日记一');
    const d2 = await mk('点赞通知日记二');

    const base = await likeNotifs('admin', 1);
    // toggle 首次赞 → +1
    await likeToggle(alice.token, 'diary', d1);
    expect(await likeNotifs('admin', 1)).toBe(base + 1);
    const n = await env.DB.prepare(
      "SELECT actor_nickname, target_type, target_id, detail FROM notifications WHERE type = 'like' ORDER BY id DESC"
    ).first<any>();
    expect(n).toMatchObject({ actor_nickname: 'notif_alice', target_type: 'diary', target_id: d1, detail: '日记' });

    // 取消再赞 → 当天不重复
    await likeToggle(alice.token, 'diary', d1);
    await likeToggle(alice.token, 'diary', d1);
    expect(await likeNotifs('admin', 1)).toBe(base + 1);

    // burst 首次 → +1；再次 burst → 不重复
    const burst = (id: number, delta: number) =>
      SELF.fetch('http://x/api/likes/burst', {
        method: 'POST',
        headers: { Authorization: `Bearer ${alice.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_type: 'diary', target_id: id, delta }),
      });
    await burst(d2, 3);
    expect(await likeNotifs('admin', 1)).toBe(base + 2);
    await burst(d2, 2);
    expect(await likeNotifs('admin', 1)).toBe(base + 2);

    // 清理点赞
    await likeToggle(alice.token, 'diary', d1);
    await env.DB.prepare("DELETE FROM likes WHERE target_type = 'diary' AND target_id IN (?, ?)").bind(d1, d2).run();
  });

  it('评论被赞通知评论作者；游客评论被赞不通知；自己赞自己不通知', async () => {
    // bob 在独立日记发评论（免审核立即可见）
    const create = await SELF.fetch('http://x/api/admin/diaries', {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '评论点赞日记' }),
    });
    const did = ((await create.json()) as any).id;
    await postMsg({ nickname: '鲍勃', content: '赞我这条', target_type: 'diary', target_id: did }, bob.token);
    await postMsg({ nickname: '路人', content: '游客被赞', target_type: 'diary', target_id: did });
    const list = await (await SELF.fetch(`http://x/api/messages?target_type=diary&target_id=${did}`)).json() as any[];
    const bobMsg = list.find((m) => m.content === '赞我这条');
    const guestMsg = list.find((m) => m.content === '游客被赞');

    const baseBob = await likeNotifs('user', bob.id);
    await likeToggle(alice.token, 'message', bobMsg.id);
    expect(await likeNotifs('user', bob.id)).toBe(baseBob + 1);

    // 游客评论被赞：全表 like 通知数不变
    const allBefore = await env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'like'").first<{ n: number }>();
    await likeToggle(alice.token, 'message', guestMsg.id);
    const allAfter = await env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'like'").first<{ n: number }>();
    expect(allAfter!.n).toBe(allBefore!.n);

    // bob 自己赞自己的评论 → 不通知
    await likeToggle(bob.token, 'message', bobMsg.id);
    expect(await likeNotifs('user', bob.id)).toBe(baseBob + 1);

    // 清理
    await likeToggle(alice.token, 'message', bobMsg.id);
    await likeToggle(alice.token, 'message', guestMsg.id);
    await likeToggle(bob.token, 'message', bobMsg.id);
  });

  it('站长赞自己的日记不通知自己', async () => {
    // 配置管理员点赞归属用户（resolveLikerId 需要）
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('admin_like_user_id', ?)")
      .bind(String(alice.id)).run();
    const base = await likeNotifs('admin', 1);
    const create = await SELF.fetch('http://x/api/admin/diaries', {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '站长自赞日记' }),
    });
    const did = ((await create.json()) as any).id;
    await likeToggle(admin, 'diary', did);
    expect(await likeNotifs('admin', 1)).toBe(base);
    // 清理
    await likeToggle(admin, 'diary', did);
    await env.DB.prepare("DELETE FROM settings WHERE key = 'admin_like_user_id'").run();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd worker && npm test -- --run test/notifications.test.ts`
Expected: 新 describe FAIL（无 like 通知生成）。

- [ ] **Step 3: 改 `worker/src/types.ts` Variables.liker（:17）**

```ts
  liker: { id: number; username: string; role: string; sub: number };
```

- [ ] **Step 4: 改 `worker/src/routes/likes.ts`**

4a. likerAuth 的 `c.set('liker', ...)`（:55）改为：

```ts
  // liker.id 是点赞归属（管理员时为归属用户）；liker.username 是实际操作者（写审计日志用）；
  // role/sub 供通知逻辑识别"站长赞自己的内容"
  c.set('liker', { id: likerId, username: payload.username as string, role: payload.role as string, sub: Number(payload.sub) });
```

4b. 在 `optionalUserId` 函数后新增：

```ts
// 点赞通知：同一操作者对同一跳转目标当天（北京时间）首次点赞才通知；失败不阻断点赞
async function notifyLike(
  c: Context<AppEnv>,
  liker: { id: number; username: string; role: string; sub: number },
  target: { type: string; id: number },
) {
  try {
    const db = c.env.DB;
    let recipient: { type: 'user' | 'admin'; id: number } | null = null;
    let jump: { type: string; id: number | null } = { type: target.type, id: target.id };
    let detail = '';
    if (target.type === 'diary') {
      const d = await db.prepare('SELECT author_id FROM diaries WHERE id = ?')
        .bind(target.id).first<{ author_id: number }>();
      if (!d) return;
      if (liker.role === 'admin' && liker.sub === d.author_id) return; // 站长赞自己日记
      recipient = { type: 'admin', id: d.author_id };
      detail = '日记';
    } else if (target.type === 'album') {
      const a = await db.prepare('SELECT id FROM albums WHERE id = ?').bind(target.id).first();
      const admin = await db.prepare('SELECT id FROM admin_users LIMIT 1').first<{ id: number }>();
      if (!a || !admin) return;
      if (liker.role === 'admin') return; // 站长赞自己相册
      recipient = { type: 'admin', id: admin.id };
      detail = '相册';
    } else if (target.type === 'photo') {
      const p = await db.prepare('SELECT album_id FROM photos WHERE id = ?')
        .bind(target.id).first<{ album_id: number }>();
      const admin = await db.prepare('SELECT id FROM admin_users LIMIT 1').first<{ id: number }>();
      if (!p || !admin) return;
      if (liker.role === 'admin') return; // 站长赞自己照片
      recipient = { type: 'admin', id: admin.id };
      jump = { type: 'album', id: p.album_id }; // 前端跳转到所在相册
      detail = '照片';
    } else if (target.type === 'message') {
      const m = await db.prepare('SELECT user_id, target_type, target_id FROM messages WHERE id = ?')
        .bind(target.id).first<{ user_id: number | null; target_type: string; target_id: number | null }>();
      if (!m?.user_id || m.user_id === liker.id) return; // 游客评论/自己赞自己不通知
      recipient = { type: 'user', id: m.user_id };
      jump = { type: m.target_type, id: m.target_id };
      detail = '评论';
    } else {
      return;
    }
    // 当天（北京时间）同操作者同跳转目标已通知过则跳过
    const dup = await db.prepare(
      `SELECT 1 FROM notifications WHERE type = 'like' AND actor_nickname = ? AND target_type = ? AND target_id IS ?
       AND date(created_at, '+8 hours') = ? LIMIT 1`
    ).bind(liker.username, jump.type, jump.id, todayCN()).first();
    if (dup) return;
    await db.prepare(
      'INSERT INTO notifications (recipient_type, recipient_id, type, message_id, actor_nickname, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(recipient.type, recipient.id, 'like', null, liker.username, jump.type, jump.id, detail).run();
  } catch { /* 通知失败不影响点赞 */ }
}
```

4c. toggle 路由（:79-88 区域）：在 else 分支内、`liked = true;` 之后插入（必须只在点赞成功时触发，取消赞不触发）：

```ts
    await notifyLike(c, me, target);
```

4d. burst 路由（:128-130 区域）：把 `if (applied > 0) {` 块内加一行（logAudit 之后）：

```ts
    await notifyLike(c, me, target);
```

注意 toggle/burst 里 `me` 的类型注解（`as { id: number; username: string }`）要同步扩为 `as { id: number; username: string; role: string; sub: number }`。

- [ ] **Step 5: 跑测试确认通过 + 点赞回归**

Run: `cd worker && npm test -- --run test/notifications.test.ts test/comment-replies.test.ts test/likes.test.ts && npm run typecheck`
Expected: 全部 PASS，typecheck 无错误。

- [ ] **Step 6: Commit**

```bash
git add worker/src/routes/likes.ts worker/src/types.ts worker/test/notifications.test.ts
git commit -m "feat: notify on likes with per-day dedup"
```

---

### Task 4: 奖品核销/取消通知

**Files:**
- Modify: `worker/src/routes/adminPrizes.ts:115-122`（use）、:124-144（cancel）
- Test: `worker/test/notifications.test.ts`（追加 describe）

**Interfaces:**
- Consumes: Task 1 表结构；`prize_records(user_id, prize_id, points_spent, status)`；`prizes(name)`。
- Produces: prize 通知，`detail` 为完整文案（「你兑换的『名』已被核销」/「已取消，积分已退回」），target_type='points'。

- [ ] **Step 1: 追加失败测试到 `worker/test/notifications.test.ts` 末尾**

```ts
describe('通知范围：奖品核销/取消', () => {
  const prizeNotifs = (uid: number) =>
    env.DB.prepare("SELECT detail FROM notifications WHERE type = 'prize' AND recipient_type = 'user' AND recipient_id = ? ORDER BY id")
      .bind(uid).all<{ detail: string }>().then((r) => r.results.map((x) => x.detail));
  const mkRecord = async (uid: number, name: string) => {
    const pid = Number((await env.DB.prepare(
      'INSERT INTO prizes (name, points_cost) VALUES (?, 10)'
    ).bind(name).run()).meta.last_row_id);
    const rid = Number((await env.DB.prepare(
      "INSERT INTO prize_records (user_id, prize_id, source, points_spent) VALUES (?, ?, 'redeem', 10)"
    ).bind(uid, pid).run()).meta.last_row_id);
    return { pid, rid };
  };

  it('站长核销 → 用户收到「已核销」；站长取消 → 「已取消，积分已退回」；用户自核销不通知', async () => {
    const authH = { Authorization: `Bearer ${admin}` };
    const base = (await prizeNotifs(alice.id)).length;

    const r1 = await mkRecord(alice.id, '通知奖品A');
    const use = await SELF.fetch(`http://x/api/admin/prize-records/${r1.rid}/use`, { method: 'POST', headers: authH });
    expect(use.status).toBe(200);

    const r2 = await mkRecord(alice.id, '通知奖品B');
    const cancel = await SELF.fetch(`http://x/api/admin/prize-records/${r2.rid}/cancel`, { method: 'POST', headers: authH });
    expect(cancel.status).toBe(200);

    const r3 = await mkRecord(alice.id, '通知奖品C');
    const selfUse = await SELF.fetch(`http://x/api/my/prizes/${r3.rid}/use`, {
      method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
    });
    expect(selfUse.status).toBe(200);

    const details = await prizeNotifs(alice.id);
    expect(details.length).toBe(base + 2); // 自核销不产生第三条
    expect(details).toContain('你兑换的「通知奖品A」已被核销');
    expect(details).toContain('你兑换的「通知奖品B」已被取消，积分已退回');

    // 清理（prize_records 有 prizes 外键，先删记录）
    await env.DB.prepare('DELETE FROM prize_records WHERE prize_id IN (?, ?, ?)').bind(r1.pid, r2.pid, r3.pid).run();
    await env.DB.prepare('DELETE FROM prizes WHERE id IN (?, ?, ?)').bind(r1.pid, r2.pid, r3.pid).run();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd worker && npm test -- --run test/notifications.test.ts`
Expected: 新用例 FAIL（无 prize 通知）。

- [ ] **Step 3: 改 `worker/src/routes/adminPrizes.ts`**

3a. use 路由（:115-122）：`logAudit` 之后、`return c.json({ ok: true })` 之前插入：

```ts
  // 核销通知；失败不阻断
  try {
    const rec = await c.env.DB.prepare(
      'SELECT r.user_id, p.name FROM prize_records r JOIN prizes p ON p.id = r.prize_id WHERE r.id = ?'
    ).bind(c.req.param('id')).first<{ user_id: number; name: string }>();
    if (rec) {
      await c.env.DB.prepare(
        'INSERT INTO notifications (recipient_type, recipient_id, type, message_id, actor_nickname, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind('user', rec.user_id, 'prize', null,
        (c.get('admin') as { username: string }).username, 'points', null,
        `你兑换的「${rec.name}」已被核销`).run();
    }
  } catch { /* 通知失败不影响核销 */ }
```

3b. cancel 路由（:134-143 区域）：在 `INSERT INTO point_transactions ... 'cancel_refund'` 之后、`logAudit` 之前（或之后均可，保持 return 之前）插入：

```ts
  // 取消退款通知；失败不阻断
  try {
    const prize = await c.env.DB.prepare(
      'SELECT p.name FROM prize_records r JOIN prizes p ON p.id = r.prize_id WHERE r.id = ?'
    ).bind(rec.id).first<{ name: string }>();
    await c.env.DB.prepare(
      'INSERT INTO notifications (recipient_type, recipient_id, type, message_id, actor_nickname, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind('user', rec.user_id, 'prize', null,
      (c.get('admin') as { username: string }).username, 'points', null,
      `你兑换的「${prize?.name ?? '奖品'}」已被取消，积分已退回`).run();
  } catch { /* 通知失败不影响取消 */ }
```

- [ ] **Step 4: 跑测试确认通过 + 奖品回归**

Run: `cd worker && npm test -- --run test/notifications.test.ts test/admin-prizes.test.ts test/box-redeem.test.ts test/my-prizes.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/adminPrizes.ts worker/test/notifications.test.ts
git commit -m "feat: notify user on prize redemption use/cancel"
```

---

### Task 5: 前端文案与跳转扩展

**Files:**
- Modify: `web/src/notifications.js`（notificationText 扩展 + 新增 notificationLink）
- Modify: `web/src/components/NotificationBell.vue`（go 改用 notificationLink）
- Modify: `web/src/components/NotificationPopup.vue`（同）

**Interfaces:**
- Consumes: unread items 新字段 `detail`、type 五种、target_type 扩展值（album/points/photo/site）。
- Produces: `notificationText(n)` 覆盖五种 type；`notificationLink(n): string` 供 Bell/Popup 跳转。

- [ ] **Step 1: 改 `web/src/notifications.js`**

import 区加 localize：

```js
import { localize } from './i18n';
```

`notificationText` 整个替换为：

```js
export function notificationText(n) {
  const excerpt = n.excerpt ? `：${n.excerpt}` : '';
  switch (n.type) {
    case 'reply':
      return `${n.actor_nickname} 回复了你的评论${excerpt}`;
    case 'comment':
      if (n.target_type === 'diary') return `${n.actor_nickname} 评论了你的日记${excerpt}`;
      return `${n.actor_nickname} 在${n.target_type === 'photo' ? '照片' : '留言板'}留了言，待审核`;
    case 'like':
      return `${n.actor_nickname} 赞了你的${n.detail || '内容'}`;
    case 'thread':
      return `${n.actor_nickname} 也评论了你参与的日记${excerpt}`;
    case 'prize':
      return n.detail || '你有一条奖品动态';
    default:
      return '你有一条新消息';
  }
}

// 通知点击的跳转目标
export function notificationLink(n) {
  // 站长的待审核评论通知 → 后台留言审核
  if (n.type === 'comment' && (n.target_type === 'photo' || n.target_type === 'site')) {
    return '/admin/messages';
  }
  if (n.target_type === 'diary' && n.target_id) return localize(`/diaries/${n.target_id}`);
  if (n.target_type === 'album' && n.target_id) return localize(`/albums/${n.target_id}`);
  if (n.target_type === 'points') return localize('/points');
  return localize('/');
}
```

- [ ] **Step 2: 改 `NotificationBell.vue`**

import 行把 `notificationText` 处加 `notificationLink`，并去掉不再用的 `localize` import：

```js
import { unreadCount, unreadItems, hasNotificationToken, loadUnread, markRead, notificationText, notificationLink } from '../notifications';
```

`go` 函数替换为：

```js
async function go(n) {
  open.value = false;
  await markRead([n.id]);
  router.push(notificationLink(n));
}
```

- [ ] **Step 3: 改 `NotificationPopup.vue`**

同 Step 2：import 加 `notificationLink`、去掉 `localize`，`go` 替换为：

```js
async function go(n) {
  close();
  await markRead([n.id]);
  router.push(notificationLink(n));
}
```

- [ ] **Step 4: 构建 + 全量回归**

Run: `cd web && npm run build && cd ../worker && npm test`
Expected: 构建成功；24+ 文件全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add web/src/notifications.js web/src/components/NotificationBell.vue web/src/components/NotificationPopup.vue
git commit -m "feat: render and route expanded notification types"
```

---

## 备注（执行者须知）

- 部署提醒（不在本计划执行范围，执行前与用户确认）：`cd worker && npm run migrate:apply`（0023 会重建表，生产现有通知数据会被拷贝保留）→ `npm run deploy` → web Pages 发布（`npm run build && npx wrangler pages deploy dist --project-name=cyyinfo --branch=main`）。
- 测试文件 `worker/test/notifications.test.ts` 会持续变大；本计划选择追加而非拆分，与仓库现有单文件多功能测试的惯例一致。
