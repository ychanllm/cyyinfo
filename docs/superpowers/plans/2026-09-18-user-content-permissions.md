# 用户内容上传权限（日记 / 相册）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 管理员可在独立「权限管理」页授予注册用户日记 / 相册上传管理权限；获权用户登录后复用现有后台管理对应内容。

**Architecture:** 新增 `user_permissions` 表 + `contentAuth(permission)` 中间件：管理员令牌直接放行，用户令牌每请求查权限表放行。前端 `/admin` 路由守卫与侧边栏按「管理员令牌 / 用户令牌 + 权限」过滤，权限管理页为独立后台栏目。

**Tech Stack:** Cloudflare Worker + Hono + D1(SQLite) + R2；Vue 3 + Vite + vue-router + vue-i18n；Vitest + @cloudflare/vitest-pool-workers(Miniflare)。

**Spec:** `docs/superpowers/specs/2026-09-18-user-content-permissions-design.md`

## Global Constraints

- 缩进两空格；不引入新依赖；仓库无 formatter/linter。
- Worker 测试串行共享同一 D1/R2：测试数据用唯一用户名/slug，创建的日记/照片用例结尾要清理。
- 注册接口限流 30 次/15 分钟、登录 5 次/15 分钟：测试里管理员 token 一律用 `adminToken()` 缓存助手，用户注册用 `registerUser()`。
- 提交信息用 Conventional Commits（`feat:` / `fix:` / `docs:`），不要提交 `.dev.vars` 等密钥文件。
- 远程迁移（`migrate:apply`）不在本计划内，由用户自行决定执行。
- i18n 只有中文（`web/src/i18n/zh.js`，站点锁定 `lang=zh`），新增文案只改这一个文件。

---

### Task 1: 迁移 0021——user_permissions 表 + diaries 作者归属

**Files:**
- Create: `worker/migrations/0021_user_permissions.sql`

**Interfaces:**
- Produces: 表 `user_permissions(user_id, permission, granted_by, granted_at)`，permission ∈ `'diary' | 'album'`；`diaries.author_id` 变为可空，新增 `diaries.author_user_id`（可空，REFERENCES users(id)）。后续所有任务依赖此结构。

- [ ] **Step 1: 写迁移文件**

创建 `worker/migrations/0021_user_permissions.sql`：

```sql
-- 用户内容权限：管理员可授予注册用户日记/相册上传管理权限
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN ('diary', 'album')),
  granted_by INTEGER REFERENCES admin_users(id),
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, permission)
);

-- diaries 重建：author_id 改可空，新增 author_user_id（获权用户发布的日记归属用户）
-- diary_versions REFERENCES diaries(id)，重建期间延迟外键检查
PRAGMA defer_foreign_keys = ON;
CREATE TABLE diaries_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER REFERENCES admin_users(id),
  author_user_id INTEGER REFERENCES users(id),
  title TEXT NOT NULL,
  slug TEXT UNIQUE,
  content_md TEXT NOT NULL DEFAULT '',
  cover_filename TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  category_id INTEGER,
  title_en TEXT,
  content_md_en TEXT
);
INSERT INTO diaries_new (id, author_id, title, slug, content_md, cover_filename, status, published_at, created_at, updated_at, category_id, title_en, content_md_en)
  SELECT id, author_id, title, slug, content_md, cover_filename, status, published_at, created_at, updated_at, category_id, title_en, content_md_en FROM diaries;
DROP TABLE diaries;
ALTER TABLE diaries_new RENAME TO diaries;
CREATE INDEX IF NOT EXISTS idx_diaries_category ON diaries(category_id);
CREATE INDEX IF NOT EXISTS idx_diaries_public_order ON diaries(status, category_id, published_at DESC, id);
```

- [ ] **Step 2: 跑全量测试确认迁移可应用且不破坏现有行为**

Run: `cd worker && npm test`
Expected: 全部 PASS（`applyMigrations()` 会把 0021 应用到测试 D1；现有日记测试覆盖 author JOIN，管理员创建日记行为不变）

- [ ] **Step 3: 类型检查**

Run: `cd worker && npm run typecheck`
Expected: 无错误（本任务无 TS 改动，仅确认基线干净）

- [ ] **Step 4: Commit**

```bash
git add worker/migrations/0021_user_permissions.sql
git commit -m "feat(worker): add user_permissions table and user diary attribution"
```

---

### Task 2: contentAuth 中间件 + 路由门岗 + 操作人审计

**Files:**
- Modify: `worker/src/auth.ts`（新增 `contentAuth`）
- Modify: `worker/src/routes/admin.ts:49-71`（门岗替换）、`admin.ts` 中 albums/photos/diaries 处理器的 `c.get('admin')` 审计行（约 239、255、265、299、330、340、383、433、443 行）
- Test: `worker/test/permissions.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 的 `user_permissions` 表。
- Produces: `contentAuth(permission: 'diary' | 'album')`（Hono 中间件工厂，导出自 `worker/src/auth.ts`）；`admin.ts` 内私有函数 `actorName(c)` 返回 `管理员用户名` 或 `user:<用户名>`。日记/相册/照片路由对「管理员或对应权限用户」开放，审计操作人对用户记录为 `user:<username>`。

- [ ] **Step 1: 写失败测试**

创建 `worker/test/permissions.test.ts`：

```ts
import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations, adminToken, registerUser } from './helpers';

let admin: string;
beforeAll(async () => { await applyMigrations(); admin = await adminToken(); });
const adminAuth = () => ({ Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' });
const userAuth = (t: string) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });

async function grant(userId: number, permission: 'diary' | 'album') {
  await env.DB.prepare('INSERT OR REPLACE INTO user_permissions (user_id, permission) VALUES (?, ?)')
    .bind(userId, permission).run();
}
async function revokeAll(userId: number) {
  await env.DB.prepare('DELETE FROM user_permissions WHERE user_id = ?').bind(userId).run();
}

describe('内容权限中间件', () => {
  it('无权限用户访问日记/相册后台路由返回 401，管理员不受影响', async () => {
    const u = await registerUser('perm_none');
    const d = await SELF.fetch('http://x/api/admin/diaries', { headers: userAuth(u.token) });
    expect(d.status).toBe(401);
    const a = await SELF.fetch('http://x/api/admin/albums', { headers: userAuth(u.token) });
    expect(a.status).toBe(401);
    const ok = await SELF.fetch('http://x/api/admin/diaries', { headers: adminAuth() });
    expect(ok.status).toBe(200);
  });

  it('diary 权限用户可访问日记与分类路由，但相册与其余后台路由仍 401', async () => {
    const u = await registerUser('perm_diary');
    await grant(u.id, 'diary');
    const d = await SELF.fetch('http://x/api/admin/diaries', { headers: userAuth(u.token) });
    expect(d.status).toBe(200);
    const cats = await SELF.fetch('http://x/api/admin/diary-categories', { headers: userAuth(u.token) });
    expect(cats.status).toBe(200);
    const a = await SELF.fetch('http://x/api/admin/albums', { headers: userAuth(u.token) });
    expect(a.status).toBe(401);
    const users = await SELF.fetch('http://x/api/admin/site-users', { headers: userAuth(u.token) });
    expect(users.status).toBe(401);
    const settings = await SELF.fetch('http://x/api/admin/settings', { headers: userAuth(u.token) });
    expect(settings.status).toBe(401);
  });

  it('album 权限用户可上传照片到相册，撤销后立即 401', async () => {
    const u = await registerUser('perm_album');
    // 管理员建相册
    const alb = await SELF.fetch('http://x/api/admin/albums', {
      method: 'POST', headers: adminAuth(), body: JSON.stringify({ title: '权限测试相册' }),
    });
    const { id: albumId } = await alb.json() as any;

    await grant(u.id, 'album');
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const form = new FormData();
    form.append('file', new File([png], 'p.png', { type: 'image/png' }));
    form.append('album_id', String(albumId));
    const up = await SELF.fetch('http://x/api/admin/photos', {
      method: 'POST', headers: { Authorization: `Bearer ${u.token}` }, body: form,
    });
    expect(up.status).toBe(200);
    const photo = await up.json() as any;

    // 用户操作照片的审计操作人记为 user:<username>
    const logs = await env.DB.prepare(
      "SELECT actor FROM audit_logs WHERE type = 'photo_upload' ORDER BY id DESC LIMIT 1"
    ).first<{ actor: string }>();
    expect(logs?.actor).toBe('user:perm_album');

    // 撤销后立即失效
    await revokeAll(u.id);
    const denied = await SELF.fetch('http://x/api/admin/photos', {
      method: 'POST', headers: { Authorization: `Bearer ${u.token}` }, body: form,
    });
    expect(denied.status).toBe(401);

    // 清理（管理员）
    await SELF.fetch(`http://x/api/admin/photos/${photo.id}`, { method: 'DELETE', headers: adminAuth() });
    await SELF.fetch(`http://x/api/admin/albums/${albumId}`, { method: 'DELETE', headers: adminAuth() });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd worker && npx vitest run test/permissions.test.ts`
Expected: FAIL——用例 2、3 不通过（获权用户仍被现有 `adminAuth` 挡在 401）；用例 1 此时恰好通过属正常

- [ ] **Step 3: 实现 contentAuth**

在 `worker/src/auth.ts` 末尾追加：

```ts
// 内容权限门岗：管理员直接放行；注册用户持有对应授权（user_permissions）也可访问，每请求查库，撤销立即生效
export function contentAuth(permission: 'diary' | 'album') {
  return async (c: Context<AppEnv>, next: Next) => {
    const header = c.req.header('Authorization') ?? '';
    const token = header.replace(/^Bearer\s+/i, '');
    const payload = token ? await verifyJwt(c.env, token) : null;
    if (!payload) return c.json({ detail: '未授权' }, 401);
    if (payload.role === 'admin') {
      const id = Number(payload.sub);
      const account = await c.env.DB.prepare('SELECT id, username, auth_version FROM admin_users WHERE id = ?')
        .bind(id).first<{ id: number; username: string; auth_version: number }>();
      if (!account || (payload.auth_version !== account.auth_version
        && !(payload.auth_version === undefined && account.auth_version === 0))) {
        return c.json({ detail: 'Session expired' }, 401);
      }
      c.set('admin', { id: account.id, username: account.username });
      await next();
      return;
    }
    if (payload.role === 'user') {
      const id = Number(payload.sub);
      const account = await c.env.DB.prepare('SELECT id, username, auth_version FROM users WHERE id = ?')
        .bind(id).first<{ id: number; username: string; auth_version: number }>();
      if (!account || (payload.auth_version !== account.auth_version
        && !(payload.auth_version === undefined && account.auth_version === 0))) {
        return c.json({ detail: 'Session expired' }, 401);
      }
      const perm = await c.env.DB.prepare('SELECT 1 AS ok FROM user_permissions WHERE user_id = ? AND permission = ?')
        .bind(id, permission).first();
      if (!perm) return c.json({ detail: '未授权' }, 401);
      c.set('user', { id: account.id, username: account.username });
      await next();
      return;
    }
    return c.json({ detail: '未授权' }, 401);
  };
}
```

- [ ] **Step 4: 替换 admin.ts 门岗与操作人**

`worker/src/routes/admin.ts`：

1. 第 1 行 import 改为 `import { Hono, type Context } from 'hono';`；第 4 行改为 `import { signJwt, adminAuth, contentAuth } from '../auth';`
2. 在 `const admin = new Hono<AppEnv>();` 之前加：

```ts
// 审计操作人：管理员记用户名；获权用户操作日记/相册时记 user:<用户名>
function actorName(c: Context<AppEnv>): string {
  const a = c.get('admin') as { username: string } | undefined;
  if (a) return a.username;
  const u = c.get('user') as { username: string } | undefined;
  return u ? `user:${u.username}` : 'unknown';
}
```

3. 门岗（49-59 行区域）替换为：

```ts
admin.use('/albums', contentAuth('album'));
admin.use('/albums/*', contentAuth('album'));
admin.use('/photos', contentAuth('album'));
admin.use('/photos/*', contentAuth('album'));
admin.use('/users', adminAuth);
admin.use('/users/*', adminAuth);
admin.use('/diaries', contentAuth('diary'));
admin.use('/diaries/*', contentAuth('diary'));
admin.use('/diary-categories', contentAuth('diary'));
admin.use('/diary-categories/*', contentAuth('diary'));
```

（`/music`、`/messages`、`/settings`、`/site-users`、`/changelogs`、`/audit-logs`、`/stats` 保持 `adminAuth` 不变。）

4. 将以下 `logAudit` 调用中的 `(c.get('admin') as { username: string }).username` 全部替换为 `actorName(c)`（仅日记/相册/照片相关，共 9 处）：
   - `album_create`（约 239 行）、`album_update`（约 255）、`album_delete`（约 265）
   - `photo_upload`（约 299）、`photo_hide/photo_unhide`（约 330）、`photo_delete`（约 340）
   - `diary_create`（约 383）、`diary_update`（约 433）、`diary_delete`（约 443）

   注意：`/users`、`/settings`、`/music`、`/messages` 等仍属 `adminAuth` 路由的处理行（89、102、130、223、573、595、618、624、630 行）**不要改**。

5. `admin.post('/diaries')` 第 364 行 `const adminUser = c.get('admin') as { id: number };` 暂保留（Task 3 处理作者归属）；但本任务后用户令牌已能进入该处理器，先把该行改为：

```ts
  const adminUser = c.get('admin') as { id: number } | undefined;
  const loginUser = c.get('user') as { id: number } | undefined;
```

并将 INSERT 中的 `.bind(adminUser.id, ...)` 改为 `.bind(adminUser?.id ?? null, ...)`（`author_user_id` 列在 Task 3 写入）。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd worker && npx vitest run test/permissions.test.ts`
Expected: 3 个用例 PASS

- [ ] **Step 6: 跑全量测试 + 类型检查**

Run: `cd worker && npm test && npm run typecheck`
Expected: 全部 PASS，无类型错误

- [ ] **Step 7: Commit**

```bash
git add worker/src/auth.ts worker/src/routes/admin.ts worker/test/permissions.test.ts
git commit -m "feat(worker): contentAuth middleware grants diary/album routes to permitted users"
```

---

### Task 3: 日记作者归属（author_user_id 写入 + 公开查询回退）

**Files:**
- Modify: `worker/src/routes/admin.ts`（`POST /diaries` INSERT）
- Modify: `worker/src/routes/public.ts:116-130`（列表 zh/en）与 `public.ts:156-167`（详情 zh/en）
- Test: `worker/test/permissions.test.ts`（追加用例）

**Interfaces:**
- Consumes: Task 1 的 `diaries.author_user_id`；Task 2 的 `contentAuth`。
- Produces: 公开日记接口 `author` 字段规则：`COALESCE(admin_users.display_name, users.username)`——管理员日记显示 display_name，用户日记显示用户名。

- [ ] **Step 1: 追加失败测试**

在 `worker/test/permissions.test.ts` 的 `describe('内容权限中间件')` 之后追加：

```ts
describe('用户日记作者归属', () => {
  it('获权用户创建并发布日记，公开列表/详情作者显示其用户名', async () => {
    const u = await registerUser('perm_author');
    await grant(u.id, 'diary');
    const create = await SELF.fetch('http://x/api/admin/diaries', {
      method: 'POST', headers: userAuth(u.token),
      body: JSON.stringify({ title: '用户日记', slug: 'perm-author-diary', status: 'published', content_md: '正文' }),
    });
    expect(create.status).toBe(200);
    const { id } = await create.json() as any;

    const list = await SELF.fetch('http://x/api/diaries');
    const item = ((await list.json() as any).items as any[]).find((x) => x.slug === 'perm-author-diary');
    expect(item).toBeTruthy();
    expect(item.author).toBe('perm_author');

    const detail = await SELF.fetch('http://x/api/diaries/perm-author-diary');
    expect((await detail.json() as any).author).toBe('perm_author');

    // 清理（用户自己删，验证 delete 也被 contentAuth 放行）
    const del = await SELF.fetch(`http://x/api/admin/diaries/${id}`, { method: 'DELETE', headers: userAuth(u.token) });
    expect(del.status).toBe(200);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd worker && npx vitest run test/permissions.test.ts`
Expected: 新用例 FAIL（公开查询 INNER JOIN admin_users，`author_id` 为 NULL 的用户日记查不到）

- [ ] **Step 3: 写入 author_user_id**

`worker/src/routes/admin.ts` 的 `admin.post('/diaries')`：INSERT 语句改为

```ts
  const r = await c.env.DB.prepare(
    'INSERT INTO diaries (author_id, author_user_id, title, title_en, slug, content_md, content_md_en, status, published_at, category_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(adminUser?.id ?? null, loginUser?.id ?? null, title, title_en || null, slug, content_md, content_md_en || null, status, publishedAt, category_id || null).run();
```

- [ ] **Step 4: 公开查询 LEFT JOIN 回退**

`worker/src/routes/public.ts` 共 4 处 SQL（日记列表 zh/en、日记详情 zh/en）：

- 所有 `u.display_name AS author` 改为 `COALESCE(u.display_name, uu.username) AS author`
- 所有 `FROM diaries d JOIN admin_users u ON u.id = d.author_id` 改为 `FROM diaries d LEFT JOIN admin_users u ON u.id = d.author_id LEFT JOIN users uu ON uu.id = d.author_user_id`

- [ ] **Step 5: 跑测试确认通过**

Run: `cd worker && npm test`
Expected: 全部 PASS（含既有日记测试：管理员日记作者仍为 display_name）

- [ ] **Step 6: Commit**

```bash
git add worker/src/routes/admin.ts worker/src/routes/public.ts worker/test/permissions.test.ts
git commit -m "feat(worker): attribute user-created diaries to users and show username as author"
```

---

### Task 4: 权限管理 API（仅管理员）

**Files:**
- Modify: `worker/src/routes/admin.ts`（门岗区加 `/permissions`，文件尾部「注册用户管理」附近加路由）
- Test: `worker/test/permissions.test.ts`（追加用例）

**Interfaces:**
- Produces: `GET /api/admin/permissions` → `[{ id, username, created_at, diary: 0|1, album: 0|1 }]`；`PUT /api/admin/permissions/:userId`，body `{ diary?: boolean, album?: boolean }`（缺省 false），全量覆盖该用户授权 → `{ ok: true }`。前端 Task 7 依赖这两个接口的字段名。

- [ ] **Step 1: 追加失败测试**

在 `worker/test/permissions.test.ts` 末尾追加：

```ts
describe('权限管理 API', () => {
  it('管理员授予/撤销权限；非管理员与用户令牌访问返回 401', async () => {
    const u = await registerUser('perm_api');

    // 用户令牌不能调权限管理接口
    const denied = await SELF.fetch('http://x/api/admin/permissions', { headers: userAuth(u.token) });
    expect(denied.status).toBe(401);

    // 授予 diary
    const put = await SELF.fetch(`http://x/api/admin/permissions/${u.id}`, {
      method: 'PUT', headers: adminAuth(), body: JSON.stringify({ diary: true, album: false }),
    });
    expect(put.status).toBe(200);

    let list = await (await SELF.fetch('http://x/api/admin/permissions', { headers: adminAuth() })).json() as any[];
    let row = list.find((r) => r.id === u.id);
    expect(row.diary).toBe(1);
    expect(row.album).toBe(0);
    // 授予生效
    expect((await SELF.fetch('http://x/api/admin/diaries', { headers: userAuth(u.token) })).status).toBe(200);

    // 全量覆盖为 album，diary 被撤销
    await SELF.fetch(`http://x/api/admin/permissions/${u.id}`, {
      method: 'PUT', headers: adminAuth(), body: JSON.stringify({ diary: false, album: true }),
    });
    list = await (await SELF.fetch('http://x/api/admin/permissions', { headers: adminAuth() })).json() as any[];
    row = list.find((r) => r.id === u.id);
    expect(row.diary).toBe(0);
    expect(row.album).toBe(1);
    expect((await SELF.fetch('http://x/api/admin/diaries', { headers: userAuth(u.token) })).status).toBe(401);
    expect((await SELF.fetch('http://x/api/admin/albums', { headers: userAuth(u.token) })).status).toBe(200);

    // 不存在的用户
    const missing = await SELF.fetch('http://x/api/admin/permissions/999999', {
      method: 'PUT', headers: adminAuth(), body: JSON.stringify({ diary: true }),
    });
    expect(missing.status).toBe(404);

    // 清理
    await SELF.fetch(`http://x/api/admin/permissions/${u.id}`, {
      method: 'PUT', headers: adminAuth(), body: JSON.stringify({ diary: false, album: false }),
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd worker && npx vitest run test/permissions.test.ts`
Expected: 新用例 FAIL（404，路由不存在）

- [ ] **Step 3: 实现权限管理 API**

`worker/src/routes/admin.ts`：

1. 门岗区追加：

```ts
admin.use('/permissions', adminAuth);
admin.use('/permissions/*', adminAuth);
```

2. 在 `admin.get('/site-users', ...)` 之后追加：

```ts
// ---- 用户内容权限（日记/相册上传管理）----
admin.get('/permissions', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.created_at,
            MAX(CASE WHEN p.permission = 'diary' THEN 1 ELSE 0 END) AS diary,
            MAX(CASE WHEN p.permission = 'album' THEN 1 ELSE 0 END) AS album
     FROM users u LEFT JOIN user_permissions p ON p.user_id = u.id
     GROUP BY u.id ORDER BY u.id`
  ).all();
  return c.json(results);
});

// 全量覆盖某用户的授权：{ diary: bool, album: bool }，缺省视为 false
admin.put('/permissions/:userId', async (c) => {
  const userId = Number(c.req.param('userId'));
  const target = await c.env.DB.prepare('SELECT id, username FROM users WHERE id = ?')
    .bind(userId).first<{ id: number; username: string }>();
  if (!target) return c.json({ detail: '用户不存在' }, 404);
  const { diary = false, album = false } = await c.req.json<{ diary?: boolean; album?: boolean }>();
  const me = c.get('admin') as { id: number; username: string };
  const stmts = [
    c.env.DB.prepare('DELETE FROM user_permissions WHERE user_id = ?').bind(userId),
  ];
  if (diary) stmts.push(c.env.DB.prepare('INSERT INTO user_permissions (user_id, permission, granted_by) VALUES (?, ?, ?)').bind(userId, 'diary', me.id));
  if (album) stmts.push(c.env.DB.prepare('INSERT INTO user_permissions (user_id, permission, granted_by) VALUES (?, ?, ?)').bind(userId, 'album', me.id));
  await c.env.DB.batch(stmts);
  await logAudit(c.env.DB, 'permission_update', me.username,
    `更新用户 ${target.username} 权限：日记=${diary ? '开' : '关'}，相册=${album ? '开' : '关'}`);
  return c.json({ ok: true });
});
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd worker && npx vitest run test/permissions.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: 类型检查 + Commit**

Run: `cd worker && npm run typecheck`

```bash
git add worker/src/routes/admin.ts worker/test/permissions.test.ts
git commit -m "feat(worker): admin API to grant/revoke user diary/album permissions"
```

---

### Task 5: /auth/me 返回 permissions

**Files:**
- Modify: `worker/src/routes/users.ts:65-71`
- Test: `worker/test/permissions.test.ts`（追加用例）

**Interfaces:**
- Produces: `GET /api/auth/me` 响应新增 `permissions: string[]`（值为 `'diary'`/`'album'` 子集，无权限为 `[]`）。前端路由守卫、AdminLayout、MediaView、NavBar 均依赖此字段。

- [ ] **Step 1: 追加失败测试**

```ts
describe('auth/me 权限', () => {
  it('返回当前用户权限列表，无权限为 []', async () => {
    const u = await registerUser('perm_me');
    let meRes = await SELF.fetch('http://x/api/auth/me', { headers: userAuth(u.token) });
    expect((await meRes.json() as any).permissions).toEqual([]);

    await grant(u.id, 'album');
    meRes = await SELF.fetch('http://x/api/auth/me', { headers: userAuth(u.token) });
    expect((await meRes.json() as any).permissions).toEqual(['album']);

    await revokeAll(u.id);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd worker && npx vitest run test/permissions.test.ts`
Expected: FAIL（`permissions` 为 undefined）

- [ ] **Step 3: 实现**

`worker/src/routes/users.ts` 的 `users.get('/auth/me', ...)` 改为：

```ts
users.get('/auth/me', userAuth, async (c) => {
  const me = c.get('user') as { id: number; username: string };
  const row = await c.env.DB.prepare('SELECT id, username, points, avatar, created_at FROM users WHERE id = ?')
    .bind(me.id).first();
  if (!row) return c.json({ detail: '用户不存在' }, 404);
  const { results: perms } = await c.env.DB.prepare('SELECT permission FROM user_permissions WHERE user_id = ?')
    .bind(me.id).all<{ permission: string }>();
  return c.json({ ...(row as object), permissions: perms.map((p) => p.permission) });
});
```

- [ ] **Step 4: 跑全量测试 + Commit**

Run: `cd worker && npm test && npm run typecheck`

```bash
git add worker/src/routes/users.ts worker/test/permissions.test.ts
git commit -m "feat(worker): include content permissions in /auth/me"
```

---

### Task 6: 前端基础——令牌回退、路由守卫、后台布局过滤

**Files:**
- Modify: `web/src/api.js:21-23`（token 选择）与 `api.js:39-64`（401 分流）
- Modify: `web/src/router.js:87-90`（后台守卫）
- Modify: `web/src/views/admin/AdminLayout.vue`（nav 过滤、loadNavOrder 仅管理员、logout 分流）
- Modify: `web/src/views/admin/MediaView.vue:13-20`（tab 按权限过滤）

**Interfaces:**
- Consumes: Task 5 的 `me.permissions`（`web/src/me.js` 的 `me` ref）。
- Produces: 获权用户（无管理员令牌）可进入 `/admin` 且只看到「素材」栏目；素材页只显示有权限的 tab（photos↔album、diaries↔diary，music 仅管理员）。

- [ ] **Step 1: api.js——admin 请求回退用户令牌 + 401 按实际所发令牌分流**

`web/src/api.js` 第 23 行改为：

```js
  const token = admin ? (adminToken || userToken) : (userToken || adminToken || getGuestToken());
```

401 分流（46 行 `if (admin || (!userToken && adminToken))`）改为按本次实际发送的令牌判断：

```js
    const usedAdminToken = admin ? Boolean(adminToken) : (!userToken && Boolean(adminToken));
    if (usedAdminToken) {
```

（获权用户权限被撤销时走 else 分支：清用户令牌回 `/login`，与 `auth_version` 失效行为一致。）

- [ ] **Step 2: router.js——后台守卫放行获权用户**

顶部 import 加 `import { me, loadMe } from './me';`，后台守卫（88-90 行）改为：

```js
  // 后台守卫：管理员令牌直接放行；注册用户持有日记/相册权限也可进入（只看到对应栏目）
  if (to.meta.admin) {
    if (getAdminToken()) return true;
    if (getUserToken()) {
      if (!me.value) await loadMe();
      if (me.value?.permissions?.length) return true;
      return { path: '/' };
    }
    return { name: 'admin-login', query: { redirect: to.fullPath } };
  }
```

- [ ] **Step 3: AdminLayout.vue——侧边栏按身份过滤**

`<script setup>` 改为：

```js
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { getAdminToken, clearAdminToken } from '../../api';
import { localize } from '../../i18n';
import { navOrder, applyNavOrder, loadNavOrder } from '../../utils/admin-nav';
import { me, loadMe } from '../../me';
import MiniPlayer from '../../components/MiniPlayer.vue';

const { t } = useI18n();
const router = useRouter();

// 无管理员令牌时按获权用户处理：只看到「素材」栏目（具体 tab 由 MediaView 按权限再过滤）
const isAdmin = Boolean(getAdminToken());
const navItems = computed(() => {
  let items = applyNavOrder(navOrder.value);
  if (!isAdmin) items = items.filter((item) => item.key === 'media');
  return items.map((item) => ({ to: localize(item.path), label: t(item.labelKey) }));
});

// 自定义排序设置是管理员接口，获权用户调用会 401，仅在管理员身份下加载
onMounted(() => {
  if (isAdmin) loadNavOrder();
  else if (!me.value) loadMe();
});

function logout() {
  if (isAdmin) {
    clearAdminToken();
    router.replace(localize('/admin/login'));
  } else {
    // 获权用户退出后台：保留站点登录态，回前台首页
    router.replace(localize('/'));
  }
}
```

模板与样式不变。

- [ ] **Step 4: MediaView.vue——tab 按权限过滤**

`<script setup>` 中 tabs 相关改为：

```js
import { getAdminToken } from '../../api';
import { me } from '../../me';

const allTabs = [
  { key: 'photos', labelKey: 'admin.photos', component: PhotosView, perm: 'album' },
  { key: 'diaries', labelKey: 'admin.diaries', component: DiariesView, perm: 'diary' },
  { key: 'music', labelKey: 'admin.music', component: MusicView, perm: null },
];

// 管理员看全部；获权用户只看有权限的 tab（music 仅管理员）
const tabs = computed(() => {
  if (getAdminToken()) return allTabs;
  const perms = me.value?.permissions ?? [];
  return allTabs.filter((x) => x.perm && perms.includes(x.perm));
});

const active = computed(() => (tabs.value.some((x) => x.key === route.query.tab) ? route.query.tab : tabs.value[0]?.key));
const activeComponent = computed(() => tabs.value.find((x) => x.key === active.value)?.component);
```

模板中 `v-for="tab in tabs"` 不变（computed 自动解包）。

- [ ] **Step 5: 构建验证**

Run: `cd web && npm run build`
Expected: 构建成功无错误

- [ ] **Step 6: Commit**

```bash
git add web/src/api.js web/src/router.js web/src/views/admin/AdminLayout.vue web/src/views/admin/MediaView.vue
git commit -m "feat(web): let permitted users enter admin shell with filtered nav"
```

---

### Task 7: 管理员「权限管理」页

**Files:**
- Create: `web/src/views/admin/PermissionsView.vue`
- Modify: `web/src/router.js`（admin children 加路由）
- Modify: `web/src/utils/admin-nav.js`（DEFAULT_NAV 加项）
- Modify: `web/src/i18n/zh.js`（`admin` 段加 `permissions`，新增 `adminPerms` 段）

**Interfaces:**
- Consumes: Task 4 的 `GET/PUT /api/admin/permissions`（字段 `id/username/created_at/diary/album`）。
- Produces: 路由 `/admin/permissions`（`meta.admin`），nav key `permissions`。

- [ ] **Step 1: i18n 文案**

`web/src/i18n/zh.js` 的 `admin` 段（约 239 行 `users: '账号',` 之后）加一行：

```js
    permissions: '权限管理',
```

并在 `admin` 段结束后新增：

```js
  adminPerms: {
    title: '权限管理',
    desc: '授予注册用户上传、管理日记和相册的权限，获权用户登录后可进入后台对应栏目。',
    user: '用户',
    diary: '日记上传',
    album: '相册上传',
    empty: '还没有注册用户',
    saveFailed: '保存失败，请重试',
  },
```

- [ ] **Step 2: nav 与路由**

`web/src/utils/admin-nav.js` 的 `DEFAULT_NAV` 中 `{ key: 'users', ... }` 之后插入：

```js
  { key: 'permissions', path: '/admin/permissions', labelKey: 'admin.permissions' },
```

`web/src/router.js` 的 admin children（`users` 路由之后）插入：

```js
      { path: 'permissions', name: 'admin-permissions', component: () => import('./views/admin/PermissionsView.vue') },
```

- [ ] **Step 3: 页面组件**

创建 `web/src/views/admin/PermissionsView.vue`：

```vue
<script setup>
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../../api';

const { t } = useI18n();
const users = ref([]);
const loading = ref(true);
const saving = ref(0); // 正在保存的用户 id，0 = 无

async function load() {
  loading.value = true;
  try {
    users.value = await api('/admin/permissions', { admin: true });
  } finally {
    loading.value = false;
  }
}

async function toggle(u, key) {
  u[key] = u[key] ? 0 : 1; // 乐观切换，失败回滚
  saving.value = u.id;
  try {
    await api(`/admin/permissions/${u.id}`, {
      method: 'PUT', admin: true,
      body: { diary: Boolean(u.diary), album: Boolean(u.album) },
    });
  } catch {
    u[key] = u[key] ? 0 : 1;
    alert(t('adminPerms.saveFailed'));
  } finally {
    saving.value = 0;
  }
}

onMounted(load);
</script>

<template>
  <div class="perms">
    <h2>{{ t('adminPerms.title') }}</h2>
    <p class="desc">{{ t('adminPerms.desc') }}</p>
    <p v-if="loading">{{ t('adminDishes.loading') }}</p>
    <p v-else-if="!users.length" class="empty">{{ t('adminPerms.empty') }}</p>
    <table v-else class="table">
      <thead>
        <tr>
          <th>{{ t('adminPerms.user') }}</th>
          <th>{{ t('adminPerms.diary') }}</th>
          <th>{{ t('adminPerms.album') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="u in users" :key="u.id">
          <td>{{ u.username }}</td>
          <td>
            <input
              type="checkbox"
              :checked="Boolean(u.diary)"
              :disabled="saving === u.id"
              @change="toggle(u, 'diary')"
            />
          </td>
          <td>
            <input
              type="checkbox"
              :checked="Boolean(u.album)"
              :disabled="saving === u.id"
              @change="toggle(u, 'album')"
            />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.perms h2 {
  margin: 0 0 8px;
  color: var(--color-primary-dark);
}
.desc {
  color: var(--color-text-light);
  font-size: 14px;
  margin: 0 0 20px;
}
.empty {
  color: var(--color-text-light);
}
.table {
  width: 100%;
  border-collapse: collapse;
  background: var(--color-card);
  border-radius: 8px;
  overflow: hidden;
}
.table th,
.table td {
  text-align: left;
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-border);
  font-size: 14px;
}
.table th {
  color: var(--color-text-light);
  font-weight: 500;
}
.table input[type='checkbox'] {
  width: 18px;
  height: 18px;
  accent-color: var(--color-primary);
  cursor: pointer;
}
</style>
```

（`adminDishes.loading` 是 `zh.js` 中已有键，文案为「加载中…」，直接复用。）

- [ ] **Step 4: 构建验证**

Run: `cd web && npm run build`
Expected: 构建成功

- [ ] **Step 5: Commit**

```bash
git add web/src/views/admin/PermissionsView.vue web/src/router.js web/src/utils/admin-nav.js web/src/i18n/zh.js
git commit -m "feat(admin): permissions page to grant diary/album upload to users"
```

---

### Task 8: NavBar「内容管理」入口

**Files:**
- Modify: `web/src/components/NavBar.vue:35-44`（links computed）
- Modify: `web/src/i18n/zh.js`（`nav` 段加 `adminEntry`）

**Interfaces:**
- Consumes: Task 5 的 `me.permissions`。

- [ ] **Step 1: i18n**

`web/src/i18n/zh.js` 的 `nav` 段加：

```js
    adminEntry: '内容管理',
```

- [ ] **Step 2: NavBar links 加入口**

`web/src/components/NavBar.vue` 的 `links` computed 改为：

```js
const links = computed(() => {
  const base = [
    { to: localize('/'), label: t('nav.home'), icon: '🏠', exact: true },
    { to: localize('/albums'), label: t('nav.albums'), icon: '📷' },
    { to: localize('/diaries'), label: t('nav.diaries'), icon: '📔' },
    { to: localize('/leaderboard'), label: t('nav.ranking'), icon: '🏆' },
    { to: localize('/music'), label: t('nav.music'), icon: '🎵' },
    { to: localize('/points'), label: t('nav.points'), icon: '📅' },
    { to: localize('/dishes'), label: t('nav.dishes'), icon: '🍲' },
    { to: localize('/stores'), label: t('nav.stores'), icon: '🧭' },
  ];
  // 获权用户（有日记/相册权限）显示后台内容管理入口
  if (me.value?.permissions?.length) {
    base.push({ to: localize('/admin'), label: t('nav.adminEntry'), icon: '🛠️' });
  }
  return base;
});
```

- [ ] **Step 3: 构建验证 + Commit**

Run: `cd web && npm run build`

```bash
git add web/src/components/NavBar.vue web/src/i18n/zh.js
git commit -m "feat(web): show admin entry in navbar for permitted users"
```

---

## 最终验证清单

- [ ] `cd worker && npm test` 全部通过（含新 `permissions.test.ts` 6 个用例）
- [ ] `cd worker && npm run typecheck` 无错误
- [ ] `cd web && npm run build` 成功
- [ ] 手动冒烟（可选，`npm run dev` 双侧）：管理员在「权限管理」给用户开权限 → 该用户前台登录后导航出现 🛠️ → 进入 `/admin` 只看到「素材」且有权限的 tab → 发布日记后公开页作者显示用户名 → 管理员关权限后用户访问后台接口 401
