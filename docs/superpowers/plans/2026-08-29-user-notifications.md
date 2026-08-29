# 用户级消息提醒 + 后台日记移动端上传修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 评论互动产生用户级通知（回复评论→通知原作者，日记被评论→通知站长），小站右上角小红点 + 进入弹窗提示；同时修复后台日记移动端无法上传 HEIC 照片的问题。

**Architecture:** D1 新增 `notifications` 表 + `messages.user_id` 列；Worker 在 `POST /api/messages` 里可选解析用户 JWT 绑定评论身份并生成通知；新增 `/api/notifications/unread|read` 路由（user/admin 双角色鉴权）；前端新增模块级共享状态 `notifications.js` + `NotificationBell.vue`（红点+下拉）+ `NotificationPopup.vue`（进入弹窗）。上传修复只改 `worker/src/upload.ts` 的 MIME 白名单与扩展名回退。

**Tech Stack:** Hono + Cloudflare Worker + D1（worker/），Vue 3 无 pinia 模块级 ref（web/），Vitest + @cloudflare/vitest-pool-workers（worker/test/）。

**Spec:** `docs/superpowers/specs/2026-08-29-user-notifications-design.md`

## Global Constraints

- 两空格缩进，保留现有分号/注释风格；Worker 路由文件 camelCase；Vue 组件 PascalCase。
- 不新增任何依赖（jose / hono / vue 均已存在）。
- 站点锁定中文（`api.js` 对 GET 自动追加 `?lang=zh`，`router.js` 锁定 `zh-CN`）：新前端文案直接写中文，不加 i18n key。
- 迁移只追加不改旧文件：新文件为 `worker/migrations/0022_notifications.sql`。
- 测试串行共享 D1/R2：每个测试用独立 target_id / 独立 IP（留言限流 10 条/小时/IP），断言用增量或唯一标记，不依赖绝对总数。
- 通知生成失败不得阻断评论创建（try/catch 吞掉，仅评论主流程返回 201/202）。
- Conventional Commits：`feat:` / `fix:` 前缀。
- 仓库根目录 `D:\vibeProject\kimiProject\cyyinfo`，Worker 命令在 `worker/` 下执行，前端命令在 `web/` 下执行。

---

### Task 1: D1 迁移 0022_notifications.sql

**Files:**
- Create: `worker/migrations/0022_notifications.sql`

**Interfaces:**
- Produces: `messages.user_id INTEGER NULL`；`notifications(id, recipient_type, recipient_id, type, message_id, actor_nickname, target_type, target_id, is_read, created_at)`；Task 3/4 依赖这些表结构。

- [ ] **Step 1: 写迁移文件**

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

- [ ] **Step 2: 本地应用迁移并验证测试环境可加载**

Run: `cd worker && npm run migrate:local && npm test -- --run test/messages.test.ts`
Expected: 迁移无报错；messages 测试 PASS（旧表结构兼容，只是多了列）。

- [ ] **Step 3: Commit**

```bash
git add worker/migrations/0022_notifications.sql
git commit -m "feat: add notifications table and messages.user_id"
```

---

### Task 2: 修复 upload.ts 移动端 HEIC / 空 MIME 上传

**Files:**
- Modify: `worker/src/upload.ts`
- Test: `worker/test/upload-image-types.test.ts`（新建）

**Interfaces:**
- Consumes: 现有 `POST /api/admin/diaries/:id/images`（`worker/src/routes/admin.ts:492`）。
- Produces: `saveUpload()` 接受 `image/heic`/`image/heif`；`file.type` 为空或不在白名单时按文件名扩展名（jpg/jpeg/png/webp/gif/heic/heif）回退。

- [ ] **Step 1: 写失败测试 `worker/test/upload-image-types.test.ts`**

```ts
import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations, adminToken } from './helpers';

let authH: Record<string, string>;
let diaryId: number;
const keys: string[] = [];

beforeAll(async () => {
  await applyMigrations();
  authH = { Authorization: `Bearer ${await adminToken()}` };
  const create = await SELF.fetch('http://x/api/admin/diaries', {
    method: 'POST',
    headers: { ...authH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '上传类型测试' }),
  });
  diaryId = ((await create.json()) as any).id;
});

const upload = (file: File) => {
  const form = new FormData();
  form.append('file', file);
  return SELF.fetch(`http://x/api/admin/diaries/${diaryId}/images`, {
    method: 'POST', headers: authH, body: form,
  });
};

describe('移动端图片类型', () => {
  it('image/heic 通过，url 以 .heic 结尾', async () => {
    const res = await upload(new File([new Uint8Array([0, 0, 0, 24])], 'IMG_1.heic', { type: 'image/heic' }));
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as any;
    expect(url).toMatch(/^\/uploads\/diary\/.+\.heic$/);
    keys.push(url.replace('/uploads/', ''));
  });

  it('空 MIME + .jpg 扩展名按文件名回退通过', async () => {
    const res = await upload(new File([new Uint8Array([0xff, 0xd8])], 'photo.jpg', { type: '' }));
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as any;
    expect(url).toMatch(/\.jpg$/);
    keys.push(url.replace('/uploads/', ''));
  });

  it('空 MIME + 非法扩展名仍 400', async () => {
    const res = await upload(new File(['hello'], 'notes.txt', { type: '' }));
    expect(res.status).toBe(400);
  });

  it('清理上传文件', async () => {
    for (const k of keys) await env.UPLOADS.delete(k);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd worker && npm test -- --run test/upload-image-types.test.ts`
Expected: 前两个用例 FAIL（400 不支持的文件类型），第三个 PASS。

- [ ] **Step 3: 修改 `worker/src/upload.ts`**

完整替换为：

```ts
import type { Env } from './types';

const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'image/heic': '.heic', 'image/heif': '.heif',
};
// 部分手机浏览器/文件选择器不上报 MIME（或上报非标类型）时，按文件名扩展名回退判断
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif']);
const AUDIO_TYPES: Record<string, string> = {
  'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a',
};
const MAX_IMAGE = 10 * 1024 * 1024;   // 10MB
const MAX_AUDIO = 30 * 1024 * 1024;   // 30MB

export async function saveUpload(
  env: Env, file: File, kind: 'image' | 'audio', prefix: string,
): Promise<{ key?: string; error?: string }> {
  const table = kind === 'image' ? IMAGE_TYPES : AUDIO_TYPES;
  let ext = table[file.type];
  if (!ext && kind === 'image') {
    const name = (file.name || '').toLowerCase();
    const byName = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
    if (IMAGE_EXTS.has(byName)) ext = byName === '.jpeg' ? '.jpg' : byName;
  }
  if (!ext) return { error: '不支持的文件类型' };
  if (file.size > (kind === 'image' ? MAX_IMAGE : MAX_AUDIO)) return { error: '文件过大' };
  const key = `${prefix}/${crypto.randomUUID()}${ext}`;
  await env.UPLOADS.put(key, await file.arrayBuffer(),
    file.type ? { httpMetadata: { contentType: file.type } } : undefined);
  return { key };
}
```

注意：该文件原有行尾含 `\r`，用 Edit 工具按行替换或整体重写均可，保持最终内容如上。

- [ ] **Step 4: 跑测试确认通过 + 全量回归**

Run: `cd worker && npm test -- --run test/upload-image-types.test.ts test/diaries.test.ts test/avatar.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add worker/src/upload.ts worker/test/upload-image-types.test.ts
git commit -m "fix: accept HEIC and extension fallback for mobile photo uploads"
```

---

### Task 3: POST /api/messages 绑定用户身份并生成通知

**Files:**
- Modify: `worker/src/routes/public.ts`（imports 区 + POST /messages 处理器，现位于 :195-231）
- Test: `worker/test/notifications.test.ts`（新建；本任务先写"通知生成"部分，Task 4 继续加 unread/read 断言部分）

**Interfaces:**
- Consumes: Task 1 的 `messages.user_id` 与 `notifications` 表；`verifyJwt`（`worker/src/auth.ts:16`）。
- Produces: 评论行带 `user_id`（登录用户）/NULL（游客）；回复登录用户的评论 → `notifications` 插 `('user', 父评论user_id, 'reply', ...)`；日记顶级评论 → 插 `('admin', 日记author_id, 'comment', ...)`。Task 4 的路由读这张表。

- [ ] **Step 1: 写失败测试 `worker/test/notifications.test.ts`（通知生成部分）**

```ts
import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations, adminToken, registerUser } from './helpers';

let admin: string;
let alice: { id: number; token: string };
let bob: { id: number; token: string };
let diaryId: number;
// 每个测试用独立 IP，避免共享留言限流桶（10 条/小时/IP，且 400 也计数）
let ipSeq = 0;
const nextIp = () => `10.12.${++ipSeq}.1`;

beforeAll(async () => {
  await applyMigrations();
  admin = await adminToken();
  alice = await registerUser('notif_alice');
  bob = await registerUser('notif_bob');
  const create = await SELF.fetch('http://x/api/admin/diaries', {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '通知测试日记' }),
  });
  diaryId = ((await create.json()) as any).id;
});

const postMsg = (body: Record<string, unknown>, token?: string) =>
  SELF.fetch('http://x/api/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': nextIp(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

const notifCount = (rtype: string, rid: number) =>
  env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE recipient_type = ? AND recipient_id = ?')
    .bind(rtype, rid).first<{ n: number }>().then((r) => r?.n ?? 0);

describe('通知生成', () => {
  it('登录用户评论日记 → 评论带 user_id，站长收到 comment 通知', async () => {
    const before = await notifCount('admin', 1);
    const res = await postMsg(
      { nickname: '爱丽丝', content: '通知-顶级', target_type: 'diary', target_id: diaryId },
      alice.token,
    );
    expect(res.status).toBe(201);
    const msg = await env.DB.prepare(
      "SELECT user_id FROM messages WHERE content = '通知-顶级'"
    ).first<{ user_id: number | null }>();
    expect(msg?.user_id).toBe(alice.id);
    expect(await notifCount('admin', 1)).toBe(before + 1);
    const n = await env.DB.prepare(
      "SELECT type, actor_nickname, target_type, target_id, is_read FROM notifications WHERE recipient_type = 'admin' AND recipient_id = 1 ORDER BY id DESC"
    ).first<any>();
    expect(n).toMatchObject({ type: 'comment', actor_nickname: '爱丽丝', target_type: 'diary', target_id: diaryId, is_read: 0 });
  });

  it('游客评论日记 → user_id 为 NULL，站长仍收到通知', async () => {
    const before = await notifCount('admin', 1);
    const res = await postMsg({ nickname: '路人', content: '通知-游客', target_type: 'diary', target_id: diaryId });
    expect(res.status).toBe(201);
    const msg = await env.DB.prepare(
      "SELECT user_id FROM messages WHERE content = '通知-游客'"
    ).first<{ user_id: number | null }>();
    expect(msg?.user_id).toBeNull();
    expect(await notifCount('admin', 1)).toBe(before + 1);
  });

  it('回复登录用户的评论 → 原作者收到 reply 通知；自己回复自己不通知', async () => {
    const base = await notifCount('user', alice.id);
    // alice 的顶级评论（同时也会通知站长，这里不关心）
    await postMsg({ nickname: '爱丽丝', content: '通知-待回复', target_type: 'diary', target_id: diaryId }, alice.token);
    const top = await env.DB.prepare(
      "SELECT id FROM messages WHERE content = '通知-待回复'"
    ).first<{ id: number }>();
    // bob 回复 alice → alice +1
    const r1 = await postMsg(
      { nickname: '鲍勃', content: '通知-回复', target_type: 'diary', target_id: diaryId, parent_id: top!.id },
      bob.token,
    );
    expect(r1.status).toBe(201);
    expect(await notifCount('user', alice.id)).toBe(base + 1);
    // alice 自己回复自己 → 不新增
    const r2 = await postMsg(
      { nickname: '爱丽丝', content: '通知-自回', target_type: 'diary', target_id: diaryId, parent_id: top!.id },
      alice.token,
    );
    expect(r2.status).toBe(201);
    expect(await notifCount('user', alice.id)).toBe(base + 1);
  });

  it('游客评论被回复 → 不产生任何通知', async () => {
    await postMsg({ nickname: '路人甲', content: '通知-游客楼', target_type: 'diary', target_id: diaryId });
    const top = await env.DB.prepare(
      "SELECT id FROM messages WHERE content = '通知-游客楼'"
    ).first<{ id: number }>();
    const beforeAll = await env.DB.prepare('SELECT COUNT(*) AS n FROM notifications').first<{ n: number }>();
    await postMsg(
      { nickname: '鲍勃', content: '通知-回游客', target_type: 'diary', target_id: diaryId, parent_id: top!.id },
      bob.token,
    );
    const afterAll = await env.DB.prepare('SELECT COUNT(*) AS n FROM notifications').first<{ n: number }>();
    expect(afterAll?.n).toBe(beforeAll?.n);
  });

  it('站长自己评论自己的日记 → 不给自己发通知', async () => {
    const before = await notifCount('admin', 1);
    const res = await postMsg(
      { nickname: '站长', content: '通知-自评', target_type: 'diary', target_id: diaryId },
      admin,
    );
    expect(res.status).toBe(201);
    expect(await notifCount('admin', 1)).toBe(before);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd worker && npm test -- --run test/notifications.test.ts`
Expected: FAIL（`notifications` 表存在但无行插入，计数不变；`user_id` 为 NULL）。

- [ ] **Step 3: 修改 `worker/src/routes/public.ts`**

3a. imports 区（现 :4）把 `import { signJwt } from '../auth';` 改为：

```ts
import { signJwt, verifyJwt } from '../auth';
```

3b. 在 `pub.post('/messages', ...)` 处理器之前（文件任意顶层位置，建议紧跟 `localized` 函数后）新增辅助函数：

```ts
// 从可选的 Authorization 解析 JWT payload（无 token / 无效 token 视为游客，不影响评论）
async function optionalPayload(c: { req: { header: (k: string) => string | undefined }; env: Env }) {
  const header = c.req.header('Authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '');
  return token ? verifyJwt(c.env, token) : null;
}
```

3c. POST /messages 处理器内三处改动（现 :204-230）：

父评论查询（现 :208-210）加取 `user_id`：

```ts
    const parent = await c.env.DB.prepare(
      'SELECT id, target_type, target_id, parent_id, user_id FROM messages WHERE id = ?'
    ).bind(parent_id).first<{ id: number; target_type: string; target_id: number | null; parent_id: number | null; user_id: number | null }>();
```

INSERT 与通知生成（替换现 :222-227 的 approved 计算 + INSERT + logAudit 段，保留其后 return）：

```ts
  // 日记评论免审核直接发布；site/photo 保持待审核
  const approved = target_type === 'diary' ? 1 : 0;
  // 登录用户发的评论记录 user_id（游客为 NULL）；payload 同时用于排除站长自评
  const payload = await optionalPayload(c);
  const userId = payload?.role === 'user' ? Number(payload.sub) : null;
  const inserted = await c.env.DB.prepare(
    'INSERT INTO messages (nickname, content, target_type, target_id, quote_text, parent_id, is_approved, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id'
  ).bind(nickname.trim(), text.trim(), target_type, target_id, quote, parentId, approved, userId)
    .first<{ id: number }>();
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
    }
  } catch { /* 通知失败不影响评论 */ }
  const targetLabel = target_id ? `${target_type}#${target_id}` : target_type;
  await logAudit(c.env.DB, 'message_post', nickname.trim(), `在 ${targetLabel} 留言：${text.trim().slice(0, 30)}`);
```

注意：`parent` 变量声明在 `if (parent_id ...)` 块内，3c 的通知代码引用了它——需要把 `let parentId` 那一行（现 :205）扩展为同时声明 parent：

```ts
  let parentId: number | null = null;
  let parent: { id: number; target_type: string; target_id: number | null; parent_id: number | null; user_id: number | null } | null = null;
  if (parent_id !== null && parent_id !== undefined) {
    if (!Number.isInteger(parent_id) || parent_id <= 0) return c.json({ detail: '非法的父评论' }, 400);
    parent = await c.env.DB.prepare(
      'SELECT id, target_type, target_id, parent_id, user_id FROM messages WHERE id = ?'
    ).bind(parent_id).first<{ id: number; target_type: string; target_id: number | null; parent_id: number | null; user_id: number | null }>();
    if (!parent) return c.json({ detail: '父评论不存在' }, 400);
    const sameTarget = parent.target_type === target_type
      && (parent.target_id ?? null) === (target_id ?? null);
    if (!sameTarget) return c.json({ detail: '回复目标与父评论不一致' }, 400);
    parentId = parent.parent_id ?? parent.id;
  }
```

通知代码里的 `parent!.user_id` 即引用此变量（`parentId` 非空时 `parent` 必非空）。

- [ ] **Step 4: 跑测试确认通过 + 评论回归**

Run: `cd worker && npm test -- --run test/notifications.test.ts test/comment-replies.test.ts test/messages.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/public.ts worker/test/notifications.test.ts
git commit -m "feat: bind comment authors and generate reply/comment notifications"
```

---

### Task 4: /api/notifications 路由（unread 查询 + 已读标记）

**Files:**
- Create: `worker/src/routes/notifications.ts`
- Modify: `worker/src/types.ts`（Variables 加 `recipient`）
- Modify: `worker/src/index.ts`（挂载路由）
- Test: `worker/test/notifications.test.ts`（追加 describe）

**Interfaces:**
- Consumes: Task 1 的 `notifications` 表；Task 3 产生的数据；`verifyJwt`（`worker/src/auth.ts:16`）。
- Produces: `GET /api/notifications/unread` → `{ count: number, items: [{ id, type, actor_nickname, target_type, target_id, created_at, excerpt }] }`；`POST /api/notifications/read` body `{ ids?: number[] }` → `{ ok: true }`。前端 Task 5 依赖这两个端点。

- [ ] **Step 1: 追加失败测试到 `worker/test/notifications.test.ts`**

```ts
const getUnread = (token: string) =>
  SELF.fetch('http://x/api/notifications/unread', { headers: { Authorization: `Bearer ${token}` } });

const markRead = (token: string, body: Record<string, unknown> = {}) =>
  SELF.fetch('http://x/api/notifications/read', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('通知查询与已读', () => {
  it('无 token → 401', async () => {
    expect((await SELF.fetch('http://x/api/notifications/unread')).status).toBe(401);
    expect((await markRead('')).status).toBe(401);
  });

  it('站长 unread 返回 count 与 items（含 excerpt）', async () => {
    // Task 3 的用例已给 admin#1 生成过未读通知
    const res = await getUnread(admin);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.count).toBeGreaterThan(0);
    expect(data.items[0]).toHaveProperty('actor_nickname');
    expect(data.items[0]).toHaveProperty('excerpt');
    expect(data.items[0]).toHaveProperty('target_type');
  });

  it('标记单条已读，count 减少；不能标记他人通知', async () => {
    const before = ((await (await getUnread(admin)).json()) as any).count;
    const adminItem = ((await (await getUnread(admin)).json()) as any).items[0];
    // alice 尝试标记站长的通知 → 无效
    await markRead(alice.token, { ids: [adminItem.id] });
    expect(((await (await getUnread(admin)).json()) as any).count).toBe(before);
    // 站长标记自己这条
    const res = await markRead(admin, { ids: [adminItem.id] });
    expect(res.status).toBe(200);
    expect(((await (await getUnread(admin)).json()) as any).count).toBe(before - 1);
  });

  it('不传 ids 标记全部已读', async () => {
    await markRead(admin);
    expect(((await (await getUnread(admin)).json()) as any).count).toBe(0);
    // 同理清掉 alice 的，避免影响后续全量测试的其他文件断言
    await markRead(alice.token);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd worker && npm test -- --run test/notifications.test.ts`
Expected: 新 describe 的用例 FAIL（404，路由不存在）。

- [ ] **Step 3: 新建 `worker/src/routes/notifications.ts`**

```ts
import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import type { AppEnv } from '../types';
import { verifyJwt } from '../auth';

const notifications = new Hono<AppEnv>();

// 通知鉴权：注册用户或站长本人；auth_version 校验与 userAuth/adminAuth 一致
async function recipientAuth(c: Context<AppEnv>, next: Next) {
  const header = c.req.header('Authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '');
  const payload = token ? await verifyJwt(c.env, token) : null;
  if (!payload || (payload.role !== 'user' && payload.role !== 'admin')) {
    return c.json({ detail: '请先登录' }, 401);
  }
  const id = Number(payload.sub);
  const table = payload.role === 'user' ? 'users' : 'admin_users';
  const account = await c.env.DB.prepare(`SELECT id, username, auth_version FROM ${table} WHERE id = ?`)
    .bind(id).first<{ id: number; username: string; auth_version: number }>();
  if (!account || (payload.auth_version !== account.auth_version
    && !(payload.auth_version === undefined && account.auth_version === 0))) {
    return c.json({ detail: 'Session expired' }, 401);
  }
  c.set('recipient', { type: payload.role as 'user' | 'admin', id: account.id });
  await next();
}

// 未读通知：count + 最近 20 条摘要（excerpt 为被回复/被评论内容的截断）
notifications.get('/notifications/unread', recipientAuth, async (c) => {
  const r = c.get('recipient');
  const db = c.env.DB;
  const { results } = await db.prepare(
    `SELECT n.id, n.type, n.actor_nickname, n.target_type, n.target_id, n.created_at,
            substr(m.content, 1, 60) AS excerpt
     FROM notifications n JOIN messages m ON m.id = n.message_id
     WHERE n.recipient_type = ? AND n.recipient_id = ? AND n.is_read = 0
     ORDER BY n.id DESC LIMIT 20`
  ).bind(r.type, r.id).all();
  const total = await db.prepare(
    'SELECT COUNT(*) AS n FROM notifications WHERE recipient_type = ? AND recipient_id = ? AND is_read = 0'
  ).bind(r.type, r.id).first<{ n: number }>();
  return c.json({ count: total?.n ?? 0, items: results });
});

// 标记已读：body.ids 为数组时标记指定 id（仅限自己的），否则全部已读
notifications.post('/notifications/read', recipientAuth, async (c) => {
  const r = c.get('recipient');
  const body = await c.req.json<{ ids?: number[] }>().catch((): { ids?: number[] } => ({}));
  const db = c.env.DB;
  if (Array.isArray(body.ids) && body.ids.length) {
    const ids = body.ids.filter((n) => Number.isInteger(n) && n > 0).slice(0, 100);
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',');
      await db.prepare(
        `UPDATE notifications SET is_read = 1 WHERE recipient_type = ? AND recipient_id = ? AND id IN (${placeholders})`
      ).bind(r.type, r.id, ...ids).run();
    }
  } else {
    await db.prepare(
      'UPDATE notifications SET is_read = 1 WHERE recipient_type = ? AND recipient_id = ?'
    ).bind(r.type, r.id).run();
  }
  return c.json({ ok: true });
});

export default notifications;
```

- [ ] **Step 4: 改 `worker/src/types.ts` Variables（:14-18）**

```ts
export interface Variables {
  admin: { id: number; username: string };
  user: { id: number; username: string };
  liker: { id: number; username: string };
  recipient: { type: 'user' | 'admin'; id: number };
}
```

- [ ] **Step 5: 挂载路由 `worker/src/index.ts`**

imports 区加：

```ts
import notificationRoutes from './routes/notifications';
```

`app.route('/api', pointsRoutes);`（:44）之后加一行：

```ts
app.route('/api', notificationRoutes);
```

- [ ] **Step 6: 跑测试确认通过**

Run: `cd worker && npm test -- --run test/notifications.test.ts && npm run typecheck`（若无 typecheck script 则 `npx tsc -p tsconfig.typecheck.json`）
Expected: PASS，类型检查无错误。

- [ ] **Step 7: Commit**

```bash
git add worker/src/routes/notifications.ts worker/src/types.ts worker/src/index.ts worker/test/notifications.test.ts
git commit -m "feat: add notifications unread/read API"
```

---

### Task 5: 前端红点 + 进入弹窗

**Files:**
- Create: `web/src/notifications.js`
- Create: `web/src/components/NotificationBell.vue`
- Create: `web/src/components/NotificationPopup.vue`
- Modify: `web/src/components/NavBar.vue`（.right 区域挂 Bell）
- Modify: `web/src/App.vue`（非管理员模板挂 Popup）

**Interfaces:**
- Consumes: Task 4 的 `GET /api/notifications/unread`、`POST /api/notifications/read`；`api/getUserToken/getAdminToken`（`web/src/api.js`）；`localize`（`web/src/i18n`）。
- Produces: `notifications.js` 导出 `unreadCount`、`unreadItems`、`hasNotificationToken()`、`loadUnread()`、`markRead(ids?)`、`notificationText(n)`。

- [ ] **Step 1: 新建 `web/src/notifications.js`**

```js
import { ref } from 'vue';
import { api, getUserToken, getAdminToken } from './api';

// 未读通知共享状态：NavBar 红点与进入弹窗共用，避免重复请求（沿用 me.js 的模块级 ref 模式）
export const unreadCount = ref(0);
export const unreadItems = ref([]);

// 只有登录用户或站长才有通知；游客不请求（避免 401 分流跳转）
export const hasNotificationToken = () => Boolean(getUserToken() || getAdminToken());

export async function loadUnread() {
  if (!hasNotificationToken()) {
    unreadCount.value = 0;
    unreadItems.value = [];
    return;
  }
  try {
    const data = await api('/notifications/unread');
    unreadCount.value = data.count || 0;
    unreadItems.value = data.items || [];
  } catch {
    unreadCount.value = 0;
    unreadItems.value = [];
  }
}

// ids 不传 = 全部已读；完成后刷新未读状态
export async function markRead(ids) {
  try {
    await api('/notifications/read', { method: 'POST', body: ids ? { ids } : {} });
  } finally {
    await loadUnread();
  }
}

export function notificationText(n) {
  const excerpt = n.excerpt ? `：${n.excerpt}` : '';
  return n.type === 'reply'
    ? `${n.actor_nickname} 回复了你的评论${excerpt}`
    : `${n.actor_nickname} 评论了你的日记${excerpt}`;
}
```

- [ ] **Step 2: 新建 `web/src/components/NotificationBell.vue`**

```vue
<script setup>
import { ref, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { unreadCount, unreadItems, hasNotificationToken, loadUnread, markRead, notificationText } from '../notifications';
import { localize } from '../i18n';

const route = useRoute();
const router = useRouter();
const open = ref(false);

onMounted(() => { if (hasNotificationToken()) loadUnread(); });
// 路由切换时刷新一次（评论后跳回列表等场景红点能及时出现）
watch(() => route.fullPath, () => { if (hasNotificationToken()) loadUnread(); });

async function go(n) {
  open.value = false;
  await markRead([n.id]);
  if (n.target_type === 'diary' && n.target_id) {
    router.push(localize(`/diaries/${n.target_id}`));
  } else {
    router.push(localize('/'));
  }
}

async function readAll() {
  open.value = false;
  await markRead();
}
</script>

<template>
  <div v-if="unreadCount > 0" class="bell">
    <button class="dot" aria-label="有新消息" @click="open = !open"></button>
    <div v-if="open" class="dropdown">
      <div v-for="n in unreadItems" :key="n.id" class="item" @click="go(n)">
        {{ notificationText(n) }}
      </div>
      <button class="read-all" @click="readAll">全部已读</button>
    </div>
  </div>
</template>

<style scoped>
.bell {
  position: relative;
  display: flex;
}
.dot {
  width: 10px;
  height: 10px;
  border: none;
  border-radius: 50%;
  background: #e0483e;
  cursor: pointer;
  padding: 0;
}
.dropdown {
  position: absolute;
  top: 20px;
  right: 0;
  width: 240px;
  max-height: 320px;
  overflow-y: auto;
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
  z-index: 60;
  padding: 6px;
}
.item {
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.5;
  border-radius: 6px;
  cursor: pointer;
  word-break: break-all;
}
.item:hover {
  background: var(--bg-deep);
}
.read-all {
  display: block;
  width: 100%;
  border: none;
  background: none;
  padding: 8px;
  font-size: 13px;
  color: var(--color-primary);
  cursor: pointer;
}
</style>
```

- [ ] **Step 3: 新建 `web/src/components/NotificationPopup.vue`**

```vue
<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { unreadCount, unreadItems, hasNotificationToken, loadUnread, markRead, notificationText } from '../notifications';
import { localize } from '../i18n';

const router = useRouter();
const visible = ref(false);

// 进入小站有未读则弹窗列出摘要；本次会话只弹一次
onMounted(async () => {
  if (!hasNotificationToken()) return;
  if (sessionStorage.getItem('notif_popup_shown')) return;
  await loadUnread();
  if (unreadCount.value > 0) {
    visible.value = true;
    sessionStorage.setItem('notif_popup_shown', '1');
  }
});

function close() {
  visible.value = false;
}

async function go(n) {
  close();
  await markRead([n.id]);
  if (n.target_type === 'diary' && n.target_id) {
    router.push(localize(`/diaries/${n.target_id}`));
  } else {
    router.push(localize('/'));
  }
}
</script>

<template>
  <div v-if="visible" class="modal" @click.self="close">
    <div class="card">
      <h3 class="title">你有 {{ unreadCount }} 条新消息</h3>
      <div class="list">
        <div v-for="n in unreadItems" :key="n.id" class="item" @click="go(n)">
          {{ notificationText(n) }}
        </div>
      </div>
      <button class="ok" @click="close">知道了</button>
    </div>
  </div>
</template>

<style scoped>
.modal {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.card {
  background: #fff;
  border-radius: 14px;
  width: 100%;
  max-width: 340px;
  padding: 18px;
}
.title {
  margin: 0 0 10px;
  font-size: 16px;
}
.list {
  max-height: 280px;
  overflow-y: auto;
}
.item {
  padding: 8px 6px;
  font-size: 14px;
  line-height: 1.5;
  border-bottom: 1px solid var(--color-border);
  cursor: pointer;
  word-break: break-all;
}
.item:last-child {
  border-bottom: none;
}
.ok {
  margin-top: 12px;
  width: 100%;
  border: none;
  border-radius: 999px;
  background: var(--color-primary);
  color: #fff;
  padding: 9px;
  font-size: 14px;
  cursor: pointer;
}
</style>
```

- [ ] **Step 4: NavBar.vue 集成**

script 区 import 加：

```js
import NotificationBell from './NotificationBell.vue';
```

模板 `.right` div（现 :56）内、`<nav class="links">` 之前加：

```html
        <NotificationBell />
```

- [ ] **Step 5: App.vue 集成**

script 区 import 加：

```js
import NotificationPopup from './components/NotificationPopup.vue';
```

非管理员模板内 `<MiniPlayer />`（现 :40）之后加：

```html
    <NotificationPopup />
```

- [ ] **Step 6: 构建验证**

Run: `cd web && npm run build`
Expected: 构建成功无错误。

- [ ] **Step 7: 全量回归 + Commit**

Run: `cd worker && npm test`
Expected: 全部 PASS。

```bash
git add web/src/notifications.js web/src/components/NotificationBell.vue web/src/components/NotificationPopup.vue web/src/components/NavBar.vue web/src/App.vue
git commit -m "feat: notification dot and popup on site"
```

---

## 备注（执行者须知）

- 部署提醒（不在本计划执行范围）：远程生效需 `cd worker && npm run migrate:apply`（远程 D1）+ `npm run deploy`，以及前端 `web` 的 Pages 构建发布。执行前与用户确认。
- `web/functions/api/[[path]].ts` 复用同一 Hono app，无需单独改。
