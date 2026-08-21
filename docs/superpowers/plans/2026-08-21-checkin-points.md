# 签到积分系统实现计划（用户体系 + 签到 + 盲盒 + 兑奖）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 cyyinfo 增加用户体系（口令保护下自助注册/登录）、每日签到积分（连击递增）、盲盒抽奖与积分兑奖（共用奖品体系）、奖品核销与后台奖品管理。

**Architecture:** 后端为 Hono 应用，生产跑在 `web/functions/_lib/`（Cloudflare Pages Functions），`worker/src/` 是同构副本用于本地 dev 代理和 vitest 测试——**所有后端改动两边同路径同内容各写一份**。新功能全部放在新路由文件（`routes/users.ts`、`routes/points.ts`、`routes/adminPrizes.ts`），不改动已分叉的存量路由文件。前端 Vue 3 SPA 新增登录/注册页、积分页和两个后台页面。

**Tech Stack:** Hono 4 + TypeScript（Cloudflare Workers/Pages Functions）、D1（SQLite）、R2、bcryptjs、jose；前端 Vue 3.5 + vue-router 4 + vue-i18n 11；测试 vitest + @cloudflare/vitest-pool-workers。

**设计文档:** `docs/superpowers/specs/2026-08-21-checkin-points-design.md`

## Global Constraints

- 后端代码必须同时写进 `web/functions/_lib/` 和 `worker/src/`，同路径、内容完全一致。
- 错误响应统一 `c.json({ detail: '中文错误消息' }, 4xx)`；成功直接返回数据或 `{ ok: true }`。
- JWT 角色三级：`admin` / `user` / `guest`；签到相关接口用新增的 `userAuth`（要求 `role==='user'`）。
- 签到日期口径：UTC+8 日历日，`YYYY-MM-DD` 字符串。
- 积分扣减用条件更新（`WHERE points >= ?`），库存扣减用 `WHERE stock > 0`，`stock = -1` 表示无限库存不扣减。
- 迁移文件只放 `worker/migrations/`，下一个编号是 `0006`。
- 前端所有文案走 i18n，`web/src/i18n/zh.js` 和 `en.js` 必须同步加 key，完成后跑 `node web/scripts/check-i18n-keys.mjs` 校验。
- 测试跑在 `worker/`：`npm test`（vitest，`isolatedStorage: false`，各测试文件共享数据库，测试需自行清理/构造数据）。
- 每个 Task 完成后按步骤里的命令 commit（中文 conventional commit）。

## 文件结构

**新增（web/functions/_lib 与 worker/src 各一份，内容相同）：**
- `routes/users.ts` — 用户注册/登录/me（`/api/auth/*`）
- `routes/points.ts` — 签到、盲盒、兑换、奖品列表、我的奖品（`/api/checkin*`、`/api/box/*`、`/api/prizes*`、`/api/my/*`）
- `routes/adminPrizes.ts` — 后台奖品 CRUD、核销记录、签到设置（`/api/admin/prizes*`、`/api/admin/prize-records*`、`/api/admin/checkin-settings`）

**修改（两边同步）：**
- `types.ts` — 加 `UserPayload`
- `auth.ts` — 加 `userAuth`
- `guard.ts` — `contentGuard` 放行 `user` 角色
- `index.ts` — 挂载三个新路由文件

**worker 专属：**
- `worker/migrations/0006_users_points.sql`
- `worker/test/users-auth.test.ts`、`checkin.test.ts`、`box-redeem.test.ts`、`admin-prizes.test.ts`
- `worker/test/helpers.ts` 加 `registerUser()` 辅助函数

**前端（web/src）：**
- 修改 `api.js`（user token）、`router.js`（登录页/积分页/后台路由 + 守卫）、`components/NavBar.vue`（积分入口）、`views/GateView.vue`（登录链接）、`views/admin/AdminLayout.vue`（导航）、`views/admin/SettingsView.vue`（签到设置区块）、`i18n/zh.js`、`i18n/en.js`
- 新增 `views/UserLoginView.vue`、`views/PointsView.vue`、`views/admin/AdminPrizesView.vue`、`views/admin/AdminPrizeRecordsView.vue`

---

### Task 1: 数据库迁移 0006

**Files:**
- Create: `worker/migrations/0006_users_points.sql`

**Interfaces:**
- Produces: 表 `users(id, username, password_hash, points, created_at)`、`checkins`、`prizes`、`prize_records`、`point_transactions`（结构见下方 SQL，后续所有任务依赖）。

- [ ] **Step 1: 创建迁移文件**

```sql
-- worker/migrations/0006_users_points.sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  checkin_date TEXT NOT NULL,
  streak_day INTEGER NOT NULL,
  points_earned INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, checkin_date)
);

CREATE TABLE prizes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_en TEXT DEFAULT '',
  description TEXT DEFAULT '',
  description_en TEXT DEFAULT '',
  image TEXT DEFAULT '',
  points_cost INTEGER NOT NULL DEFAULT 0,
  box_weight INTEGER NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT -1,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE prize_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  prize_id INTEGER NOT NULL REFERENCES prizes(id),
  source TEXT NOT NULL,
  points_spent INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  used_at TEXT
);

CREATE TABLE point_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  change INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  type TEXT NOT NULL,
  ref_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 2: 本地应用迁移并验证表结构**

Run: `cd worker && npm run migrate:local`
然后验证：
Run: `cd worker && npx wrangler d1 execute cyyinfo-db --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','checkins','prizes','prize_records','point_transactions')"`
Expected: 输出 5 张表名。

- [ ] **Step 3: Commit**

```bash
git add worker/migrations/0006_users_points.sql
git commit -m "feat: 用户/签到/奖品体系数据库迁移 0006"
```

---

### Task 2: 用户认证后端（注册/登录/me + userAuth + 门禁放行）

**Files:**
- Create: `worker/src/routes/users.ts`，并复制到 `web/functions/_lib/routes/users.ts`
- Modify: `worker/src/types.ts` + `web/functions/_lib/types.ts`（相同改动）
- Modify: `worker/src/auth.ts` + `web/functions/_lib/auth.ts`（相同改动）
- Modify: `worker/src/guard.ts` + `web/functions/_lib/guard.ts`（相同改动）
- Modify: `worker/src/index.ts` + `web/functions/_lib/index.ts`（相同改动）
- Modify: `worker/test/helpers.ts`
- Test: `worker/test/users-auth.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `users` 表；现有 `signJwt(env, payload, expireHours)`、`verifyJwt(env, token)`、`rateLimit()`、`clientIp()`、`getSetting(db, key)`。
- Produces:
  - `userAuth(c, next)` 中间件：校验 `role==='user'`，`c.set('user', { id: number, username: string })`。
  - `POST /api/auth/register` `{username, password}` → `{token, username}`；`POST /api/auth/login` → `{token, username, points}`；`GET /api/auth/me`（userAuth）→ `{id, username, points, created_at}`。
  - `contentGuard` 放行 `role==='user'`。
  - 测试辅助 `registerUser(username)` → `{id, token}`。

- [ ] **Step 1: 写失败测试 `worker/test/users-auth.test.ts`**

注意：注册接口限流 30 次/15 分钟/IP（单 worker 共享，本文件约用 6 次，后续任务文件约用 4 次，够用）；登录限流 5 次/15 分钟，本文件只调 2 次（失败 1 次 + 成功 1 次）。

```ts
import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { applyMigrations } from './helpers';

beforeAll(applyMigrations);
const json = { 'Content-Type': 'application/json' };

async function cleanup() {
  // 先清子表再清 users：checkins/prize_records/point_transactions 都有指向 users 的外键
  await env.DB.prepare('DELETE FROM point_transactions').run();
  await env.DB.prepare('DELETE FROM prize_records').run();
  await env.DB.prepare('DELETE FROM checkins').run();
  await env.DB.prepare('DELETE FROM users').run();
  await env.DB.prepare("DELETE FROM settings WHERE key = 'site_passcode_hash'").run();
}

function register(username: string, password: string, token?: string) {
  const headers: Record<string, string> = { ...json };
  if (token) headers.Authorization = `Bearer ${token}`;
  return SELF.fetch('http://x/api/auth/register', {
    method: 'POST', headers, body: JSON.stringify({ username, password }),
  });
}

describe('用户注册与登录', () => {
  it('站点无口令时可直接注册，注册即登录', async () => {
    await cleanup();
    const res = await register('小明', 'secret6');
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.token).toBeTruthy();
    expect(data.username).toBe('小明');

    const me = await SELF.fetch('http://x/api/auth/me', {
      headers: { Authorization: `Bearer ${data.token}` },
    });
    expect(me.status).toBe(200);
    const meData = await me.json() as any;
    expect(meData.username).toBe('小明');
    expect(meData.points).toBe(0);
    expect(meData.password_hash).toBeUndefined();
  });

  it('非法用户名/弱密码/重名（大小写不敏感）被拒绝', async () => {
    await cleanup();
    expect((await register('a', 'secret6')).status).toBe(400);
    expect((await register('validname', '12345')).status).toBe(400);
    expect((await register('Alice', 'secret6')).status).toBe(200);
    expect((await register('ALICE', 'secret6')).status).toBe(409);
  });

  it('启用口令后注册需先通过口令', async () => {
    await cleanup();
    await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
      .bind('site_passcode_hash', bcrypt.hashSync('pw123456', 10)).run();

    expect((await register('dave', 'secret6')).status).toBe(401);

    const verify = await SELF.fetch('http://x/api/passcode/verify', {
      method: 'POST', headers: json, body: JSON.stringify({ passcode: 'pw123456' }),
    });
    expect(verify.status).toBe(200);
    const { token: guestToken } = await verify.json() as any;
    expect((await register('dave', 'secret6', guestToken)).status).toBe(200);

    await env.DB.prepare("DELETE FROM settings WHERE key = 'site_passcode_hash'").run();
  });

  it('登录成功返回 token，密码错误 401', async () => {
    await cleanup();
    await register('bob', 'secret6');

    const bad = await SELF.fetch('http://x/api/auth/login', {
      method: 'POST', headers: json, body: JSON.stringify({ username: 'bob', password: 'wrong' }),
    });
    expect(bad.status).toBe(401);

    const ok = await SELF.fetch('http://x/api/auth/login', {
      method: 'POST', headers: json, body: JSON.stringify({ username: 'BOB', password: 'secret6' }),
    });
    expect(ok.status).toBe(200);
    const data = await ok.json() as any;
    expect(data.token).toBeTruthy();
    expect(data.username).toBe('bob');
    expect(data.points).toBe(0);
  });

  it('user 角色可通过内容门禁', async () => {
    await cleanup();
    const reg = await register('carol', 'secret6');
    const { token } = await reg.json() as any;

    await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
      .bind('site_passcode_hash', bcrypt.hashSync('pw123456', 10)).run();
    const res = await SELF.fetch('http://x/api/albums', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    await env.DB.prepare("DELETE FROM settings WHERE key = 'site_passcode_hash'").run();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd worker && npx vitest run test/users-auth.test.ts`
Expected: FAIL（`/api/auth/register` 404）

- [ ] **Step 3: `types.ts` 加 UserPayload（两边同步）**

`worker/src/types.ts` 和 `web/functions/_lib/types.ts` 都在文件末尾追加：

```ts
export interface UserPayload {
  sub: number;
  username: string;
  role: 'user';
}
```

注意：`worker/src/types.ts` 的 `Env` 比 web 版少 `REMINDER_TOKEN`，不要动 `Env`，只追加 `UserPayload`。

- [ ] **Step 4: `auth.ts` 加 userAuth（两边同步）**

`worker/src/auth.ts` 和 `web/functions/_lib/auth.ts` 都在文件末尾追加：

```ts
export async function userAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const header = c.req.header('Authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '');
  const payload = token ? await verifyJwt(c.env, token) : null;
  if (!payload || payload.role !== 'user') {
    return c.json({ detail: '请先登录' }, 401);
  }
  c.set('user', { id: payload.sub as number, username: payload.username as string });
  await next();
}
```

- [ ] **Step 5: `guard.ts` contentGuard 放行 user（两边同步）**

两个 `guard.ts` 中把：

```ts
  if (!payload || (payload.role !== 'guest' && payload.role !== 'admin')) {
```

改为：

```ts
  if (!payload || (payload.role !== 'guest' && payload.role !== 'admin' && payload.role !== 'user')) {
```

同时把行首注释 `// 公开内容守卫：口令为空放行，否则要求 admin/guest JWT` 改为 `// 公开内容守卫：口令为空放行，否则要求 admin/guest/user JWT`。

- [ ] **Step 6: 新建 `routes/users.ts`（两边内容一致）**

先写 `worker/src/routes/users.ts`，再原样复制到 `web/functions/_lib/routes/users.ts`：

```ts
import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import type { Env } from '../types';
import { signJwt, verifyJwt, userAuth } from '../auth';
import { rateLimit, clientIp } from '../security';
import { getSetting } from '../guard';

const users = new Hono<{ Bindings: Env }>();

// 用户名：2-20 位字母/数字/下划线/中文
const USERNAME_RE = /^[\w一-龥]{2,20}$/;

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  points: number;
}

users.post('/auth/register', async (c) => {
  if (!rateLimit({ limit: 30, windowSec: 900, key: `register:${clientIp(c.req.raw)}` })) {
    return c.json({ detail: '尝试过于频繁，请稍后再试' }, 429);
  }
  // 站点启用口令时，注册前必须先通过口令（guest/admin/user JWT 均可）
  const passHash = await getSetting(c.env.DB, 'site_passcode_hash');
  if (passHash) {
    const header = c.req.header('Authorization') ?? '';
    const payload = header ? await verifyJwt(c.env, header.replace(/^Bearer\s+/i, '')) : null;
    if (!payload || !['guest', 'admin', 'user'].includes(payload.role as string)) {
      return c.json({ detail: '请先通过访客口令' }, 401);
    }
  }
  const { username, password } = await c.req.json<{ username?: string; password?: string }>();
  const name = (username ?? '').trim();
  if (!USERNAME_RE.test(name)) return c.json({ detail: '用户名需为 2-20 位字母、数字、下划线或中文' }, 400);
  if (!password || password.length < 6) return c.json({ detail: '密码至少 6 位' }, 400);
  const dup = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(name).first();
  if (dup) return c.json({ detail: '用户名已被注册' }, 409);
  const r = await c.env.DB.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .bind(name, bcrypt.hashSync(password, 10)).run();
  const token = await signJwt(c.env, { sub: r.meta.last_row_id, username: name, role: 'user' }, 24 * 7);
  return c.json({ token, username: name });
});

users.post('/auth/login', async (c) => {
  if (!rateLimit({ limit: 5, windowSec: 900, key: `userlogin:${clientIp(c.req.raw)}` })) {
    return c.json({ detail: '尝试过于频繁，请稍后再试' }, 429);
  }
  const { username, password } = await c.req.json<{ username?: string; password?: string }>();
  if (!username || !password) return c.json({ detail: '请输入用户名和密码' }, 400);
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE username = ?')
    .bind(username.trim()).first<UserRow>();
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return c.json({ detail: '用户名或密码错误' }, 401);
  }
  const token = await signJwt(c.env, { sub: user.id, username: user.username, role: 'user' }, 24 * 7);
  return c.json({ token, username: user.username, points: user.points });
});

users.get('/auth/me', userAuth, async (c) => {
  const me = c.get('user') as { id: number; username: string };
  const row = await c.env.DB.prepare('SELECT id, username, points, created_at FROM users WHERE id = ?')
    .bind(me.id).first();
  if (!row) return c.json({ detail: '用户不存在' }, 404);
  return c.json(row);
});

export default users;
```

- [ ] **Step 7: `index.ts` 挂载（两边同步）**

两个 `index.ts`：在 `import publicRoutes from './routes/public';` 之后加：

```ts
import usersRoutes from './routes/users';
```

在 `app.route('/api', publicRoutes);` 之后加：

```ts
app.route('/api', usersRoutes);
```

- [ ] **Step 8: `worker/test/helpers.ts` 加 registerUser 辅助**

文件末尾追加（供后续任务的测试文件复用）：

```ts
// 注册测试用户并返回 {id, token}；注册接口限流 30 次/15 分钟，够用但不要滥用
export async function registerUser(username: string): Promise<{ id: number; token: string }> {
  const { SELF } = await import('cloudflare:test');
  const res = await SELF.fetch('http://x/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'secret6' }),
  });
  const data = (await res.json()) as any;
  if (!data.token) throw new Error(`registerUser(${username}) 失败: ${JSON.stringify(data)}`);
  const me = await SELF.fetch('http://x/api/auth/me', {
    headers: { Authorization: `Bearer ${data.token}` },
  });
  const { id } = (await me.json()) as any;
  return { id, token: data.token };
}
```

- [ ] **Step 9: 跑测试确认通过**

Run: `cd worker && npx vitest run test/users-auth.test.ts`
Expected: PASS（5 个用例）

Run: `cd worker && npm test`
Expected: 全部 PASS（确认没有破坏存量测试）

- [ ] **Step 10: Commit**

```bash
git add worker/src worker/test web/functions/_lib
git commit -m "feat: 用户体系注册/登录与 userAuth 中间件"
```

---

### Task 3: 签到 API

**Files:**
- Create: `worker/src/routes/points.ts`，并复制到 `web/functions/_lib/routes/points.ts`
- Modify: `worker/src/index.ts` + `web/functions/_lib/index.ts`（挂载）
- Test: `worker/test/checkin.test.ts`

**Interfaces:**
- Consumes: `userAuth`（Task 2）、`getSetting`、表 `users/checkins/point_transactions`。
- Produces:
  - `POST /api/checkin`（userAuth）→ `{points_earned, streak_day, balance}`；当天已签 409。
  - `GET /api/checkin/status`（userAuth）→ `{checked_in, streak_day, balance, box_cost, next_points}`。
  - 模块内辅助（Task 4/5 同文件复用）：`checkinConfig(db)`、`dateStr(offsetDays)`、`streakPoints(cfg, day)`。

- [ ] **Step 1: 写失败测试 `worker/test/checkin.test.ts`**

签到规则默认值：base=10、bonus=5、max=40（settings 无配置时用默认值）。测试直接 SQL 构造历史签到行来模拟连击/断签。

```ts
import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations, registerUser } from './helpers';

beforeAll(applyMigrations);

// 与后端一致：UTC+8 日历日
const dateStr = (offsetDays = 0) =>
  new Date(Date.now() + 8 * 3600 * 1000 + offsetDays * 86400000).toISOString().slice(0, 10);

let user: { id: number; token: string };
const auth = () => ({ Authorization: `Bearer ${user.token}` });

beforeAll(async () => {
  user = await registerUser('checkin_user');
});

async function reset() {
  await env.DB.prepare('DELETE FROM checkins WHERE user_id = ?').bind(user.id).run();
  await env.DB.prepare('DELETE FROM point_transactions WHERE user_id = ?').bind(user.id).run();
  await env.DB.prepare('UPDATE users SET points = 0 WHERE id = ?').bind(user.id).run();
  // 清理可能残留的设置，确保走默认值
  await env.DB.prepare("DELETE FROM settings WHERE key IN ('checkin_base_points','checkin_streak_bonus','checkin_max_points','box_cost')").run();
}

async function checkin() {
  return SELF.fetch('http://x/api/checkin', { method: 'POST', headers: auth() });
}

describe('签到', () => {
  it('未登录 401', async () => {
    const res = await SELF.fetch('http://x/api/checkin', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('首次签到得 10 分，连续第 1 天；重复签到 409', async () => {
    await reset();
    const res = await checkin();
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.points_earned).toBe(10);
    expect(data.streak_day).toBe(1);
    expect(data.balance).toBe(10);

    expect((await checkin()).status).toBe(409);

    const tx = await env.DB.prepare("SELECT * FROM point_transactions WHERE user_id = ? AND type = 'checkin'")
      .bind(user.id).all();
    expect(tx.results).toHaveLength(1);
    expect((tx.results[0] as any).balance_after).toBe(10);
  });

  it('昨天签过 → 连击 +1，得分 15', async () => {
    await reset();
    await env.DB.prepare('INSERT INTO checkins (user_id, checkin_date, streak_day, points_earned) VALUES (?, ?, ?, ?)')
      .bind(user.id, dateStr(-1), 1, 10).run();
    const data = await (await checkin()).json() as any;
    expect(data.streak_day).toBe(2);
    expect(data.points_earned).toBe(15);
  });

  it('连击达到上限后封顶 40', async () => {
    await reset();
    await env.DB.prepare('INSERT INTO checkins (user_id, checkin_date, streak_day, points_earned) VALUES (?, ?, ?, ?)')
      .bind(user.id, dateStr(-1), 10, 40).run();
    const data = await (await checkin()).json() as any;
    expect(data.streak_day).toBe(11);
    expect(data.points_earned).toBe(40);
  });

  it('断签后从第 1 天重新计', async () => {
    await reset();
    await env.DB.prepare('INSERT INTO checkins (user_id, checkin_date, streak_day, points_earned) VALUES (?, ?, ?, ?)')
      .bind(user.id, dateStr(-3), 5, 30).run();
    const data = await (await checkin()).json() as any;
    expect(data.streak_day).toBe(1);
    expect(data.points_earned).toBe(10);
  });

  it('status 返回今日状态/连击/余额/明日可得', async () => {
    await reset();
    let status = await (await SELF.fetch('http://x/api/checkin/status', { headers: auth() })).json() as any;
    expect(status).toMatchObject({ checked_in: false, streak_day: 0, balance: 0, next_points: 10, box_cost: 100 });

    await checkin();
    status = await (await SELF.fetch('http://x/api/checkin/status', { headers: auth() })).json() as any;
    expect(status.checked_in).toBe(true);
    expect(status.streak_day).toBe(1);
    expect(status.balance).toBe(10);
    expect(status.next_points).toBe(15);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd worker && npx vitest run test/checkin.test.ts`
Expected: FAIL（`/api/checkin` 404）

- [ ] **Step 3: 新建 `routes/points.ts`（两边内容一致）**

先写 `worker/src/routes/points.ts`，再原样复制到 `web/functions/_lib/routes/points.ts`：

```ts
import { Hono } from 'hono';
import type { Env } from '../types';
import { userAuth } from '../auth';
import { contentGuard, getSetting } from '../guard';

const points = new Hono<{ Bindings: Env }>();

// ---- 签到/盲盒配置（settings 表，缺省用默认值）----
async function checkinConfig(db: D1Database) {
  const base = Number(await getSetting(db, 'checkin_base_points')) || 10;
  const bonus = Number(await getSetting(db, 'checkin_streak_bonus')) || 5;
  const max = Number(await getSetting(db, 'checkin_max_points')) || 40;
  const boxCost = Number(await getSetting(db, 'box_cost')) || 100;
  return { base, bonus, max, boxCost };
}

// 以 UTC+8 的日历日为签到日
function dateStr(offsetDays = 0): string {
  return new Date(Date.now() + 8 * 3600 * 1000 + offsetDays * 86400000).toISOString().slice(0, 10);
}

function streakPoints(cfg: { base: number; bonus: number; max: number }, streakDay: number): number {
  return Math.min(cfg.base + (streakDay - 1) * cfg.bonus, cfg.max);
}

interface CheckinRow {
  checkin_date: string;
  streak_day: number;
}

async function lastCheckin(db: D1Database, userId: number): Promise<CheckinRow | null> {
  return db.prepare(
    'SELECT checkin_date, streak_day FROM checkins WHERE user_id = ? ORDER BY checkin_date DESC LIMIT 1'
  ).bind(userId).first<CheckinRow>();
}

async function balanceOf(db: D1Database, userId: number): Promise<number> {
  const row = await db.prepare('SELECT points FROM users WHERE id = ?').bind(userId).first<{ points: number }>();
  return row?.points ?? 0;
}

// ---- 路由鉴权挂载 ----
points.use('/checkin', userAuth);
points.use('/checkin/*', userAuth);
points.use('/box/*', userAuth);
points.use('/my/*', userAuth);
points.use('/prizes/:id/redeem', userAuth);
points.use('/prizes', contentGuard); // 奖品列表与站内内容同级：口令通过即可看

// ---- 签到 ----
points.post('/checkin', async (c) => {
  const me = c.get('user') as { id: number };
  const db = c.env.DB;
  const today = dateStr();
  if (await db.prepare('SELECT id FROM checkins WHERE user_id = ? AND checkin_date = ?').bind(me.id, today).first()) {
    return c.json({ detail: '今天已签到' }, 409);
  }
  const last = await lastCheckin(db, me.id);
  const streak = last && last.checkin_date === dateStr(-1) ? last.streak_day + 1 : 1;
  const cfg = await checkinConfig(db);
  const earned = streakPoints(cfg, streak);
  try {
    const [ins] = await db.batch([
      db.prepare('INSERT INTO checkins (user_id, checkin_date, streak_day, points_earned) VALUES (?, ?, ?, ?)')
        .bind(me.id, today, streak, earned),
      db.prepare('UPDATE users SET points = points + ? WHERE id = ?').bind(earned, me.id),
    ]);
    const balance = await balanceOf(db, me.id);
    await db.prepare(
      "INSERT INTO point_transactions (user_id, change, balance_after, type, ref_id) VALUES (?, ?, ?, 'checkin', ?)"
    ).bind(me.id, earned, balance, ins.meta.last_row_id).run();
    return c.json({ points_earned: earned, streak_day: streak, balance });
  } catch {
    // UNIQUE(user_id, checkin_date) 冲突 = 并发重复签到
    return c.json({ detail: '今天已签到' }, 409);
  }
});

points.get('/checkin/status', async (c) => {
  const me = c.get('user') as { id: number };
  const db = c.env.DB;
  const today = dateStr();
  const checkedIn = Boolean(
    await db.prepare('SELECT id FROM checkins WHERE user_id = ? AND checkin_date = ?').bind(me.id, today).first()
  );
  const last = await lastCheckin(db, me.id);
  const currentStreak =
    last && (last.checkin_date === today || last.checkin_date === dateStr(-1)) ? last.streak_day : 0;
  const cfg = await checkinConfig(db);
  return c.json({
    checked_in: checkedIn,
    streak_day: currentStreak,
    balance: await balanceOf(db, me.id),
    box_cost: cfg.boxCost,
    next_points: streakPoints(cfg, currentStreak + 1),
  });
});

export default points;
```

- [ ] **Step 4: `index.ts` 挂载（两边同步）**

两个 `index.ts`：在 `import usersRoutes from './routes/users';` 之后加：

```ts
import pointsRoutes from './routes/points';
```

在 `app.route('/api', usersRoutes);` 之后加：

```ts
app.route('/api', pointsRoutes);
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd worker && npx vitest run test/checkin.test.ts`
Expected: PASS（6 个用例）

- [ ] **Step 6: Commit**

```bash
git add worker/src worker/test web/functions/_lib
git commit -m "feat: 每日签到 API（连击递增、封顶、断签重置）"
```

---

### Task 4: 盲盒抽奖 + 积分兑换 + 奖品列表 API

**Files:**
- Modify: `worker/src/routes/points.ts` + `web/functions/_lib/routes/points.ts`（相同改动，追加路由）
- Test: `worker/test/box-redeem.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `points.ts`（`checkinConfig`、`balanceOf`、鉴权挂载已就绪）。
- Produces:
  - `GET /api/prizes`（contentGuard）→ 奖品数组，元素含 `{id, name, description, image, points_cost, box_weight, stock, in_box, in_stock}`（按 `?lang=` 双语）。
  - `POST /api/box/draw`（userAuth）→ `{prize: {id, name, description, image}, balance}`；积分不足 400、奖池空 409。
  - `POST /api/prizes/:id/redeem`（userAuth）→ `{record_id, balance}`；积分不足 400，不可兑换/无库存 409。

- [ ] **Step 1: 写失败测试 `worker/test/box-redeem.test.ts`**

奖品直接 SQL 插入（后台 CRUD 是 Task 6）。单奖品奖池保证抽签确定性。

```ts
import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations, registerUser } from './helpers';

beforeAll(applyMigrations);

let user: { id: number; token: string };
const auth = () => ({ Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' });

beforeAll(async () => {
  user = await registerUser('box_user');
});

async function reset(points: number) {
  // 先清空全部记录再清奖品：prize_records.prize_id 有外键，其他测试文件残留的记录会导致删奖品失败
  await env.DB.prepare('DELETE FROM prize_records').run();
  await env.DB.prepare('DELETE FROM point_transactions WHERE user_id = ?').bind(user.id).run();
  await env.DB.prepare('UPDATE users SET points = ? WHERE id = ?').bind(points, user.id).run();
  await env.DB.prepare('DELETE FROM prizes').run();
  await env.DB.prepare("DELETE FROM settings WHERE key IN ('checkin_base_points','checkin_streak_bonus','checkin_max_points','box_cost')").run();
}

async function insertPrize(p: { name: string; points_cost?: number; box_weight?: number; stock?: number }): Promise<number> {
  const r = await env.DB.prepare(
    'INSERT INTO prizes (name, points_cost, box_weight, stock) VALUES (?, ?, ?, ?)'
  ).bind(p.name, p.points_cost ?? 0, p.box_weight ?? 0, p.stock ?? -1).run();
  return Number(r.meta.last_row_id);
}

async function balance(): Promise<number> {
  const row = await env.DB.prepare('SELECT points FROM users WHERE id = ?').bind(user.id).first<{ points: number }>();
  return row!.points;
}

describe('盲盒', () => {
  it('积分不足 400', async () => {
    await reset(50);
    await insertPrize({ name: '按摩券', box_weight: 1 });
    const res = await SELF.fetch('http://x/api/box/draw', { method: 'POST', headers: auth() });
    expect(res.status).toBe(400);
    expect(await balance()).toBe(50);
  });

  it('奖池为空 409 且不扣分', async () => {
    await reset(500);
    await insertPrize({ name: '不进池', points_cost: 100 }); // box_weight=0
    const res = await SELF.fetch('http://x/api/box/draw', { method: 'POST', headers: auth() });
    expect(res.status).toBe(409);
    expect(await balance()).toBe(500);
  });

  it('抽中扣 100 分、减库存、写记录和流水', async () => {
    await reset(300);
    const pid = await insertPrize({ name: '大餐一顿', box_weight: 5, stock: 2 });
    const res = await SELF.fetch('http://x/api/box/draw', { method: 'POST', headers: auth() });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.prize.id).toBe(pid);
    expect(data.prize.name).toBe('大餐一顿');
    expect(data.balance).toBe(200);

    const prize = await env.DB.prepare('SELECT stock FROM prizes WHERE id = ?').bind(pid).first<{ stock: number }>();
    expect(prize!.stock).toBe(1);

    const rec = await env.DB.prepare("SELECT * FROM prize_records WHERE user_id = ? AND source = 'box'").bind(user.id).all();
    expect(rec.results).toHaveLength(1);
    expect((rec.results[0] as any).points_spent).toBe(100);
    expect((rec.results[0] as any).status).toBe('pending');

    const tx = await env.DB.prepare("SELECT * FROM point_transactions WHERE user_id = ? AND type = 'box'").bind(user.id).all();
    expect(tx.results).toHaveLength(1);
    expect((tx.results[0] as any).change).toBe(-100);
    expect((tx.results[0] as any).balance_after).toBe(200);
  });

  it('无限库存（-1）不扣库存', async () => {
    await reset(1000);
    const pid = await insertPrize({ name: '拥抱一个', box_weight: 1, stock: -1 });
    await SELF.fetch('http://x/api/box/draw', { method: 'POST', headers: auth() });
    const prize = await env.DB.prepare('SELECT stock FROM prizes WHERE id = ?').bind(pid).first<{ stock: number }>();
    expect(prize!.stock).toBe(-1);
  });

  it('库存为 0 的奖品不进奖池', async () => {
    await reset(500);
    await insertPrize({ name: '已抽空', box_weight: 10, stock: 0 });
    const res = await SELF.fetch('http://x/api/box/draw', { method: 'POST', headers: auth() });
    expect(res.status).toBe(409);
    expect(await balance()).toBe(500);
  });
});

describe('兑换', () => {
  it('成功兑换：扣分减库存写记录', async () => {
    await reset(500);
    const pid = await insertPrize({ name: '电影之夜', points_cost: 200, stock: 3 });
    const res = await SELF.fetch(`http://x/api/prizes/${pid}/redeem`, { method: 'POST', headers: auth() });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.balance).toBe(300);
    expect(data.record_id).toBeTruthy();
    expect((await env.DB.prepare('SELECT stock FROM prizes WHERE id = ?').bind(pid).first<{ stock: number }>())!.stock).toBe(2);
  });

  it('积分不足 400 / 无库存 409 / 不可兑换 409 / 不存在 404', async () => {
    await reset(100);
    const pid = await insertPrize({ name: '贵奖品', points_cost: 200 });
    expect((await SELF.fetch(`http://x/api/prizes/${pid}/redeem`, { method: 'POST', headers: auth() })).status).toBe(400);

    await reset(1000);
    const outOfStock = await insertPrize({ name: '没了', points_cost: 100, stock: 0 });
    expect((await SELF.fetch(`http://x/api/prizes/${outOfStock}/redeem`, { method: 'POST', headers: auth() })).status).toBe(409);

    const boxOnly = await insertPrize({ name: '只能抽', box_weight: 1 }); // points_cost=0
    expect((await SELF.fetch(`http://x/api/prizes/${boxOnly}/redeem`, { method: 'POST', headers: auth() })).status).toBe(409);

    expect((await SELF.fetch('http://x/api/prizes/99999/redeem', { method: 'POST', headers: auth() })).status).toBe(404);
    expect(await balance()).toBe(1000);
  });
});

describe('奖品列表', () => {
  it('只返回上架奖品，含 in_box/in_stock 标记', async () => {
    await reset(0);
    await insertPrize({ name: 'A', points_cost: 100, box_weight: 1 });
    const off = await insertPrize({ name: '下架', points_cost: 100 });
    await env.DB.prepare('UPDATE prizes SET is_active = 0 WHERE id = ?').bind(off).run();
    const res = await SELF.fetch('http://x/api/prizes');
    expect(res.status).toBe(200);
    const list = await res.json() as any[];
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('A');
    expect(list[0].in_box).toBe(true);
    expect(list[0].in_stock).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd worker && npx vitest run test/box-redeem.test.ts`
Expected: FAIL（`/api/box/draw` 等 404）

- [ ] **Step 3: `routes/points.ts` 追加路由（两边同步）**

在两个 `routes/points.ts` 的 `export default points;` 之前追加：

```ts
// ---- 奖品列表（商城 + 盲盒预览），双语惯例：英文为空回退中文 ----
interface PrizeRow {
  id: number;
  name: string;
  description: string;
  image: string;
  points_cost: number;
  box_weight: number;
  stock: number;
}

points.get('/prizes', async (c) => {
  const isEn = c.req.query('lang') === 'en';
  const sql = isEn
    ? `SELECT id, image, points_cost, box_weight, stock,
              COALESCE(NULLIF(name_en,''), name) AS name,
              COALESCE(NULLIF(description_en,''), description) AS description
       FROM prizes WHERE is_active = 1 ORDER BY sort_order, id`
    : `SELECT id, name, description, image, points_cost, box_weight, stock
       FROM prizes WHERE is_active = 1 ORDER BY sort_order, id`;
  const { results } = await c.env.DB.prepare(sql).all<PrizeRow>();
  return c.json(results.map((p) => ({
    ...p,
    in_box: p.box_weight > 0 && p.stock !== 0,
    in_stock: p.stock !== 0,
  })));
});

// ---- 盲盒 ----
points.post('/box/draw', async (c) => {
  const me = c.get('user') as { id: number };
  const db = c.env.DB;
  const { boxCost } = await checkinConfig(db);

  // 先条件扣积分，余额不足直接失败
  const deduct = await db.prepare('UPDATE users SET points = points - ? WHERE id = ? AND points >= ?')
    .bind(boxCost, me.id).run();
  if (!deduct.meta.changes) return c.json({ detail: '积分不足' }, 400);
  const refund = () => db.prepare('UPDATE users SET points = points + ? WHERE id = ?').bind(boxCost, me.id).run();

  const { results: pool } = await db.prepare(
    'SELECT * FROM prizes WHERE is_active = 1 AND box_weight > 0 AND stock != 0'
  ).all<PrizeRow & { is_active: number; sort_order: number }>();
  if (!pool.length) {
    await refund();
    return c.json({ detail: '奖池为空' }, 409);
  }

  // 按权重加权随机
  const total = pool.reduce((s, p) => s + p.box_weight, 0);
  let r = Math.random() * total;
  let prize = pool[pool.length - 1];
  for (const p of pool) {
    r -= p.box_weight;
    if (r <= 0) { prize = p; break; }
  }

  // 减库存（有限库存时）+ 写中奖记录，一个批次
  const stmts = [];
  if (prize.stock > 0) {
    stmts.push(db.prepare('UPDATE prizes SET stock = stock - 1 WHERE id = ? AND stock > 0').bind(prize.id));
  }
  stmts.push(
    db.prepare("INSERT INTO prize_records (user_id, prize_id, source, points_spent) VALUES (?, ?, 'box', ?)")
      .bind(me.id, prize.id, boxCost)
  );
  const batchRes = await db.batch(stmts);
  if (prize.stock > 0 && !batchRes[0].meta.changes) {
    // 并发下刚好被抽空
    await refund();
    return c.json({ detail: '奖品刚被抽完，请再试一次' }, 409);
  }
  const recordId = batchRes[batchRes.length - 1].meta.last_row_id;
  const balance = await balanceOf(db, me.id);
  await db.prepare(
    "INSERT INTO point_transactions (user_id, change, balance_after, type, ref_id) VALUES (?, ?, ?, 'box', ?)"
  ).bind(me.id, -boxCost, balance, recordId).run();

  return c.json({
    prize: { id: prize.id, name: prize.name, description: prize.description, image: prize.image },
    balance,
  });
});

// ---- 兑换 ----
points.post('/prizes/:id/redeem', async (c) => {
  const me = c.get('user') as { id: number };
  const db = c.env.DB;
  const prize = await db.prepare('SELECT * FROM prizes WHERE id = ? AND is_active = 1')
    .bind(c.req.param('id')).first<PrizeRow & { is_active: number }>();
  if (!prize) return c.json({ detail: '奖品不存在' }, 404);
  if (prize.points_cost <= 0) return c.json({ detail: '该奖品不可直接兑换' }, 409);
  if (prize.stock === 0) return c.json({ detail: '库存不足' }, 409);

  const deduct = await db.prepare('UPDATE users SET points = points - ? WHERE id = ? AND points >= ?')
    .bind(prize.points_cost, me.id).run();
  if (!deduct.meta.changes) return c.json({ detail: '积分不足' }, 400);

  const stmts = [];
  if (prize.stock > 0) {
    stmts.push(db.prepare('UPDATE prizes SET stock = stock - 1 WHERE id = ? AND stock > 0').bind(prize.id));
  }
  stmts.push(
    db.prepare("INSERT INTO prize_records (user_id, prize_id, source, points_spent) VALUES (?, ?, 'redeem', ?)")
      .bind(me.id, prize.id, prize.points_cost)
  );
  const batchRes = await db.batch(stmts);
  if (prize.stock > 0 && !batchRes[0].meta.changes) {
    await db.prepare('UPDATE users SET points = points + ? WHERE id = ?').bind(prize.points_cost, me.id).run();
    return c.json({ detail: '库存不足' }, 409);
  }
  const recordId = batchRes[batchRes.length - 1].meta.last_row_id;
  const balance = await balanceOf(db, me.id);
  await db.prepare(
    "INSERT INTO point_transactions (user_id, change, balance_after, type, ref_id) VALUES (?, ?, ?, 'redeem', ?)"
  ).bind(me.id, -prize.points_cost, balance, recordId).run();

  return c.json({ record_id: recordId, balance });
});
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd worker && npx vitest run test/box-redeem.test.ts`
Expected: PASS（8 个用例）

- [ ] **Step 5: Commit**

```bash
git add worker/src worker/test web/functions/_lib
git commit -m "feat: 盲盒抽奖与积分兑换 API"
```

---

### Task 5: 我的奖品 + 用户核销 API

**Files:**
- Modify: `worker/src/routes/points.ts` + `web/functions/_lib/routes/points.ts`（相同改动，追加路由）
- Test: `worker/test/my-prizes.test.ts`

**Interfaces:**
- Consumes: Task 3/4 的 `points.ts`。
- Produces:
  - `GET /api/my/prizes`（userAuth）→ 记录数组，元素含 `{id, prize_id, source, points_spent, status, created_at, used_at, name, description, image}`。
  - `POST /api/my/prizes/:id/use`（userAuth）→ `{ok: true}`；非本人/非 pending 409。

- [ ] **Step 1: 写失败测试 `worker/test/my-prizes.test.ts`**

```ts
import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations, registerUser } from './helpers';

beforeAll(applyMigrations);

let userA: { id: number; token: string };
let userB: { id: number; token: string };
const authA = () => ({ Authorization: `Bearer ${userA.token}` });
const authB = () => ({ Authorization: `Bearer ${userB.token}` });

beforeAll(async () => {
  userA = await registerUser('myprize_a');
  userB = await registerUser('myprize_b');
});

async function giveRecord(userId: number, status = 'pending'): Promise<number> {
  const p = await env.DB.prepare('INSERT INTO prizes (name, points_cost) VALUES (?, ?)')
    .bind(`奖品-${Date.now()}-${Math.random()}`, 100).run();
  const r = await env.DB.prepare(
    "INSERT INTO prize_records (user_id, prize_id, source, points_spent, status) VALUES (?, ?, 'redeem', 100, ?)"
  ).bind(userId, p.meta.last_row_id, status).run();
  return Number(r.meta.last_row_id);
}

describe('我的奖品', () => {
  it('列表只含本人记录，带奖品信息', async () => {
    const rid = await giveRecord(userA.id);
    await giveRecord(userB.id);
    const res = await SELF.fetch('http://x/api/my/prizes', { headers: authA() });
    expect(res.status).toBe(200);
    const list = await res.json() as any[];
    expect(list.length).toBeGreaterThanOrEqual(1);
    const mine = list.find((r) => r.id === rid);
    expect(mine).toBeTruthy();
    expect(mine.name).toContain('奖品-');
    expect(mine.status).toBe('pending');
    expect(list.every((r) => !list.length || r.id !== undefined)).toBe(true);
  });

  it('本人核销成功，重复核销 409，他人核销 409', async () => {
    const rid = await giveRecord(userA.id);
    expect((await SELF.fetch(`http://x/api/my/prizes/${rid}/use`, { method: 'POST', headers: authB() })).status).toBe(409);

    const ok = await SELF.fetch(`http://x/api/my/prizes/${rid}/use`, { method: 'POST', headers: authA() });
    expect(ok.status).toBe(200);

    const rec = await env.DB.prepare('SELECT status, used_at FROM prize_records WHERE id = ?').bind(rid).first<any>();
    expect(rec.status).toBe('used');
    expect(rec.used_at).toBeTruthy();

    expect((await SELF.fetch(`http://x/api/my/prizes/${rid}/use`, { method: 'POST', headers: authA() })).status).toBe(409);
  });

  it('未登录 401', async () => {
    expect((await SELF.fetch('http://x/api/my/prizes')).status).toBe(401);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd worker && npx vitest run test/my-prizes.test.ts`
Expected: FAIL（`/api/my/prizes` 404）

- [ ] **Step 3: `routes/points.ts` 追加路由（两边同步）**

在两个 `routes/points.ts` 的 `export default points;` 之前追加：

```ts
// ---- 我的奖品 ----
points.get('/my/prizes', async (c) => {
  const me = c.get('user') as { id: number };
  const isEn = c.req.query('lang') === 'en';
  const nameCol = isEn ? "COALESCE(NULLIF(p.name_en,''), p.name)" : 'p.name';
  const descCol = isEn ? "COALESCE(NULLIF(p.description_en,''), p.description)" : 'p.description';
  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.prize_id, r.source, r.points_spent, r.status, r.created_at, r.used_at,
            ${nameCol} AS name, ${descCol} AS description, p.image
     FROM prize_records r JOIN prizes p ON p.id = r.prize_id
     WHERE r.user_id = ? ORDER BY r.id DESC LIMIT 200`
  ).bind(me.id).all();
  return c.json(results);
});

points.post('/my/prizes/:id/use', async (c) => {
  const me = c.get('user') as { id: number };
  const r = await c.env.DB.prepare(
    "UPDATE prize_records SET status = 'used', used_at = datetime('now') WHERE id = ? AND user_id = ? AND status = 'pending'"
  ).bind(c.req.param('id'), me.id).run();
  if (!r.meta.changes) return c.json({ detail: '记录不存在或已处理' }, 409);
  return c.json({ ok: true });
});
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd worker && npx vitest run test/my-prizes.test.ts && npm test`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add worker/src worker/test web/functions/_lib
git commit -m "feat: 我的奖品列表与用户核销 API"
```

---

### Task 6: 后台奖品管理 + 核销记录 + 签到设置 API

**Files:**
- Create: `worker/src/routes/adminPrizes.ts`，并复制到 `web/functions/_lib/routes/adminPrizes.ts`
- Modify: `worker/src/index.ts` + `web/functions/_lib/index.ts`（挂载）
- Test: `worker/test/admin-prizes.test.ts`

**Interfaces:**
- Consumes: `adminAuth`、`saveUpload(env, file, 'image', prefix)`、`getSetting`/`setSetting`。
- Produces:
  - `GET/POST /api/admin/prizes`、`PUT/DELETE /api/admin/prizes/:id`、`POST /api/admin/prizes/:id/image`（form 字段 `file` → `{image: key}`）。
  - `GET /api/admin/prize-records?status=&user_id=`、`POST /api/admin/prize-records/:id/use`、`POST /api/admin/prize-records/:id/cancel`（取消退积分 + 写 `cancel_refund` 流水）。
  - `GET/PUT /api/admin/checkin-settings`（4 个键：`checkin_base_points`/`checkin_streak_bonus`/`checkin_max_points`/`box_cost`）。
  - `DELETE /api/admin/prizes/:id`：有记录引用的奖品软删（`is_active=0`），无引用硬删。

- [ ] **Step 1: 写失败测试 `worker/test/admin-prizes.test.ts`**

```ts
import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations, adminToken, registerUser } from './helpers';

let token: string;
beforeAll(async () => { await applyMigrations(); token = await adminToken(); });
const auth = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

async function cleanup() {
  await env.DB.prepare('DELETE FROM prize_records').run();
  await env.DB.prepare('DELETE FROM prizes').run();
  await env.DB.prepare("DELETE FROM settings WHERE key IN ('checkin_base_points','checkin_streak_bonus','checkin_max_points','box_cost')").run();
}

async function createPrize(body: Record<string, unknown>) {
  return SELF.fetch('http://x/api/admin/prizes', {
    method: 'POST', headers: auth(), body: JSON.stringify(body),
  });
}

describe('后台奖品管理', () => {
  it('未授权 401', async () => {
    expect((await SELF.fetch('http://x/api/admin/prizes')).status).toBe(401);
  });

  it('创建/列表/编辑/删除', async () => {
    await cleanup();
    const bad = await createPrize({ name: '' });
    expect(bad.status).toBe(400);
    const badStock = await createPrize({ name: 'X', stock: -2 });
    expect(badStock.status).toBe(400);

    const created = await createPrize({ name: '按摩券', name_en: 'Massage', points_cost: 200, box_weight: 3, stock: 5 });
    expect(created.status).toBe(200);
    const { id } = await created.json() as any;

    const list = await (await SELF.fetch('http://x/api/admin/prizes', { headers: auth() })).json() as any[];
    const prize = list.find((p) => p.id === id);
    expect(prize).toMatchObject({ name: '按摩券', name_en: 'Massage', points_cost: 200, box_weight: 3, stock: 5, is_active: 1 });

    const upd = await SELF.fetch(`http://x/api/admin/prizes/${id}`, {
      method: 'PUT', headers: auth(), body: JSON.stringify({ points_cost: 300, stock: -1 }),
    });
    expect(upd.status).toBe(200);
    const after = await (await SELF.fetch('http://x/api/admin/prizes', { headers: auth() })).json() as any[];
    expect(after.find((p) => p.id === id)).toMatchObject({ points_cost: 300, stock: -1 });

    // 无记录引用 → 硬删
    const del = await SELF.fetch(`http://x/api/admin/prizes/${id}`, { method: 'DELETE', headers: auth() });
    expect(del.status).toBe(200);
    expect(await env.DB.prepare('SELECT id FROM prizes WHERE id = ?').bind(id).first()).toBeNull();
  });

  it('有记录引用的奖品删除时软删', async () => {
    await cleanup();
    const { id } = await (await createPrize({ name: '大餐', points_cost: 100 })).json() as any;
    const user = await registerUser('admin_prize_user');
    await env.DB.prepare(
      "INSERT INTO prize_records (user_id, prize_id, source, points_spent) VALUES (?, ?, 'redeem', 100)"
    ).bind(user.id, id).run();

    await SELF.fetch(`http://x/api/admin/prizes/${id}`, { method: 'DELETE', headers: auth() });
    const row = await env.DB.prepare('SELECT is_active FROM prizes WHERE id = ?').bind(id).first<{ is_active: number }>();
    expect(row!.is_active).toBe(0);
  });
});

describe('核销记录管理', () => {
  it('列表筛选、后台核销、取消退积分', async () => {
    await cleanup();
    const user = await registerUser('record_user');
    await env.DB.prepare('UPDATE users SET points = 0 WHERE id = ?').bind(user.id).run();
    const { id: pid } = await (await createPrize({ name: '电影', points_cost: 150 })).json() as any;
    const rec = await env.DB.prepare(
      "INSERT INTO prize_records (user_id, prize_id, source, points_spent) VALUES (?, ?, 'redeem', 150)"
    ).bind(user.id, pid).run();
    const rid = Number(rec.meta.last_row_id);

    const all = await (await SELF.fetch('http://x/api/admin/prize-records', { headers: auth() })).json() as any[];
    const mine = all.find((r) => r.id === rid);
    expect(mine).toMatchObject({ username: 'record_user', prize_name: '电影', status: 'pending' });

    const filtered = await (await SELF.fetch('http://x/api/admin/prize-records?status=used', { headers: auth() })).json() as any[];
    expect(filtered.find((r) => r.id === rid)).toBeUndefined();

    // 取消：状态 cancelled + 退 150 分 + 写流水
    const cancel = await SELF.fetch(`http://x/api/admin/prize-records/${rid}/cancel`, { method: 'POST', headers: auth() });
    expect(cancel.status).toBe(200);
    expect((await env.DB.prepare('SELECT status FROM prize_records WHERE id = ?').bind(rid).first<any>())!.status).toBe('cancelled');
    expect((await env.DB.prepare('SELECT points FROM users WHERE id = ?').bind(user.id).first<any>())!.points).toBe(150);
    const tx = await env.DB.prepare("SELECT * FROM point_transactions WHERE user_id = ? AND type = 'cancel_refund'").bind(user.id).all();
    expect(tx.results).toHaveLength(1);
    expect((tx.results[0] as any).change).toBe(150);

    // 已取消的不能再核销/取消
    expect((await SELF.fetch(`http://x/api/admin/prize-records/${rid}/use`, { method: 'POST', headers: auth() })).status).toBe(409);
    expect((await SELF.fetch(`http://x/api/admin/prize-records/${rid}/cancel`, { method: 'POST', headers: auth() })).status).toBe(409);
  });

  it('后台核销 pending 记录', async () => {
    await cleanup();
    const user = await registerUser('record_user2');
    const { id: pid } = await (await createPrize({ name: '拥抱', points_cost: 50 })).json() as any;
    const rec = await env.DB.prepare(
      "INSERT INTO prize_records (user_id, prize_id, source, points_spent) VALUES (?, ?, 'box', 50)"
    ).bind(user.id, pid).run();
    const rid = Number(rec.meta.last_row_id);
    const ok = await SELF.fetch(`http://x/api/admin/prize-records/${rid}/use`, { method: 'POST', headers: auth() });
    expect(ok.status).toBe(200);
    const row = await env.DB.prepare('SELECT status, used_at FROM prize_records WHERE id = ?').bind(rid).first<any>();
    expect(row.status).toBe('used');
    expect(row.used_at).toBeTruthy();
  });
});

describe('签到设置', () => {
  it('默认读取、修改、非法值拒绝', async () => {
    await cleanup();
    const def = await (await SELF.fetch('http://x/api/admin/checkin-settings', { headers: auth() })).json() as any;
    expect(def).toEqual({
      checkin_base_points: '10', checkin_streak_bonus: '5', checkin_max_points: '40', box_cost: '100',
    });

    const upd = await SELF.fetch('http://x/api/admin/checkin-settings', {
      method: 'PUT', headers: auth(), body: JSON.stringify({ box_cost: 80 }),
    });
    expect(upd.status).toBe(200);
    const after = await (await SELF.fetch('http://x/api/admin/checkin-settings', { headers: auth() })).json() as any;
    expect(after.box_cost).toBe('80');
    expect(after.checkin_base_points).toBe('10');

    const bad = await SELF.fetch('http://x/api/admin/checkin-settings', {
      method: 'PUT', headers: auth(), body: JSON.stringify({ box_cost: 0 }),
    });
    expect(bad.status).toBe(400);

    await env.DB.prepare("DELETE FROM settings WHERE key IN ('checkin_base_points','checkin_streak_bonus','checkin_max_points','box_cost')").run();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd worker && npx vitest run test/admin-prizes.test.ts`
Expected: FAIL（`/api/admin/prizes` 404）

- [ ] **Step 3: 新建 `routes/adminPrizes.ts`（两边内容一致）**

先写 `worker/src/routes/adminPrizes.ts`，再原样复制到 `web/functions/_lib/routes/adminPrizes.ts`：

```ts
import { Hono } from 'hono';
import type { Env } from '../types';
import { adminAuth } from '../auth';
import { getSetting, setSetting } from '../guard';
import { saveUpload } from '../upload';

const ap = new Hono<{ Bindings: Env }>();

ap.use('/prizes', adminAuth);
ap.use('/prizes/*', adminAuth);
ap.use('/prize-records', adminAuth);
ap.use('/prize-records/*', adminAuth);
ap.use('/checkin-settings', adminAuth);

// ---- 奖品 CRUD ----
ap.get('/prizes', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM prizes ORDER BY sort_order, id').all();
  return c.json(results);
});

ap.post('/prizes', async (c) => {
  const {
    name, name_en = '', description = '', description_en = '',
    points_cost = 0, box_weight = 0, stock = -1, sort_order = 0,
  } = await c.req.json();
  if (!name?.trim()) return c.json({ detail: '奖品名必填' }, 400);
  for (const [k, v] of Object.entries({ points_cost, box_weight, sort_order })) {
    if (!Number.isInteger(v) || (v as number) < 0) return c.json({ detail: `${k} 必须是非负整数` }, 400);
  }
  if (!Number.isInteger(stock) || stock < -1) return c.json({ detail: '库存必须是 ≥ -1 的整数（-1 为无限）' }, 400);
  const r = await c.env.DB.prepare(
    `INSERT INTO prizes (name, name_en, description, description_en, points_cost, box_weight, stock, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(name.trim(), name_en.trim(), description.trim(), description_en.trim(),
    points_cost, box_weight, stock, sort_order).run();
  return c.json({ id: r.meta.last_row_id });
});

ap.put('/prizes/:id', async (c) => {
  const body = await c.req.json();
  if (body.name !== undefined && !String(body.name).trim()) return c.json({ detail: '奖品名不能为空' }, 400);
  const fields = ['name', 'name_en', 'description', 'description_en', 'points_cost', 'box_weight', 'stock', 'is_active', 'sort_order'];
  const setParts: string[] = [];
  const params: unknown[] = [];
  for (const f of fields) {
    if (body[f] === undefined) continue;
    if (['points_cost', 'box_weight', 'is_active', 'sort_order'].includes(f)) {
      if (!Number.isInteger(body[f]) || body[f] < 0) return c.json({ detail: `${f} 必须是非负整数` }, 400);
    }
    if (f === 'stock' && (!Number.isInteger(body[f]) || body[f] < -1)) {
      return c.json({ detail: '库存必须是 ≥ -1 的整数（-1 为无限）' }, 400);
    }
    setParts.push(`${f} = ?`);
    params.push(typeof body[f] === 'string' ? body[f].trim() : body[f]);
  }
  if (setParts.length) {
    params.push(Number(c.req.param('id')));
    await c.env.DB.prepare(`UPDATE prizes SET ${setParts.join(', ')} WHERE id = ?`).bind(...params).run();
  }
  return c.json({ ok: true });
});

ap.delete('/prizes/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const used = await c.env.DB.prepare('SELECT id FROM prize_records WHERE prize_id = ? LIMIT 1').bind(id).first();
  if (used) {
    // 有中奖/兑换记录引用，软删保留数据
    await c.env.DB.prepare('UPDATE prizes SET is_active = 0 WHERE id = ?').bind(id).run();
  } else {
    await c.env.DB.prepare('DELETE FROM prizes WHERE id = ?').bind(id).run();
  }
  return c.json({ ok: true });
});

ap.post('/prizes/:id/image', async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) return c.json({ detail: '缺少文件' }, 400);
  const { key, error } = await saveUpload(c.env, file, 'image', 'prizes');
  if (error) return c.json({ detail: error }, 400);
  await c.env.DB.prepare('UPDATE prizes SET image = ? WHERE id = ?').bind(key!, c.req.param('id')).run();
  return c.json({ image: key });
});

// ---- 中奖/兑换记录 ----
ap.get('/prize-records', async (c) => {
  const status = c.req.query('status');
  const userId = Number(c.req.query('user_id')) || 0;
  const conds: string[] = [];
  const args: unknown[] = [];
  if (status && ['pending', 'used', 'cancelled'].includes(status)) {
    conds.push('r.status = ?');
    args.push(status);
  }
  if (userId > 0) {
    conds.push('r.user_id = ?');
    args.push(userId);
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const { results } = await c.env.DB.prepare(
    `SELECT r.*, u.username, p.name AS prize_name, p.name_en AS prize_name_en, p.image AS prize_image
     FROM prize_records r
     JOIN users u ON u.id = r.user_id
     JOIN prizes p ON p.id = r.prize_id
     ${where} ORDER BY r.id DESC LIMIT 200`
  ).bind(...args).all();
  return c.json(results);
});

ap.post('/prize-records/:id/use', async (c) => {
  const r = await c.env.DB.prepare(
    "UPDATE prize_records SET status = 'used', used_at = datetime('now') WHERE id = ? AND status = 'pending'"
  ).bind(c.req.param('id')).run();
  if (!r.meta.changes) return c.json({ detail: '记录不存在或已处理' }, 409);
  return c.json({ ok: true });
});

ap.post('/prize-records/:id/cancel', async (c) => {
  const rec = await c.env.DB.prepare(
    "SELECT id, user_id, points_spent FROM prize_records WHERE id = ? AND status = 'pending'"
  ).bind(c.req.param('id')).first<{ id: number; user_id: number; points_spent: number }>();
  if (!rec) return c.json({ detail: '记录不存在或已处理' }, 409);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE prize_records SET status = 'cancelled' WHERE id = ?").bind(rec.id),
    c.env.DB.prepare('UPDATE users SET points = points + ? WHERE id = ?').bind(rec.points_spent, rec.user_id),
  ]);
  const balance = (await c.env.DB.prepare('SELECT points FROM users WHERE id = ?')
    .bind(rec.user_id).first<{ points: number }>())!.points;
  await c.env.DB.prepare(
    "INSERT INTO point_transactions (user_id, change, balance_after, type, ref_id) VALUES (?, ?, ?, 'cancel_refund', ?)"
  ).bind(rec.user_id, rec.points_spent, balance, rec.id).run();
  return c.json({ ok: true });
});

// ---- 签到设置 ----
const CHECKIN_DEFAULTS: Record<string, string> = {
  checkin_base_points: '10',
  checkin_streak_bonus: '5',
  checkin_max_points: '40',
  box_cost: '100',
};

ap.get('/checkin-settings', async (c) => {
  const out: Record<string, string> = {};
  for (const [k, def] of Object.entries(CHECKIN_DEFAULTS)) {
    out[k] = (await getSetting(c.env.DB, k)) || def;
  }
  return c.json(out);
});

ap.put('/checkin-settings', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  for (const k of Object.keys(CHECKIN_DEFAULTS)) {
    const v = body[k];
    if (v === undefined) continue;
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) return c.json({ detail: `${k} 必须是正整数` }, 400);
    await setSetting(c.env.DB, k, String(n));
  }
  return c.json({ ok: true });
});

export default ap;
```

- [ ] **Step 4: `index.ts` 挂载（两边同步）**

两个 `index.ts`：在 `import pointsRoutes from './routes/points';` 之后加：

```ts
import adminPrizesRoutes from './routes/adminPrizes';
```

在 `app.route('/api/admin', adminRoutes);` 之后加：

```ts
app.route('/api/admin', adminPrizesRoutes);
```

- [ ] **Step 5: 跑全部测试确认通过**

Run: `cd worker && npm test`
Expected: 全部 PASS（含存量测试）

- [ ] **Step 6: Commit**

```bash
git add worker/src worker/test web/functions/_lib
git commit -m "feat: 后台奖品管理/核销记录/签到设置 API"
```

---

### Task 7: 前端用户认证（api.js user token + 登录/注册页 + 路由守卫 + Gate 链接）

**Files:**
- Modify: `web/src/api.js`
- Modify: `web/src/router.js`
- Modify: `web/src/views/GateView.vue`
- Create: `web/src/views/UserLoginView.vue`
- Modify: `web/src/i18n/zh.js`、`web/src/i18n/en.js`

**Interfaces:**
- Produces:
  - `api.js`：`getUserToken()` / `setUserToken(t)` / `clearUserToken()`；非 admin 请求 token 优先级 admin > user > guest。
  - 路由：`/:lang/login`（name `login`，public）、`/:lang/points`（name `points`，`meta.user`，无 user token 跳 login 并带 redirect）。
  - Task 8 的 PointsView 依赖 `getUserToken()` 与 `meta.user` 守卫。

- [ ] **Step 1: 修改 `web/src/api.js`**

完整替换为：

```js
import { i18n } from './i18n';

const GUEST_KEY = 'cyyinfo_guest_token';
const ADMIN_KEY = 'cyyinfo_admin_token';
const USER_KEY = 'cyyinfo_user_token';

export const getGuestToken = () => localStorage.getItem(GUEST_KEY) || '';
export const setGuestToken = (t) => localStorage.setItem(GUEST_KEY, t);
export const clearGuestToken = () => localStorage.removeItem(GUEST_KEY);
export const getAdminToken = () => localStorage.getItem(ADMIN_KEY) || '';
export const setAdminToken = (t) => localStorage.setItem(ADMIN_KEY, t);
export const clearAdminToken = () => localStorage.removeItem(ADMIN_KEY);
export const getUserToken = () => localStorage.getItem(USER_KEY) || '';
export const setUserToken = (t) => localStorage.setItem(USER_KEY, t);
export const clearUserToken = () => localStorage.removeItem(USER_KEY);

async function request(path, { method = 'GET', body, admin = false, form = null } = {}) {
  const headers = {};
  // 优先用管理员 token（管理员可免口令浏览公开页）；其次登录用户；最后访客口令 token
  const token = admin ? getAdminToken() : (getAdminToken() || getUserToken() || getGuestToken());
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  // 公开内容接口按当前语言取本地化内容（后台接口返回中英两版，无需 lang）
  let url = path;
  if (!admin && method === 'GET') {
    url += (url.includes('?') ? '&' : '?') + 'lang=' + encodeURIComponent(i18n.global.locale.value);
  }
  const res = await fetch(url, { method, headers, body: payload });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    if (path.endsWith('/admin/login') || path.endsWith('/auth/login')) {
      // 登录接口 401 = 账号或密码错误：留在登录页提示，不跳转到门禁页
      throw new Error(data.detail || i18n.global.t('api.badCredentials'));
    }
    const loc = i18n.global.locale.value;
    if (admin || getAdminToken()) {
      // 管理员会话失效：清管理员 token，回管理员登录页（已登录管理员不应被抛到访客门禁页）
      clearAdminToken();
      if (!location.pathname.startsWith(`/${loc}/admin/login`)) location.href = `/${loc}/admin/login`;
    } else {
      // 访客/用户会话失效：清 token 回门禁页（积分页等由路由守卫另行引导登录）
      clearGuestToken();
      clearUserToken();
      if (!location.pathname.startsWith(`/${loc}/gate`)) location.href = `/${loc}/gate`;
    }
    throw new Error(data.detail || i18n.global.t('api.unauthorized'));
  }
  if (!res.ok) throw new Error(data.detail || i18n.global.t('api.requestFailed', { status: res.status }));
  return data;
}

export const api = (path, opts) => request(`/api${path}`, opts);
export const apiUpload = (path, formData, admin = true) =>
  request(`/api${path}`, { method: 'POST', form: formData, admin });
```

- [ ] **Step 2: 修改 `web/src/router.js`**

第 2 行改为：

```js
import { api, getGuestToken, getAdminToken, getUserToken } from './api';
```

在 `gate` 路由行之后加：

```js
  { path: '/:lang/login', name: 'login', component: () => import('./views/UserLoginView.vue'), meta: { public: true } },
```

在 `music-album` 路由行之后加：

```js
  { path: '/:lang/points', name: 'points', component: () => import('./views/PointsView.vue'), meta: { user: true } },
```

在 admin children 数组里 `settings` 行之后加（Task 9 的页面，这里一次配好）：

```js
      { path: 'prizes', name: 'admin-prizes', component: () => import('./views/admin/AdminPrizesView.vue') },
      { path: 'prize-records', name: 'admin-prize-records', component: () => import('./views/admin/AdminPrizeRecordsView.vue') },
```

在 `router.beforeEach` 的 `if (to.meta.public) return true;` 之后加用户守卫：

```js
  // 积分/签到页需要用户登录
  if (to.meta.user && !getUserToken()) {
    return { name: 'login', params: { lang }, query: { redirect: to.fullPath } };
  }
```

注意：`/:lang/points` 带 `meta.user` 不带 `meta.public`，会先命中 user 守卫再命中口令守卫——user token 已代表通过门禁，所以在 user 守卫通过后还应跳过口令守卫。把口令守卫的条件改为：

```js
  if (passcodeEnabled && !getGuestToken() && !getAdminToken() && !getUserToken()) {
```

- [ ] **Step 3: 新建 `web/src/views/UserLoginView.vue`**

```vue
<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api, setUserToken, getGuestToken, getAdminToken } from '../api';
import { localize } from '../i18n';
import { autoPlayMusic } from '../player';

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const mode = ref('login'); // 'login' | 'register'
const username = ref('');
const password = ref('');
const confirmPassword = ref('');
const error = ref('');
const loading = ref(false);
// 站点启用了口令且未通过口令：注册会被后端拒绝，先提示去过口令
const needPasscode = ref(false);

onMounted(async () => {
  try {
    const s = await api('/site/status');
    needPasscode.value = s.passcode_enabled && !getGuestToken() && !getAdminToken();
  } catch { /* 状态拉取失败不阻塞登录 */ }
});

const redirectTarget = computed(() => {
  const r = route.query.redirect;
  return typeof r === 'string' && r.startsWith('/') ? r : localize('/points');
});

async function submit() {
  error.value = '';
  const name = username.value.trim();
  if (!name || !password.value) {
    error.value = t('userAuth.fillAll');
    return;
  }
  if (mode.value === 'register') {
    if (password.value.length < 6) {
      error.value = t('userAuth.passwordTooShort');
      return;
    }
    if (password.value !== confirmPassword.value) {
      error.value = t('userAuth.passwordMismatch');
      return;
    }
  }
  loading.value = true;
  try {
    const path = mode.value === 'login' ? '/auth/login' : '/auth/register';
    const data = await api(path, { method: 'POST', body: { username: name, password: password.value } });
    setUserToken(data.token);
    router.replace(redirectTarget.value);
    autoPlayMusic();
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="user-login">
    <form class="card" @submit.prevent="submit">
      <h1>{{ t('userAuth.title') }}</h1>
      <div class="tabs">
        <button
          type="button"
          :class="['tab', { active: mode === 'login' }]"
          @click="mode = 'login'; error = ''"
        >{{ t('userAuth.loginTab') }}</button>
        <button
          type="button"
          :class="['tab', { active: mode === 'register' }]"
          @click="mode = 'register'; error = ''"
        >{{ t('userAuth.registerTab') }}</button>
      </div>
      <p v-if="needPasscode && mode === 'register'" class="hint">
        {{ t('userAuth.needPasscode') }}
        <router-link :to="{ path: localize('/gate'), query: { redirect: localize('/login') } }">
          {{ t('userAuth.goGate') }}
        </router-link>
      </p>
      <input v-model="username" type="text" :placeholder="t('userAuth.usernamePh')" autocomplete="username" />
      <input
        v-model="password"
        type="password"
        :placeholder="t('userAuth.passwordPh')"
        :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
      />
      <input
        v-if="mode === 'register'"
        v-model="confirmPassword"
        type="password"
        :placeholder="t('userAuth.confirmPasswordPh')"
        autocomplete="new-password"
      />
      <p v-if="error" class="error">{{ error }}</p>
      <button type="submit" :disabled="loading">
        {{ loading ? t('userAuth.submitting') : (mode === 'login' ? t('userAuth.loginTab') : t('userAuth.registerTab')) }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.user-login {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-deep);
  padding: 24px;
}
.card {
  width: 100%;
  max-width: 360px;
  background: var(--color-card);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 40px 32px;
  text-align: center;
}
h1 {
  font-size: 24px;
  color: var(--color-primary);
  margin-bottom: 20px;
}
.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
}
.tab {
  flex: 1;
  padding: 8px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: none;
  color: var(--color-text-light);
  cursor: pointer;
  font-size: 14px;
}
.tab.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}
.hint {
  font-size: 13px;
  color: var(--color-text-light);
  margin-bottom: 12px;
}
.hint a {
  color: var(--color-primary);
}
input {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  margin-bottom: 12px;
  outline: none;
}
input:focus {
  border-color: var(--color-primary);
}
.error {
  color: #c0392b;
  font-size: 13px;
  margin-bottom: 12px;
}
button[type='submit'] {
  width: 100%;
  padding: 12px;
  border: none;
  border-radius: 8px;
  background: var(--color-primary);
  color: #fff;
  cursor: pointer;
}
button[type='submit']:hover:not(:disabled) {
  background: var(--color-primary-dark);
}
button[type='submit']:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
```

- [ ] **Step 4: `web/src/views/GateView.vue` 加登录链接**

在模板末尾的 admin-link 行之后加：

```vue
    <router-link :to="localize('/login')" class="admin-link">{{ t('gate.loginLink') }}</router-link>
```

- [ ] **Step 5: i18n 加 key（zh.js 与 en.js）**

`web/src/i18n/zh.js`：`gate` 区块里加一行 `loginLink: '登录账号签到领积分',`；在 `admin` 区块前新增：

```js
  userAuth: {
    title: '账号登录',
    loginTab: '登录',
    registerTab: '注册',
    usernamePh: '用户名',
    passwordPh: '密码',
    confirmPasswordPh: '确认密码',
    fillAll: '请填写用户名和密码',
    passwordTooShort: '密码至少 6 位',
    passwordMismatch: '两次输入的密码不一致',
    submitting: '请稍候…',
    needPasscode: '注册需要先通过访客口令。',
    goGate: '去输入口令',
  },
```

`web/src/i18n/en.js` 对应位置（保持 key 完全一致）：

```js
  userAuth: {
    title: 'Sign In',
    loginTab: 'Sign In',
    registerTab: 'Register',
    usernamePh: 'Username',
    passwordPh: 'Password',
    confirmPasswordPh: 'Confirm password',
    fillAll: 'Please enter username and password',
    passwordTooShort: 'Password must be at least 6 characters',
    passwordMismatch: 'Passwords do not match',
    submitting: 'Please wait…',
    needPasscode: 'Registration requires the site passcode first.',
    goGate: 'Enter passcode',
  },
```

en.js 的 `gate` 区块加 `loginLink: 'Sign in to check in & earn points',`。

- [ ] **Step 6: 校验 i18n + 构建**

Run: `node web/scripts/check-i18n-keys.mjs`
Expected: 无缺失 key 报错

Run: `cd web && npm run build`
Expected: 构建成功（此时 PointsView/AdminPrizesView/AdminPrizeRecordsView 还不存在，`router.js` 的懒加载 import 在构建期不会解析失败——Vite 对动态 import 的缺失模块会报错，若报错就先建三个空壳组件 `<template><div /></template>`，Task 8/9 再填充；以实际构建结果为准）

- [ ] **Step 7: Commit**

```bash
git add web/src
git commit -m "feat: 前端用户登录/注册页与路由守卫"
```

---

### Task 8: 前台积分页 PointsView + NavBar 入口

**Files:**
- Create: `web/src/views/PointsView.vue`
- Modify: `web/src/components/NavBar.vue`
- Modify: `web/src/i18n/zh.js`、`web/src/i18n/en.js`

**Interfaces:**
- Consumes: Task 2–5 的用户端 API；Task 7 的路由守卫与 `meta.user`；图片 URL 约定 `/uploads/{image}`。
- Produces: `/:lang/points` 页面；`nav.points` i18n key。

- [ ] **Step 1: 新建 `web/src/views/PointsView.vue`**

```vue
<script setup>
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api';

const { t } = useI18n();

const me = ref(null);
const status = ref(null); // {checked_in, streak_day, balance, box_cost, next_points}
const prizes = ref([]);
const myPrizes = ref([]);
const error = ref('');
const loading = ref(true);
const acting = ref(false); // 防重复点击

// 盲盒结果弹窗
const boxResult = ref(null);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [meData, statusData, prizeList, myList] = await Promise.all([
      api('/auth/me'),
      api('/checkin/status'),
      api('/prizes'),
      api('/my/prizes'),
    ]);
    me.value = meData;
    status.value = statusData;
    prizes.value = prizeList;
    myPrizes.value = myList;
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function checkin() {
  acting.value = true;
  error.value = '';
  try {
    await api('/checkin', { method: 'POST' });
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    acting.value = false;
  }
}

async function draw() {
  acting.value = true;
  error.value = '';
  boxResult.value = null;
  try {
    const data = await api('/box/draw', { method: 'POST' });
    boxResult.value = data.prize;
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    acting.value = false;
  }
}

async function redeem(prize) {
  if (!confirm(t('points.confirmRedeem', { name: prize.name, cost: prize.points_cost }))) return;
  acting.value = true;
  error.value = '';
  try {
    await api(`/prizes/${prize.id}/redeem`, { method: 'POST' });
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    acting.value = false;
  }
}

async function useRecord(rec) {
  if (!confirm(t('points.confirmUse', { name: rec.name }))) return;
  acting.value = true;
  error.value = '';
  try {
    await api(`/my/prizes/${rec.id}/use`, { method: 'POST' });
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    acting.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="points-page">
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="hint">{{ t('points.loading') }}</p>

    <template v-else-if="status">
      <!-- 签到卡片 -->
      <section class="card checkin-card">
        <div class="balance-row">
          <span class="hello">{{ t('points.hello', { name: me?.username }) }}</span>
          <span class="balance">{{ t('points.balance', { n: status.balance }) }}</span>
        </div>
        <p class="streak">{{ t('points.streak', { n: status.streak_day }) }}</p>
        <button
          class="btn primary big"
          :disabled="acting || status.checked_in"
          @click="checkin"
        >
          {{ status.checked_in
            ? t('points.checkedIn')
            : t('points.checkinNow', { n: status.next_points }) }}
        </button>
        <p v-if="status.checked_in" class="hint">{{ t('points.tomorrow', { n: status.next_points }) }}</p>
      </section>

      <!-- 盲盒 -->
      <section class="card">
        <h3>{{ t('points.boxTitle') }}</h3>
        <p class="hint">{{ t('points.boxHint', { cost: status.box_cost }) }}</p>
        <button
          class="btn primary"
          :disabled="acting || status.balance < status.box_cost"
          @click="draw"
        >{{ t('points.draw', { cost: status.box_cost }) }}</button>
        <p v-if="status.balance < status.box_cost" class="hint">{{ t('points.notEnough') }}</p>
      </section>

      <!-- 奖品商城 -->
      <section class="card">
        <h3>{{ t('points.mallTitle') }}</h3>
        <p v-if="!prizes.length" class="hint">{{ t('points.emptyPrizes') }}</p>
        <ul v-else class="prize-grid">
          <li v-for="p in prizes" :key="p.id" class="prize-item">
            <img v-if="p.image" :src="`/uploads/${p.image}`" class="prize-img" :alt="p.name" />
            <div class="prize-body">
              <p class="prize-name">{{ p.name }}</p>
              <p v-if="p.description" class="prize-desc">{{ p.description }}</p>
              <div class="prize-actions">
                <button
                  v-if="p.points_cost > 0"
                  class="btn"
                  :disabled="acting || !p.in_stock || status.balance < p.points_cost"
                  @click="redeem(p)"
                >
                  {{ p.in_stock ? t('points.redeem', { cost: p.points_cost }) : t('points.soldOut') }}
                </button>
                <span v-else class="tag">{{ t('points.boxOnly') }}</span>
              </div>
            </div>
          </li>
        </ul>
      </section>

      <!-- 我的奖品 -->
      <section class="card">
        <h3>{{ t('points.myPrizes') }}</h3>
        <p v-if="!myPrizes.length" class="hint">{{ t('points.emptyMy') }}</p>
        <ul v-else class="record-list">
          <li v-for="r in myPrizes" :key="r.id" class="record-item">
            <div class="record-info">
              <span class="record-name">{{ r.name }}</span>
              <span class="record-meta">
                {{ r.source === 'box' ? t('points.fromBox') : t('points.fromRedeem') }} ·
                {{ r.points_spent }} {{ t('points.pointsUnit') }} ·
                {{ r.created_at }}
              </span>
            </div>
            <span v-if="r.status === 'used'" class="tag used">{{ t('points.statusUsed') }}</span>
            <span v-else-if="r.status === 'cancelled'" class="tag">{{ t('points.statusCancelled') }}</span>
            <button v-else class="btn" :disabled="acting" @click="useRecord(r)">{{ t('points.use') }}</button>
          </li>
        </ul>
      </section>
    </template>

    <!-- 盲盒结果弹窗 -->
    <div v-if="boxResult" class="modal-mask" @click.self="boxResult = null">
      <div class="modal">
        <h3>{{ t('points.boxWin') }}</h3>
        <img v-if="boxResult.image" :src="`/uploads/${boxResult.image}`" class="prize-img" :alt="boxResult.name" />
        <p class="win-name">{{ boxResult.name }}</p>
        <p v-if="boxResult.description" class="hint">{{ boxResult.description }}</p>
        <button class="btn primary" @click="boxResult = null">{{ t('points.ok') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.points-page {
  max-width: 720px;
  margin: 0 auto;
  padding: 24px 20px 90px;
}
.error {
  color: #c0392b;
  font-size: 14px;
  margin-bottom: 16px;
}
.hint {
  color: var(--color-text-light);
  font-size: 13px;
}
.card {
  background: var(--color-card);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 20px 24px;
  margin-bottom: 20px;
}
.card h3 {
  font-size: 16px;
  margin: 0 0 10px;
}
.checkin-card {
  text-align: center;
}
.balance-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.hello {
  font-size: 15px;
}
.balance {
  font-size: 18px;
  color: var(--color-primary);
  font-weight: 600;
}
.streak {
  font-size: 14px;
  color: var(--color-text-light);
  margin-bottom: 14px;
}
.btn {
  border: 1px solid var(--color-border);
  background: #fff;
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 14px;
  color: var(--color-text);
  cursor: pointer;
}
.btn.primary {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}
.btn.primary:hover:not(:disabled) {
  background: var(--color-primary-dark);
}
.btn.big {
  padding: 12px 32px;
  font-size: 16px;
  margin-bottom: 8px;
}
.btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.prize-grid {
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 14px;
  padding: 0;
}
.prize-item {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  overflow: hidden;
}
.prize-img {
  width: 100%;
  height: 120px;
  object-fit: cover;
  display: block;
}
.prize-body {
  padding: 10px 12px;
}
.prize-name {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 4px;
}
.prize-desc {
  font-size: 12px;
  color: var(--color-text-light);
  margin: 0 0 8px;
}
.tag {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  background: var(--bg-deep);
  color: var(--color-text-light);
}
.tag.used {
  background: #e6f6ec;
  color: #1e8e4f;
}
.record-list {
  list-style: none;
  padding: 0;
}
.record-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--color-border);
}
.record-item:last-child {
  border-bottom: none;
}
.record-info {
  flex: 1;
  min-width: 0;
}
.record-name {
  display: block;
  font-size: 14px;
}
.record-meta {
  font-size: 12px;
  color: var(--color-text-light);
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 24px;
}
.modal {
  background: var(--color-card);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 28px 32px;
  text-align: center;
  max-width: 320px;
  width: 100%;
}
.modal .prize-img {
  border-radius: 8px;
  margin-bottom: 10px;
}
.win-name {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-primary);
  margin: 4px 0 8px;
}
.modal .btn {
  margin-top: 12px;
}
</style>
```

- [ ] **Step 2: `web/src/components/NavBar.vue` 加入口**

`links` computed 改为：

```js
const links = computed(() => [
  { to: localize('/'), label: t('nav.home'), exact: true },
  { to: localize('/albums'), label: t('nav.albums') },
  { to: localize('/diaries'), label: t('nav.diaries') },
  { to: localize('/music'), label: t('nav.music') },
  { to: localize('/points'), label: t('nav.points') },
]);
```

- [ ] **Step 3: i18n 加 key（zh.js 与 en.js）**

zh.js：`nav` 区块加 `points: '签到',`；新增 `points` 区块（放在 `userAuth` 之后）：

```js
  points: {
    loading: '加载中…',
    hello: '你好，{name}',
    balance: '积分：{n}',
    streak: '已连续签到 {n} 天',
    checkinNow: '签到 +{n}',
    checkedIn: '今日已签到',
    tomorrow: '明天签到可得 {n} 分',
    boxTitle: '盲盒',
    boxHint: '每次消耗 {cost} 积分，奖品随机',
    draw: '抽一次（{cost} 分）',
    notEnough: '积分不足，先去签到吧',
    boxWin: '恭喜抽中',
    ok: '好的',
    mallTitle: '奖品商城',
    emptyPrizes: '奖品准备中…',
    redeem: '兑换（{cost} 分）',
    soldOut: '已兑完',
    boxOnly: '仅限盲盒',
    confirmRedeem: '确定用 {cost} 积分兑换「{name}」吗？',
    myPrizes: '我的奖品',
    emptyMy: '还没有奖品，去抽个盲盒吧',
    fromBox: '盲盒',
    fromRedeem: '兑换',
    pointsUnit: '分',
    use: '使用',
    statusUsed: '已使用',
    statusCancelled: '已取消',
    confirmUse: '确定使用「{name}」吗？使用后不可撤销。',
  },
```

en.js：`nav` 区块加 `points: 'Check-in',`；`points` 区块：

```js
  points: {
    loading: 'Loading…',
    hello: 'Hi, {name}',
    balance: 'Points: {n}',
    streak: '{n}-day streak',
    checkinNow: 'Check in +{n}',
    checkedIn: 'Checked in today',
    tomorrow: 'Tomorrow: {n} points',
    boxTitle: 'Mystery Box',
    boxHint: '{cost} points per draw, random prize',
    draw: 'Draw ({cost} pts)',
    notEnough: 'Not enough points — go check in!',
    boxWin: 'You won',
    ok: 'OK',
    mallTitle: 'Prize Shop',
    emptyPrizes: 'Prizes coming soon…',
    redeem: 'Redeem ({cost} pts)',
    soldOut: 'Sold out',
    boxOnly: 'Box only',
    confirmRedeem: 'Redeem "{name}" for {cost} points?',
    myPrizes: 'My Prizes',
    emptyMy: 'No prizes yet — try the mystery box!',
    fromBox: 'Box',
    fromRedeem: 'Redeemed',
    pointsUnit: 'pts',
    use: 'Use',
    statusUsed: 'Used',
    statusCancelled: 'Cancelled',
    confirmUse: 'Use "{name}"? This cannot be undone.',
  },
```

- [ ] **Step 4: 校验 i18n + 构建**

Run: `node web/scripts/check-i18n-keys.mjs && cd web && npm run build`
Expected: i18n 无缺失；构建成功（若因 Task 9 的两个后台组件缺失报错，先建空壳组件，Task 9 填充）

- [ ] **Step 5: Commit**

```bash
git add web/src
git commit -m "feat: 前台积分页（签到/盲盒/商城/我的奖品）与导航入口"
```

---

### Task 9: 后台奖品管理页 + 核销记录页 + 签到设置区块

**Files:**
- Create: `web/src/views/admin/AdminPrizesView.vue`、`web/src/views/admin/AdminPrizeRecordsView.vue`
- Modify: `web/src/views/admin/AdminLayout.vue`、`web/src/views/admin/SettingsView.vue`
- Modify: `web/src/i18n/zh.js`、`web/src/i18n/en.js`

**Interfaces:**
- Consumes: Task 6 的 admin API；Task 7 已配好的 admin 路由；现有 `apiUpload`（图片上传，form 字段名 `file`）。

- [ ] **Step 1: 新建 `web/src/views/admin/AdminPrizesView.vue`**

```vue
<script setup>
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, apiUpload } from '../../api';

const { t } = useI18n();
const prizes = ref([]);
const loading = ref(true);
const error = ref('');

// 弹窗编辑（新增/编辑共用）
const showForm = ref(false);
const editing = ref(null); // null=新增，否则为奖品对象
const form = ref({});
const saving = ref(false);
const uploading = ref(false);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    prizes.value = await api('/admin/prizes', { admin: true });
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editing.value = null;
  form.value = {
    name: '', name_en: '', description: '', description_en: '',
    points_cost: 0, box_weight: 0, stock: -1, sort_order: 0, is_active: 1, image: '',
  };
  showForm.value = true;
}

function openEdit(p) {
  editing.value = p;
  form.value = { ...p };
  showForm.value = true;
}

async function save() {
  if (!form.value.name?.trim()) {
    error.value = t('adminPrizes.nameRequired');
    return;
  }
  saving.value = true;
  error.value = '';
  const body = {
    name: form.value.name.trim(),
    name_en: (form.value.name_en || '').trim(),
    description: (form.value.description || '').trim(),
    description_en: (form.value.description_en || '').trim(),
    points_cost: Number(form.value.points_cost),
    box_weight: Number(form.value.box_weight),
    stock: Number(form.value.stock),
    sort_order: Number(form.value.sort_order),
  };
  try {
    if (editing.value) {
      await api(`/admin/prizes/${editing.value.id}`, { method: 'PUT', admin: true, body: { ...body, is_active: Number(form.value.is_active) } });
    } else {
      await api('/admin/prizes', { method: 'POST', admin: true, body });
    }
    showForm.value = false;
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}

async function uploadImage(e) {
  const file = e.target.files?.[0];
  if (!file || !editing.value) return;
  uploading.value = true;
  error.value = '';
  try {
    const fd = new FormData();
    fd.append('file', file);
    const { image } = await apiUpload(`/admin/prizes/${editing.value.id}/image`, fd);
    form.value.image = image;
    await load();
  } catch (err) {
    error.value = err.message;
  } finally {
    uploading.value = false;
    e.target.value = '';
  }
}

async function remove(p) {
  if (!confirm(t('adminPrizes.confirmDelete', { name: p.name }))) return;
  error.value = '';
  try {
    await api(`/admin/prizes/${p.id}`, { method: 'DELETE', admin: true });
    await load();
  } catch (e) {
    error.value = e.message;
  }
}

onMounted(load);
</script>

<template>
  <div class="prizes-view">
    <div class="head">
      <h2 class="page-title">{{ t('adminPrizes.title') }}</h2>
      <button class="btn primary" @click="openCreate">{{ t('adminPrizes.add') }}</button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <section class="card">
      <p v-if="loading" class="hint">{{ t('adminPrizes.loading') }}</p>
      <p v-else-if="!prizes.length" class="hint">{{ t('adminPrizes.empty') }}</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>{{ t('adminPrizes.colName') }}</th>
            <th>{{ t('adminPrizes.colCost') }}</th>
            <th>{{ t('adminPrizes.colWeight') }}</th>
            <th>{{ t('adminPrizes.colStock') }}</th>
            <th>{{ t('adminPrizes.colStatus') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in prizes" :key="p.id">
            <td>
              <img v-if="p.image" :src="`/uploads/${p.image}`" class="thumb" :alt="p.name" />
              {{ p.name }}
            </td>
            <td>{{ p.points_cost || '—' }}</td>
            <td>{{ p.box_weight || '—' }}</td>
            <td>{{ p.stock === -1 ? t('adminPrizes.unlimited') : p.stock }}</td>
            <td>
              <span class="badge" :class="p.is_active ? 'enabled' : 'disabled'">
                {{ p.is_active ? t('adminPrizes.active') : t('adminPrizes.inactive') }}
              </span>
            </td>
            <td class="actions">
              <button class="btn" @click="openEdit(p)">{{ t('adminPrizes.edit') }}</button>
              <button class="btn danger" @click="remove(p)">{{ t('adminPrizes.delete') }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <div v-if="showForm" class="modal-mask" @click.self="showForm = false">
      <div class="modal">
        <h3>{{ editing ? t('adminPrizes.edit') : t('adminPrizes.add') }}</h3>
        <form class="form" @submit.prevent="save">
          <label class="field">{{ t('adminPrizes.nameZh') }}
            <input v-model="form.name" type="text" />
          </label>
          <label class="field">{{ t('adminPrizes.nameEn') }}
            <input v-model="form.name_en" type="text" class="en-input" />
          </label>
          <label class="field">{{ t('adminPrizes.descZh') }}
            <input v-model="form.description" type="text" />
          </label>
          <label class="field">{{ t('adminPrizes.descEn') }}
            <input v-model="form.description_en" type="text" class="en-input" />
          </label>
          <label class="field">{{ t('adminPrizes.cost') }}
            <input v-model.number="form.points_cost" type="number" min="0" />
          </label>
          <label class="field">{{ t('adminPrizes.weight') }}
            <input v-model.number="form.box_weight" type="number" min="0" />
          </label>
          <label class="field">{{ t('adminPrizes.stock') }}
            <input v-model.number="form.stock" type="number" min="-1" />
          </label>
          <label class="field">{{ t('adminPrizes.sort') }}
            <input v-model.number="form.sort_order" type="number" min="0" />
          </label>
          <label v-if="editing" class="field checkbox">
            <input v-model="form.is_active" type="checkbox" :true-value="1" :false-value="0" />
            {{ t('adminPrizes.active') }}
          </label>
          <label v-if="editing" class="field">{{ t('adminPrizes.image') }}
            <input type="file" accept="image/*" :disabled="uploading" @change="uploadImage" />
            <img v-if="form.image" :src="`/uploads/${form.image}`" class="thumb" alt="" />
          </label>
          <p v-if="!editing" class="hint">{{ t('adminPrizes.imageAfterCreate') }}</p>
          <div class="form-actions">
            <button type="submit" class="btn primary" :disabled="saving">
              {{ saving ? t('adminPrizes.saving') : t('adminPrizes.save') }}
            </button>
            <button type="button" class="btn" @click="showForm = false">{{ t('adminPrizes.cancel') }}</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}
.page-title {
  font-size: 22px;
}
.error {
  color: #c0392b;
  font-size: 14px;
  margin-bottom: 16px;
}
.hint {
  color: var(--color-text-light);
  font-size: 13px;
}
.card {
  background: var(--color-card);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 20px 24px;
}
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
.table th,
.table td {
  text-align: left;
  padding: 10px 8px;
  border-bottom: 1px solid var(--color-border);
}
.table th {
  color: var(--color-text-light);
  font-weight: 500;
  font-size: 13px;
}
.thumb {
  width: 36px;
  height: 36px;
  object-fit: cover;
  border-radius: 6px;
  vertical-align: middle;
  margin-right: 8px;
}
.badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
}
.badge.enabled {
  background: #e6f6ec;
  color: #1e8e4f;
}
.badge.disabled {
  background: var(--bg-deep);
  color: var(--color-text-light);
}
.actions {
  white-space: nowrap;
}
.btn {
  border: 1px solid var(--color-border);
  background: #fff;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 13px;
  color: var(--color-text);
  cursor: pointer;
  margin-right: 6px;
}
.btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.btn.primary {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}
.btn.primary:disabled {
  opacity: 0.6;
  cursor: default;
}
.btn.danger:hover {
  border-color: #c0392b;
  color: #c0392b;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 24px;
}
.modal {
  background: var(--color-card);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 24px 28px;
  width: 100%;
  max-width: 440px;
  max-height: 85vh;
  overflow-y: auto;
}
.modal h3 {
  margin: 0 0 14px;
  font-size: 17px;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.field {
  display: block;
  font-size: 13px;
  color: var(--color-text-light);
}
.field input:not([type='checkbox']) {
  display: block;
  width: 100%;
  margin-top: 4px;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  font-size: 14px;
  outline: none;
}
.field input:focus {
  border-color: var(--color-primary);
}
.field.checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
}
.en-input {
  border-color: #d8cbb9 !important;
  background: #fdfaf5;
}
.form-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
</style>
```

- [ ] **Step 2: 新建 `web/src/views/admin/AdminPrizeRecordsView.vue`**

```vue
<script setup>
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../../api';

const { t } = useI18n();
const records = ref([]);
const status = ref(''); // '' | 'pending' | 'used' | 'cancelled'
const loading = ref(true);
const error = ref('');
const acting = ref(false);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const q = status.value ? `?status=${status.value}` : '';
    records.value = await api(`/admin/prize-records${q}`, { admin: true });
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function markUsed(r) {
  acting.value = true;
  error.value = '';
  try {
    await api(`/admin/prize-records/${r.id}/use`, { method: 'POST', admin: true });
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    acting.value = false;
  }
}

async function cancel(r) {
  if (!confirm(t('adminPrizeRecords.confirmCancel', { name: r.prize_name, user: r.username, cost: r.points_spent }))) return;
  acting.value = true;
  error.value = '';
  try {
    await api(`/admin/prize-records/${r.id}/cancel`, { method: 'POST', admin: true });
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    acting.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="records-view">
    <div class="head">
      <h2 class="page-title">{{ t('adminPrizeRecords.title') }}</h2>
      <select v-model="status" class="filter" @change="load">
        <option value="">{{ t('adminPrizeRecords.all') }}</option>
        <option value="pending">{{ t('adminPrizeRecords.pending') }}</option>
        <option value="used">{{ t('adminPrizeRecords.used') }}</option>
        <option value="cancelled">{{ t('adminPrizeRecords.cancelled') }}</option>
      </select>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <section class="card">
      <p v-if="loading" class="hint">{{ t('adminPrizeRecords.loading') }}</p>
      <p v-else-if="!records.length" class="hint">{{ t('adminPrizeRecords.empty') }}</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>{{ t('adminPrizeRecords.colUser') }}</th>
            <th>{{ t('adminPrizeRecords.colPrize') }}</th>
            <th>{{ t('adminPrizeRecords.colSource') }}</th>
            <th>{{ t('adminPrizeRecords.colCost') }}</th>
            <th>{{ t('adminPrizeRecords.colStatus') }}</th>
            <th>{{ t('adminPrizeRecords.colTime') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in records" :key="r.id">
            <td>{{ r.username }}</td>
            <td>{{ r.prize_name }}</td>
            <td>{{ r.source === 'box' ? t('adminPrizeRecords.fromBox') : t('adminPrizeRecords.fromRedeem') }}</td>
            <td>{{ r.points_spent }}</td>
            <td>
              <span class="badge" :class="r.status">
                {{ t(`adminPrizeRecords.${r.status}`) }}
              </span>
            </td>
            <td>{{ r.created_at }}</td>
            <td class="actions">
              <template v-if="r.status === 'pending'">
                <button class="btn" :disabled="acting" @click="markUsed(r)">{{ t('adminPrizeRecords.markUsed') }}</button>
                <button class="btn danger" :disabled="acting" @click="cancel(r)">{{ t('adminPrizeRecords.cancel') }}</button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}
.page-title {
  font-size: 22px;
}
.filter {
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  font-size: 14px;
  background: #fff;
}
.error {
  color: #c0392b;
  font-size: 14px;
  margin-bottom: 16px;
}
.hint {
  color: var(--color-text-light);
  font-size: 14px;
}
.card {
  background: var(--color-card);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 20px 24px;
}
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
.table th,
.table td {
  text-align: left;
  padding: 10px 8px;
  border-bottom: 1px solid var(--color-border);
}
.table th {
  color: var(--color-text-light);
  font-weight: 500;
  font-size: 13px;
}
.badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  background: var(--bg-deep);
  color: var(--color-text-light);
}
.badge.pending {
  background: #fdf3e0;
  color: #b9770e;
}
.badge.used {
  background: #e6f6ec;
  color: #1e8e4f;
}
.actions {
  white-space: nowrap;
}
.btn {
  border: 1px solid var(--color-border);
  background: #fff;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 13px;
  color: var(--color-text);
  cursor: pointer;
  margin-right: 6px;
}
.btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.btn.danger:hover {
  border-color: #c0392b;
  color: #c0392b;
}
.btn:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
```

- [ ] **Step 3: `AdminLayout.vue` 导航加两项**

`navItems` computed 改为：

```js
const navItems = computed(() => [
  { to: localize('/admin/photos'), label: t('admin.photos') },
  { to: localize('/admin/diaries'), label: t('admin.diaries') },
  { to: localize('/admin/diary-categories'), label: t('admin.categories') },
  { to: localize('/admin/music'), label: t('admin.music') },
  { to: localize('/admin/reminders'), label: t('admin.reminders') },
  { to: localize('/admin/messages'), label: t('admin.messages') },
  { to: localize('/admin/prizes'), label: t('admin.prizes') },
  { to: localize('/admin/prize-records'), label: t('admin.prizeRecords') },
  { to: localize('/admin/users'), label: t('admin.users') },
  { to: localize('/admin/settings'), label: t('admin.settings') },
]);
```

- [ ] **Step 4: `SettingsView.vue` 加签到设置区块**

script 部分：在 `const defaultRecipient = ref('');` 之后加：

```js
const checkinBase = ref('10');
const checkinBonus = ref('5');
const checkinMax = ref('40');
const boxCost = ref('100');
```

在 `loadSettings()` 的 try 块末尾（`defaultRecipient.value = ...` 之后）加：

```js
    const ck = await api('/admin/checkin-settings', { admin: true });
    checkinBase.value = ck.checkin_base_points;
    checkinBonus.value = ck.checkin_streak_bonus;
    checkinMax.value = ck.checkin_max_points;
    boxCost.value = ck.box_cost;
```

在 `savePasscode` 函数之后加：

```js
async function saveCheckin() {
  saving.value = true;
  error.value = '';
  success.value = '';
  try {
    await api('/admin/checkin-settings', {
      method: 'PUT',
      admin: true,
      body: {
        checkin_base_points: Number(checkinBase.value),
        checkin_streak_bonus: Number(checkinBonus.value),
        checkin_max_points: Number(checkinMax.value),
        box_cost: Number(boxCost.value),
      },
    });
    success.value = t('adminSettings.checkinSaved');
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}
```

模板部分：在 SMTP `</section>` 之后（`</template>` 之前）加：

```vue
      <section class="card">
        <h3>{{ t('adminSettings.checkin') }}</h3>
        <form class="form" @submit.prevent="saveCheckin">
          <label class="field">
            {{ t('adminSettings.checkinBase') }}
            <input v-model="checkinBase" type="number" min="1" />
          </label>
          <label class="field">
            {{ t('adminSettings.checkinBonus') }}
            <input v-model="checkinBonus" type="number" min="1" />
          </label>
          <label class="field">
            {{ t('adminSettings.checkinMax') }}
            <input v-model="checkinMax" type="number" min="1" />
          </label>
          <label class="field">
            {{ t('adminSettings.boxCost') }}
            <input v-model="boxCost" type="number" min="1" />
          </label>
          <button type="submit" class="submit-btn" :disabled="saving">
            {{ saving ? t('adminSettings.saving') : t('adminSettings.save') }}
          </button>
        </form>
      </section>
```

- [ ] **Step 5: i18n 加 key（zh.js 与 en.js）**

zh.js：`admin` 区块加 `prizes: '奖品管理',` 和 `prizeRecords: '核销记录',`；`adminSettings` 区块加：

```js
    checkin: '签到设置',
    checkinBase: '基础积分（第 1 天）',
    checkinBonus: '连击每日递增',
    checkinMax: '每日积分上限',
    boxCost: '盲盒单次价格',
    checkinSaved: '签到设置已保存',
```

zh.js 新增两个区块（放在 `adminUsers` 之后）：

```js
  adminPrizes: {
    title: '奖品管理',
    add: '新增奖品',
    edit: '编辑',
    delete: '删除',
    save: '保存',
    saving: '保存中…',
    cancel: '取消',
    loading: '加载中…',
    empty: '还没有奖品，点右上角新增',
    nameRequired: '奖品名必填',
    confirmDelete: '确定删除「{name}」吗？已有中奖/兑换记录的奖品会改为下架。',
    colName: '奖品',
    colCost: '兑换价',
    colWeight: '盲盒权重',
    colStock: '库存',
    colStatus: '状态',
    unlimited: '无限',
    active: '上架',
    inactive: '下架',
    nameZh: '名称（中文）',
    nameEn: '名称（英文）',
    descZh: '描述（中文）',
    descEn: '描述（英文）',
    cost: '兑换价（0 = 不可直接兑换）',
    weight: '盲盒权重（0 = 不进盲盒池）',
    stock: '库存（-1 = 无限）',
    sort: '排序（小的在前）',
    image: '图片',
    imageAfterCreate: '保存后可编辑奖品上传图片',
  },
  adminPrizeRecords: {
    title: '核销记录',
    all: '全部状态',
    pending: '待核销',
    used: '已核销',
    cancelled: '已取消',
    loading: '加载中…',
    empty: '暂无记录',
    colUser: '用户',
    colPrize: '奖品',
    colSource: '来源',
    colCost: '花费积分',
    colStatus: '状态',
    colTime: '时间',
    fromBox: '盲盒',
    fromRedeem: '兑换',
    markUsed: '核销',
    cancel: '取消并退分',
    confirmCancel: '确定取消「{name}」（用户 {user}）并退还 {cost} 积分吗？',
  },
```

en.js：`admin` 区块加 `prizes: 'Prizes',` 和 `prizeRecords: 'Redemptions',`；`adminSettings` 区块加：

```js
    checkin: 'Check-in Settings',
    checkinBase: 'Base points (day 1)',
    checkinBonus: 'Daily streak bonus',
    checkinMax: 'Daily points cap',
    boxCost: 'Mystery box price',
    checkinSaved: 'Check-in settings saved',
```

en.js 新增：

```js
  adminPrizes: {
    title: 'Prize Management',
    add: 'Add Prize',
    edit: 'Edit',
    delete: 'Delete',
    save: 'Save',
    saving: 'Saving…',
    cancel: 'Cancel',
    loading: 'Loading…',
    empty: 'No prizes yet — add one from the top right',
    nameRequired: 'Prize name is required',
    confirmDelete: 'Delete "{name}"? Prizes with existing records will be deactivated instead.',
    colName: 'Prize',
    colCost: 'Cost',
    colWeight: 'Box weight',
    colStock: 'Stock',
    colStatus: 'Status',
    unlimited: '∞',
    active: 'Active',
    inactive: 'Inactive',
    nameZh: 'Name (Chinese)',
    nameEn: 'Name (English)',
    descZh: 'Description (Chinese)',
    descEn: 'Description (English)',
    cost: 'Redeem cost (0 = not redeemable)',
    weight: 'Box weight (0 = not in box pool)',
    stock: 'Stock (-1 = unlimited)',
    sort: 'Sort order (asc)',
    image: 'Image',
    imageAfterCreate: 'Save first, then edit to upload an image',
  },
  adminPrizeRecords: {
    title: 'Redemption Records',
    all: 'All statuses',
    pending: 'Pending',
    used: 'Used',
    cancelled: 'Cancelled',
    loading: 'Loading…',
    empty: 'No records',
    colUser: 'User',
    colPrize: 'Prize',
    colSource: 'Source',
    colCost: 'Points',
    colStatus: 'Status',
    colTime: 'Time',
    fromBox: 'Box',
    fromRedeem: 'Redeemed',
    markUsed: 'Mark used',
    cancel: 'Cancel & refund',
    confirmCancel: 'Cancel "{name}" (user {user}) and refund {cost} points?',
  },
```

- [ ] **Step 6: 校验 i18n + 构建**

Run: `node web/scripts/check-i18n-keys.mjs && cd web && npm run build`
Expected: 均无报错（若 Task 7/8 建了空壳组件，此步应被真实组件替换后通过）

- [ ] **Step 7: Commit**

```bash
git add web/src
git commit -m "feat: 后台奖品管理/核销记录页与签到设置"
```

---

### Task 10: 端到端验证

**Files:** 无新增代码。

- [ ] **Step 1: 全量测试**

Run: `cd worker && npm test`
Expected: 全部 PASS（存量 + users-auth 5 + checkin 6 + box-redeem 8 + my-prizes 3 + admin-prizes 6）

- [ ] **Step 2: 构建前端**

Run: `cd web && npm run build`
Expected: 构建成功

- [ ] **Step 3: 本地端到端手测**

1. 终端 A：`cd worker && npm run migrate:local && npm run dev`（8787）
2. 终端 B：`cd web && npm run dev`（5173，/api 代理到 8787）
3. 浏览器验证清单：
   - 后台（`/zh/admin`）登录 → 设置页能看到并保存"签到设置"
   - 后台新增奖品：一个可兑换（如「按摩券」200 分、库存 5），一个仅盲盒（如「神秘礼物」权重 1、库存 -1），上传图片
   - 前台过口令 → 登录页注册账号 → 自动进入 `/zh/points`
   - 签到：按钮变"今日已签到"，积分增加
   - 后台把盲盒价改成当前余额可承受的值（或直接改库加积分）→ 抽盲盒出结果弹窗 → 我的奖品出现 pending 记录
   - 兑换奖品 → 积分扣减、商城库存减 1
   - 我的奖品点"使用"→ 状态变已使用
   - 后台核销记录页：看到记录，测试"取消并退分"→ 积分退回
   - 英文语言切换各页面文案正常

- [ ] **Step 4: 部署提示（不执行，告知用户）**

生产迁移需用户手动执行：`cd worker && npm run migrate:apply`（remote）。前端 + Pages Functions 随 Pages CI 自动部署。

- [ ] **Step 5: Commit（如有验证中的修复）**

```bash
git add -A
git commit -m "fix: 签到积分系统端到端验证修复"
```
