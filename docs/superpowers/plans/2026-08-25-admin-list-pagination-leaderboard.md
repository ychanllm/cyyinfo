# 管理列表分页搜索 + 热门相册统计口径 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 管理后台的相册/相册内照片/菜品/日记列表加分页与搜索(后端带参返回分页对象、不带参保持旧数组),排行榜热门相册并入其下照片的点赞与浏览。

**Architecture:** 后端把 `public.ts` 内部的 `parsePagination` 抽到 `worker/src/pagination.ts` 并新增 `searchFilter`,admin 四个列表端点按"带参分页、不带参兼容"模式改造;前端新增共享组件 `AdminListBar.vue`(搜索框+页码条)接入三个管理视图;排行榜相册榜 SQL 增加照片统计子查询(模式与日记榜并入留言赞一致)。

**Tech Stack:** worker/ Hono + D1(SQLite)+ Vitest(cloudflare:test);web/ Vue 3 + vue-i18n(仅 zh)。

## Global Constraints

- 规格文档:`docs/superpowers/specs/2026-08-25-admin-list-pagination-leaderboard-design.md`,实现必须与其一致。
- 兼容契约:四个 admin 列表端点**不带 `page`/`size` 参数时必须保持旧的返回结构**(`/admin/albums`、`/admin/dishes`、`/admin/diaries` 返回数组;`/admin/albums/:id` 的 `photos` 是数组)。带参返回 `{ items, total, page, size }`。
- 分页参数:`page` 从 1 开始,`size` 默认 20、上限 100;`q` 为 LIKE 模糊搜索,必须转义 `%`/`_`/`\` 并配 `ESCAPE '\'`。
- 搜索字段:相册 `title`+`title_en`;照片 `caption`+`caption_en`;菜品 `d.name`+`d.description`;日记 `d.title`+`d.title_en`。
- 排行榜:`score = likes*5 + views` 公式不变,只把相册的 likes/views 换成"相册自身 + 其下 hidden=0 照片"的合计口径;排除 hidden 照片;前端 `LeaderboardView.vue` 不改。
- 测试共享同一 D1,各测试文件用自己的数据前缀(本计划统一用 `分页测`/`榜测`)并在 afterAll 清理。
- 两空格缩进、保留分号;前端无测试框架,验证为 `cd web && npm run build`。
- 后端全量验证:`cd worker && npm test`(串行)。

---

### Task 1: 分页/搜索工具抽取 + admin 相册列表分页搜索

**Files:**
- Create: `worker/src/pagination.ts`
- Modify: `worker/src/routes/public.ts`(删除内部 parsePagination,改 import)
- Modify: `worker/src/routes/admin.ts:229-232`(GET /admin/albums)
- Test: `worker/test/photos.test.ts`(追加 describe)

**Interfaces:**
- Produces:
  - `parsePagination(c, defaultSize, maxSize)` → `{ page, size, offset, requested }`(`requested` = 调用方显式传了 page 或 size)
  - `searchFilter(c, columns: string[])` → `{ where: string, args: string[] }`,`where` 以 ` AND (...)` 开头或为空串
  - 后续 Task 2/3/4 都 import 这两个函数;Task 6 前端依赖 `/admin/albums?page=&size=&q=` 返回 `{ items, total, page, size }`。

- [ ] **Step 1: 写失败测试**

在 `worker/test/photos.test.ts` 末尾追加(若文件顶部没有 `adminToken` 的 import 则补上,并仿照文件现有方式构造 admin 请求头):

```ts
describe('admin 相册列表分页与搜索', () => {
  const albumIds: number[] = [];
  const adminHeaders = async () => ({ Authorization: `Bearer ${await adminToken()}` });

  beforeAll(async () => {
    for (let i = 1; i <= 25; i++) {
      const r = await env.DB.prepare('INSERT INTO albums (title, title_en, sort_order) VALUES (?, ?, ?)')
        .bind(`分页测相册${String(i).padStart(2, '0')}`, `PageTest Album ${i}`, 1000 + i).run();
      albumIds.push(Number(r.meta.last_row_id));
    }
  });

  afterAll(async () => {
    await env.DB.prepare(`DELETE FROM albums WHERE id IN (${albumIds.join(',')})`).run();
  });

  it('不带参数时保持旧的数组返回(兼容)', async () => {
    const res = await SELF.fetch('http://x/api/admin/albums', { headers: await adminHeaders() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown;
    expect(Array.isArray(body)).toBe(true);
  });

  it('带 page/size 返回 {items,total,page,size},q 过滤', async () => {
    const res = await SELF.fetch('http://x/api/admin/albums?page=2&size=10&q=%E5%88%86%E9%A1%B5%E6%B5%8B%E7%9B%B8%E5%86%8C', { headers: await adminHeaders() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.total).toBe(25);
    expect(body.page).toBe(2);
    expect(body.size).toBe(10);
    expect(body.items).toHaveLength(10);
    expect(body.items[0].title).toBe('分页测相册11');
    expect(body.items.every((a: any) => a.title.startsWith('分页测相册'))).toBe(true);
  });

  it('q 匹配 title_en;特殊字符 % 被转义不匹配', async () => {
    const en = await SELF.fetch('http://x/api/admin/albums?q=PageTest%20Album%207', { headers: await adminHeaders() });
    // 只带 q 不带分页参数 → 仍是数组
    const enBody = (await en.json()) as any[];
    expect(Array.isArray(enBody)).toBe(true);
    expect(enBody).toHaveLength(1);
    expect(enBody[0].title).toBe('分页测相册07');

    const pct = await SELF.fetch('http://x/api/admin/albums?page=1&q=%25', { headers: await adminHeaders() });
    const pctBody = (await pct.json()) as any;
    expect(pctBody.total).toBe(0);
    expect(pctBody.items).toHaveLength(0);
  });
});
```

(注意 `%E5%88%86...` 是 `分页测相册` 的 URL 编码;直接写中文 query 也可以,保持与文件现有风格一致即可。)

- [ ] **Step 2: 跑测试确认失败**

Run: `cd worker && npx vitest run test/photos.test.ts`
Expected: FAIL —— 新 describe 中"带 page/size 返回分页对象"等断言失败(当前接口永远返回数组)。

- [ ] **Step 3: 创建 `worker/src/pagination.ts`**

```ts
// 列表分页参数解析:page 从 1 开始,非法值回退默认;size 超限封顶
// requested 表示调用方显式传了 page/size —— 用于"带参分页、不带参保持旧返回结构"的兼容契约
export function parsePagination(
  c: { req: { query: (k: string) => string | undefined } },
  defaultSize: number,
  maxSize: number,
) {
  const pageRaw = c.req.query('page');
  const sizeRaw = c.req.query('size');
  const pageValue = Number(pageRaw);
  const sizeValue = Number(sizeRaw);
  const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const size = Number.isSafeInteger(sizeValue) && sizeValue > 0
    ? Math.min(sizeValue, maxSize)
    : defaultSize;
  return { page, size, offset: (page - 1) * size, requested: pageRaw !== undefined || sizeRaw !== undefined };
}

// 模糊搜索:多列 OR LIKE,%/_/反斜杠转义,配 ESCAPE '\' 防止注入通配符
// 返回以 AND 开头的 WHERE 片段(无 q 时为空串)和绑定参数
export function searchFilter(
  c: { req: { query: (k: string) => string | undefined } },
  columns: string[],
) {
  const q = c.req.query('q')?.trim();
  if (!q) return { where: '', args: [] as string[] };
  const escaped = q.replace(/[\\%_]/g, (m) => `\\${m}`);
  const where = ` AND (${columns.map((col) => `${col} LIKE ? ESCAPE '\\'`).join(' OR ')})`;
  return { where, args: columns.map(() => `%${escaped}%`) };
}
```

- [ ] **Step 4: `public.ts` 改为 import(纯重构,行为不变)**

删除 `public.ts:16-26` 的内部 `parsePagination` 定义,在文件顶部 import 区加:

```ts
import { parsePagination } from '../pagination';
```

- [ ] **Step 5: 改 `admin.ts` 的 GET /admin/albums(229-232 行)**

把:

```ts
admin.get('/albums', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM albums ORDER BY sort_order, id').all();
  return c.json(results);
});
```

替换为(并在 admin.ts 顶部 import 区加 `import { parsePagination, searchFilter } from '../pagination';`):

```ts
admin.get('/albums', async (c) => {
  const pagination = parsePagination(c, 20, 100);
  const search = searchFilter(c, ['title', 'title_en']);
  const base = `FROM albums WHERE 1=1${search.where}`;
  if (!pagination.requested) {
    const { results } = await c.env.DB.prepare(`SELECT * ${base} ORDER BY sort_order, id`)
      .bind(...search.args).all();
    return c.json(results);
  }
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n ${base}`)
    .bind(...search.args).first<{ n: number }>();
  const { results } = await c.env.DB.prepare(`SELECT * ${base} ORDER BY sort_order, id LIMIT ? OFFSET ?`)
    .bind(...search.args, pagination.size, pagination.offset).all();
  return c.json({ items: results, total: total?.n ?? 0, page: pagination.page, size: pagination.size });
});
```

- [ ] **Step 6: 跑测试确认通过**

Run: `cd worker && npx vitest run test/photos.test.ts`
Expected: PASS(新 describe 全过,且文件内既有用例不红 —— public.ts 重构无行为变化)
再跑: `cd worker && npm test`
Expected: 全绿。

- [ ] **Step 7: Commit**

```bash
git add worker/src/pagination.ts worker/src/routes/public.ts worker/src/routes/admin.ts worker/test/photos.test.ts
git commit -m "feat(admin): 相册列表支持分页与搜索,抽取 parsePagination/searchFilter 共享工具"
```

---

### Task 2: admin 相册内照片分页搜索

**Files:**
- Modify: `worker/src/routes/admin.ts:277-285`(GET /admin/albums/:id)
- Test: `worker/test/photos.test.ts`(追加 describe)

**Interfaces:**
- Consumes: Task 1 的 `parsePagination`、`searchFilter`。
- Produces: `/admin/albums/:id?page=&size=&q=` → `{ ...album, photos: { items, total, page, size } }`;不带参保持 `photos` 为数组。Task 6 前端依赖。

- [ ] **Step 1: 写失败测试**

`worker/test/photos.test.ts` 末尾追加:

```ts
describe('admin 相册内照片分页与搜索', () => {
  let albumId = 0;
  const photoIds: number[] = [];
  const adminHeaders = async () => ({ Authorization: `Bearer ${await adminToken()}` });

  beforeAll(async () => {
    const a = await env.DB.prepare("INSERT INTO albums (title, sort_order) VALUES ('分页测照片册', 2000)").run();
    albumId = Number(a.meta.last_row_id);
    for (let i = 1; i <= 15; i++) {
      const r = await env.DB.prepare("INSERT INTO photos (album_id, filename, caption, sort_order) VALUES (?, ?, ?, ?)")
        .bind(albumId, `pgt/${i}.jpg`, `分页测照片${String(i).padStart(2, '0')}`, i).run();
      photoIds.push(Number(r.meta.last_row_id));
    }
    const other = await env.DB.prepare("INSERT INTO photos (album_id, filename, caption, sort_order) VALUES (?, 'pgt/x.jpg', '无关照片', 100)")
      .bind(albumId).run();
    photoIds.push(Number(other.meta.last_row_id));
  });

  afterAll(async () => {
    await env.DB.prepare(`DELETE FROM albums WHERE id = ${albumId}`).run(); // photos 随 CASCADE 删除
  });

  it('不带参数 photos 仍是数组(兼容)', async () => {
    const res = await SELF.fetch(`http://x/api/admin/albums/${albumId}`, { headers: await adminHeaders() });
    const body = (await res.json()) as any;
    expect(Array.isArray(body.photos)).toBe(true);
    expect(body.photos).toHaveLength(16);
  });

  it('带 page/size/q 时 photos 是分页对象', async () => {
    const res = await SELF.fetch(`http://x/api/admin/albums/${albumId}?page=2&size=10&q=${encodeURIComponent('分页测照片')}`, { headers: await adminHeaders() });
    const body = (await res.json()) as any;
    expect(body.title).toBe('分页测照片册');
    expect(body.photos.total).toBe(15);
    expect(body.photos.page).toBe(2);
    expect(body.photos.items).toHaveLength(5);
    expect(body.photos.items[0].caption).toBe('分页测照片11');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd worker && npx vitest run test/photos.test.ts`
Expected: FAIL —— "带 page/size/q 时 photos 是分页对象"失败。

- [ ] **Step 3: 改 `admin.ts` 的 GET /admin/albums/:id(277-285 行)**

把:

```ts
admin.get('/albums/:id', async (c) => {
  const album = await c.env.DB.prepare('SELECT * FROM albums WHERE id = ?')
    .bind(c.req.param('id')).first();
  if (!album) return c.json({ detail: '相册不存在' }, 404);
  const { results: photos } = await c.env.DB.prepare(
    'SELECT id, filename, caption, caption_en, taken_at, sort_order, hidden FROM photos WHERE album_id = ? ORDER BY sort_order, id'
  ).bind(c.req.param('id')).all();
  return c.json({ ...album, photos });
});
```

替换为:

```ts
admin.get('/albums/:id', async (c) => {
  const album = await c.env.DB.prepare('SELECT * FROM albums WHERE id = ?')
    .bind(c.req.param('id')).first();
  if (!album) return c.json({ detail: '相册不存在' }, 404);
  const pagination = parsePagination(c, 20, 100);
  const search = searchFilter(c, ['caption', 'caption_en']);
  const cols = 'id, filename, caption, caption_en, taken_at, sort_order, hidden';
  const base = `FROM photos WHERE album_id = ?${search.where}`;
  if (!pagination.requested) {
    const { results: photos } = await c.env.DB.prepare(
      `SELECT ${cols} ${base} ORDER BY sort_order, id`
    ).bind(c.req.param('id'), ...search.args).all();
    return c.json({ ...album, photos });
  }
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n ${base}`)
    .bind(c.req.param('id'), ...search.args).first<{ n: number }>();
  const { results: items } = await c.env.DB.prepare(
    `SELECT ${cols} ${base} ORDER BY sort_order, id LIMIT ? OFFSET ?`
  ).bind(c.req.param('id'), ...search.args, pagination.size, pagination.offset).all();
  return c.json({ ...album, photos: { items, total: total?.n ?? 0, page: pagination.page, size: pagination.size } });
});
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd worker && npx vitest run test/photos.test.ts` → PASS;`cd worker && npm test` → 全绿。

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/admin.ts worker/test/photos.test.ts
git commit -m "feat(admin): 相册内照片列表支持分页与搜索"
```

---

### Task 3: admin 菜品分页搜索

**Files:**
- Modify: `worker/src/routes/dishes.ts:133-152`(adminDishes GET /)
- Test: `worker/test/dishes.test.ts`(追加 describe)

**Interfaces:**
- Consumes: Task 1 的 `parsePagination`、`searchFilter`。
- Produces: `/admin/dishes?page=&size=&q=` → `{ items, total, page, size }`,items 元素仍含 `want_count`、`want_usernames`、`created_by_username`;不带参保持数组返回。分页时 `want_usernames` 只覆盖当前页菜品。Task 6 前端依赖。

- [ ] **Step 1: 写失败测试**

`worker/test/dishes.test.ts` 末尾追加(复用文件顶部的 `adminAuth`、`alice`、`bob`、`userAuth`;该文件 beforeAll 已清空 dishes/dish_wants):

```ts
describe('admin 菜品分页与搜索', () => {
  const dishIds: number[] = [];

  beforeAll(async () => {
    // 先清掉本文件前面用例留下的菜品和想吃,保证计数可控
    await env.DB.prepare('DELETE FROM dish_wants').run();
    await env.DB.prepare('DELETE FROM dishes').run();
    for (let i = 1; i <= 25; i++) {
      const r = await env.DB.prepare("INSERT INTO dishes (name, description) VALUES (?, ?)")
        .bind(`分页测菜${String(i).padStart(2, '0')}`, i === 1 ? '招牌描述' : '').run();
      dishIds.push(Number(r.meta.last_row_id));
    }
  });

  it('不带参数保持数组返回(兼容)', async () => {
    const res = await SELF.fetch('http://x/api/admin/dishes', { headers: await adminAuth() });
    const body = (await res.json()) as unknown;
    expect(Array.isArray(body)).toBe(true);
  });

  it('分页:total/items/page/size 正确,按 id DESC', async () => {
    const res = await SELF.fetch(`http://x/api/admin/dishes?page=2&size=10&q=${encodeURIComponent('分页测菜')}`, { headers: await adminAuth() });
    const body = (await res.json()) as any;
    expect(body.total).toBe(25);
    expect(body.items).toHaveLength(10);
    expect(body.items[0].name).toBe('分页测菜15'); // id DESC:25..16 是第 1 页,15..6 是第 2 页
    expect(body.items[9].name).toBe('分页测菜06');
  });

  it('搜索匹配描述;want_usernames 只含当前页菜品', async () => {
    // alice 想吃第 1 道,bob 想吃第 2 道
    await SELF.fetch(`http://x/api/dishes/${dishIds[0]}/want`, { method: 'POST', headers: userAuth(alice) });
    await SELF.fetch(`http://x/api/dishes/${dishIds[1]}/want`, { method: 'POST', headers: userAuth(bob) });

    const res = await SELF.fetch(`http://x/api/admin/dishes?q=${encodeURIComponent('招牌描述')}`, { headers: await adminAuth() });
    const body = (await res.json()) as any[];
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe('分页测菜01');
    expect(body[0].want_usernames).toEqual(['dishes_alice']);

    // 分页形态同样只带当前页的 want_usernames
    const paged = await SELF.fetch(`http://x/api/admin/dishes?page=1&size=1&q=${encodeURIComponent('分页测菜02')}`, { headers: await adminAuth() });
    const pagedBody = (await paged.json()) as any;
    expect(pagedBody.items[0].want_usernames).toEqual(['dishes_bob']);
  });
});
```

注意:不清 afterAll(文件末尾的 afterAll 已统一清 dishes/dish_wants)。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd worker && npx vitest run test/dishes.test.ts`
Expected: FAIL —— 分页相关断言失败。

- [ ] **Step 3: 改 `dishes.ts` 的 adminDishes GET /(133-152 行)**

顶部 import 区加 `import { parsePagination, searchFilter } from '../pagination';`,然后把整个 handler 替换为:

```ts
// 全部菜品（含下架）：want_count + 想吃用户名明细 + 投稿人；带 page/size 时分页返回
adminDishes.get('/', async (c) => {
  const db = c.env.DB;
  const pagination = parsePagination(c, 20, 100);
  const search = searchFilter(c, ['d.name', 'd.description']);
  const base = `FROM dishes d LEFT JOIN users u ON u.id = d.created_by_user_id WHERE 1=1${search.where}`;
  const select = `SELECT d.*, u.username AS created_by_username,
                  (SELECT COUNT(*) FROM dish_wants w WHERE w.dish_id = d.id) AS want_count
                  ${base} ORDER BY d.id DESC`;
  type Row = DishRow & { created_by_username: string | null; want_count: number };
  let rows: Row[];
  let meta: { total: number; page: number; size: number } | null = null;
  if (pagination.requested) {
    const total = await db.prepare(`SELECT COUNT(*) AS n ${base}`)
      .bind(...search.args).first<{ n: number }>();
    rows = (await db.prepare(`${select} LIMIT ? OFFSET ?`)
      .bind(...search.args, pagination.size, pagination.offset).all<Row>()).results;
    meta = { total: total?.n ?? 0, page: pagination.page, size: pagination.size };
  } else {
    rows = (await db.prepare(select).bind(...search.args).all<Row>()).results;
  }
  // 想吃明细只查当前结果集,避免全量扫 dish_wants
  const wantMap = new Map<number, string[]>();
  if (rows.length) {
    const ids = rows.map((d) => d.id);
    const { results: wants } = await db.prepare(
      `SELECT w.dish_id, u.username FROM dish_wants w JOIN users u ON u.id = w.user_id
       WHERE w.dish_id IN (${ids.map(() => '?').join(',')}) ORDER BY w.id`
    ).bind(...ids).all<{ dish_id: number; username: string }>();
    for (const w of wants) {
      const list = wantMap.get(w.dish_id) ?? [];
      list.push(w.username);
      wantMap.set(w.dish_id, list);
    }
  }
  const items = rows.map((d) => ({ ...d, want_usernames: wantMap.get(d.id) ?? [] }));
  return meta ? c.json({ items, ...meta }) : c.json(items);
});
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd worker && npx vitest run test/dishes.test.ts` → PASS;`cd worker && npm test` → 全绿。

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/dishes.ts worker/test/dishes.test.ts
git commit -m "feat(admin): 菜品列表支持分页与搜索,want 明细只查当前页"
```

---

### Task 4: admin 日记分页搜索

**Files:**
- Modify: `worker/src/routes/admin.ts:345-352`(GET /admin/diaries)
- Test: `worker/test/diaries.test.ts`(追加 describe)

**Interfaces:**
- Consumes: Task 1 的 `parsePagination`、`searchFilter`。
- Produces: `/admin/diaries?page=&size=&q=` → `{ items, total, page, size }`;不带参保持数组返回。Task 6 前端依赖。

- [ ] **Step 1: 写失败测试**

`worker/test/diaries.test.ts` 末尾追加(仿照文件现有方式拿 admin 请求头;`admin_users` id=1 已由 `adminToken()` 首次登录创建,若文件尚未调用过则先 `await adminToken()`):

```ts
describe('admin 日记分页与搜索', () => {
  const diaryIds: number[] = [];

  beforeAll(async () => {
    await adminToken(); // 确保 author_id=1 的 admin_users 记录存在
    for (let i = 1; i <= 25; i++) {
      const r = await env.DB.prepare("INSERT INTO diaries (author_id, title, status) VALUES (1, ?, 'draft')")
        .bind(`分页测日记${String(i).padStart(2, '0')}`).run();
      diaryIds.push(Number(r.meta.last_row_id));
    }
  });

  afterAll(async () => {
    await env.DB.prepare(`DELETE FROM diaries WHERE id IN (${diaryIds.join(',')})`).run();
  });

  it('不带参数保持数组返回(兼容)', async () => {
    const headers = { Authorization: `Bearer ${await adminToken()}` };
    const body = (await (await SELF.fetch('http://x/api/admin/diaries', { headers })).json()) as unknown;
    expect(Array.isArray(body)).toBe(true);
  });

  it('带 page/size/q 返回分页对象,按 id DESC', async () => {
    const headers = { Authorization: `Bearer ${await adminToken()}` };
    const res = await SELF.fetch(`http://x/api/admin/diaries?page=1&size=10&q=${encodeURIComponent('分页测日记')}`, { headers });
    const body = (await res.json()) as any;
    expect(body.total).toBe(25);
    expect(body.items).toHaveLength(10);
    expect(body.items[0].title).toBe('分页测日记25');
    expect(body.items[9].title).toBe('分页测日记16');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd worker && npx vitest run test/diaries.test.ts`
Expected: FAIL —— 分页断言失败。

- [ ] **Step 3: 改 `admin.ts` 的 GET /admin/diaries(345-352 行)**

把:

```ts
admin.get('/diaries', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT d.id, d.title, d.title_en, d.slug, d.status, d.cover_filename, d.published_at, d.created_at, d.updated_at,
            c.id AS category_id, c.name AS category_name
     FROM diaries d LEFT JOIN diary_categories c ON c.id = d.category_id ORDER BY d.id DESC`
  ).all();
  return c.json(results);
});
```

替换为:

```ts
admin.get('/diaries', async (c) => {
  const pagination = parsePagination(c, 20, 100);
  const search = searchFilter(c, ['d.title', 'd.title_en']);
  const base = `FROM diaries d LEFT JOIN diary_categories c ON c.id = d.category_id WHERE 1=1${search.where}`;
  const cols = `d.id, d.title, d.title_en, d.slug, d.status, d.cover_filename, d.published_at, d.created_at, d.updated_at,
                c.id AS category_id, c.name AS category_name`;
  if (!pagination.requested) {
    const { results } = await c.env.DB.prepare(`SELECT ${cols} ${base} ORDER BY d.id DESC`)
      .bind(...search.args).all();
    return c.json(results);
  }
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n ${base}`)
    .bind(...search.args).first<{ n: number }>();
  const { results } = await c.env.DB.prepare(`SELECT ${cols} ${base} ORDER BY d.id DESC LIMIT ? OFFSET ?`)
    .bind(...search.args, pagination.size, pagination.offset).all();
  return c.json({ items: results, total: total?.n ?? 0, page: pagination.page, size: pagination.size });
});
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd worker && npx vitest run test/diaries.test.ts` → PASS;`cd worker && npm test` → 全绿。

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/admin.ts worker/test/diaries.test.ts
git commit -m "feat(admin): 日记列表支持分页与搜索"
```

---

### Task 5: 排行榜相册榜并入照片的赞与浏览

**Files:**
- Modify: `worker/src/routes/public.ts:268-275`(leaderboard 相册榜查询)
- Test: `worker/test/leaderboard.test.ts`(改 1 个旧用例 + 加 hidden 排除用例)

**Interfaces:**
- Produces: `/api/leaderboard` 的 `albums` 元素 `views`/`likes`/`score` 变为"相册自身 + 其下 hidden=0 照片"合计口径;字段名不变,前端不改。

- [ ] **Step 1: 改测试(先红)**

`worker/test/leaderboard.test.ts`:

(a) `beforeAll` 中,在照片 p2 插入之后追加一张隐藏照片(有点赞有浏览,但不应并入相册榜):

```ts
  // 隐藏照片:有浏览有点赞,但相册榜不应并入
  const p3 = await env.DB.prepare("INSERT INTO photos (album_id, filename, caption, hidden) VALUES (?, 'lb/hidden.jpg', '榜测隐藏照片', 1)").bind(albumA).run();
  photoHidden = Number(p3.meta.last_row_id);
```

文件顶部声明区加 `let photoHidden = 0;`。

在浏览/点赞造数区追加:

```ts
  await postView('photo', photoHidden);
  await postView('photo', photoHidden);
  await toggleLike('photo', photoHidden);
```

`afterAll` 的 targets 数组加 `['photo', photoHidden],`。

(b) 把旧用例 `'相册榜：按 score（赞*5 + 浏览）降序，含双语标题与 views/likes/score'` 整个替换为:

```ts
  it('相册榜：照片(非隐藏)的赞和浏览并入相册合计,hidden 照片排除', async () => {
    const res = await SELF.fetch('http://x/api/leaderboard');
    expect(res.status).toBe(200);
    const board = (await res.json()) as any;
    const albums = board.albums.filter((x: any) => [albumA, albumB, albumIdle].includes(x.id));

    // 相册甲:自身 0 赞 + 照片乙 1 赞 = 1 赞(隐藏照片的 1 赞排除);
    // 自身 1 浏览 + 照片甲 2 + 照片乙 1 = 4 浏览(隐藏照片的 2 浏览排除);score = 1*5+4 = 9
    const aa = albums.find((x: any) => x.id === albumA);
    expect(aa.likes).toBe(1);
    expect(aa.views).toBe(4);
    expect(aa.score).toBe(9);
    expect(aa.title).toBe('榜测相册甲');
    expect(aa.title_en).toBe('LB Album A');

    // 相册乙:自身 1 赞,无照片;views ≥ 1(「浏览量上报」用例会再加,不断言精确值)
    const ab = albums.find((x: any) => x.id === albumB);
    expect(ab.likes).toBe(1);
    expect(ab.views).toBeGreaterThanOrEqual(1);
    expect(ab.score).toBe(ab.likes * 5 + ab.views);

    // 相册甲 9 分,相册乙 5+views(浏览量上报只再加 2 次 → 最高 8 分),甲排乙前;闲置相册不上榜
    expect(albums.map((x: any) => x.id)).toEqual([albumA, albumB]);
    expect(board.albums.some((x: any) => x.id === albumIdle)).toBe(false);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd worker && npx vitest run test/leaderboard.test.ts`
Expected: FAIL —— 相册甲 likes/views/score 断言失败(当前不计照片)。

- [ ] **Step 3: 改 `public.ts` 相册榜查询**

把 270-275 行的相册榜查询:

```ts
  const { results: albums } = await db.prepare(
    `SELECT t.id, t.title, t.title_en,
            COALESCE(v.views, 0) AS views, COALESCE(l.likes, 0) AS likes,
            COALESCE(l.likes, 0) * 5 + COALESCE(v.views, 0) AS score
     FROM albums t ${LEADERBOARD_STATS} ${LEADERBOARD_TAIL}`
  ).bind('album', 'album').all();
```

替换为(不再复用 LEADERBOARD_STATS/TAIL,因为要多一个照片统计 JOIN;照片榜、日记榜保持原样):

```ts
  // 相册榜:并入其下非隐藏照片的赞与浏览(口径与照片榜一致,排除 hidden)
  const { results: albums } = await db.prepare(
    `SELECT t.id, t.title, t.title_en,
            COALESCE(v.views, 0) + COALESCE(ps.photo_views, 0) AS views,
            COALESCE(l.likes, 0) + COALESCE(ps.photo_likes, 0) AS likes,
            (COALESCE(l.likes, 0) + COALESCE(ps.photo_likes, 0)) * 5
              + COALESCE(v.views, 0) + COALESCE(ps.photo_views, 0) AS score
     FROM albums t
     LEFT JOIN (SELECT target_id, count AS views FROM view_counts WHERE target_type = 'album') v ON v.target_id = t.id
     LEFT JOIN (SELECT target_id, COALESCE(SUM(count), 0) AS likes FROM likes WHERE target_type = 'album' GROUP BY target_id) l ON l.target_id = t.id
     LEFT JOIN (
       SELECT p.album_id,
              COALESCE(SUM(pl.cnt), 0) AS photo_likes,
              COALESCE(SUM(pv.cnt), 0) AS photo_views
       FROM photos p
       LEFT JOIN (SELECT target_id, SUM(count) AS cnt FROM likes WHERE target_type = 'photo' GROUP BY target_id) pl ON pl.target_id = p.id
       LEFT JOIN (SELECT target_id, count AS cnt FROM view_counts WHERE target_type = 'photo') pv ON pv.target_id = p.id
       WHERE p.hidden = 0
       GROUP BY p.album_id
     ) ps ON ps.album_id = t.id
     WHERE COALESCE(v.views, 0) + COALESCE(l.likes, 0) + COALESCE(ps.photo_views, 0) + COALESCE(ps.photo_likes, 0) > 0
     ORDER BY score DESC, t.id ASC LIMIT 10`
  ).all();
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd worker && npx vitest run test/leaderboard.test.ts` → PASS;`cd worker && npm test` → 全绿。

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/public.ts worker/test/leaderboard.test.ts
git commit -m "feat: 热门相册统计并入其下照片的点赞与浏览(排除隐藏照片)"
```

---

### Task 6: 前端 AdminListBar 组件 + 三视图接入

**Files:**
- Create: `web/src/components/AdminListBar.vue`
- Modify: `web/src/views/admin/PhotosView.vue`
- Modify: `web/src/views/admin/DishesView.vue`
- Modify: `web/src/views/admin/DiariesView.vue`
- Modify: `web/src/i18n/zh.js`

**Interfaces:**
- Consumes: Task 1-4 的分页接口(`/admin/albums`、`/admin/albums/:id`、`/admin/dishes`、`/admin/diaries`,带参返回 `{ items, total, page, size }`)。
- Produces: `AdminListBar.vue` 的 props `{ total: Number, page: Number, size: Number }`,events `search(q: string)`、`page(p: number)`。

- [ ] **Step 1: 创建 `web/src/components/AdminListBar.vue`**

```vue
<script setup>
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps({
  total: { type: Number, default: 0 },
  page: { type: Number, default: 1 },
  size: { type: Number, default: 20 },
});
const emit = defineEmits(['search', 'page']);
const { t } = useI18n();

const keyword = ref('');
let timer = null;
// 300ms 防抖,输入停顿后才发搜索;由父组件决定页码归零
watch(keyword, (v) => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => emit('search', v.trim()), 300);
});

const pages = computed(() => Math.max(1, Math.ceil(props.total / props.size)));

// 页码窗口:≤7 页全显;否则头尾 + 当前页 ±1,断档处用 0 渲染省略号
const pageList = computed(() => {
  const n = pages.value;
  const cur = Math.min(props.page, n);
  if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1);
  const set = new Set([1, 2, cur - 1, cur, cur + 1, n - 1, n].filter((p) => p >= 1 && p <= n));
  const arr = [...set].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    if (i > 0 && arr[i] - arr[i - 1] > 1) out.push(0);
    out.push(arr[i]);
  }
  return out;
});

function go(p) {
  if (p >= 1 && p <= pages.value && p !== props.page) emit('page', p);
}
</script>

<template>
  <div class="list-bar">
    <input v-model="keyword" type="text" class="search" :placeholder="t('adminList.searchPh')" />
    <span class="total">{{ t('adminList.total', { n: total }) }}</span>
    <nav v-if="pages > 1" class="pager">
      <button class="pg" :disabled="page <= 1" @click="go(page - 1)">‹</button>
      <button
        v-for="(p, i) in pageList"
        :key="i"
        class="pg"
        :class="{ active: p === page }"
        :disabled="p === 0"
        @click="p !== 0 && go(p)"
      >
        {{ p === 0 ? '…' : p }}
      </button>
      <button class="pg" :disabled="page >= pages" @click="go(page + 1)">›</button>
    </nav>
  </div>
</template>

<style scoped>
.list-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.search {
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  font-size: 14px;
  outline: none;
  width: 200px;
}
.search:focus {
  border-color: var(--color-primary);
}
.total {
  font-size: 13px;
  color: var(--color-text-light);
}
.pager {
  display: flex;
  gap: 4px;
}
.pg {
  min-width: 30px;
  padding: 5px 8px;
  border: 1px solid var(--color-border);
  background: var(--color-card);
  border-radius: 6px;
  font-size: 13px;
  color: var(--color-text);
  cursor: pointer;
}
.pg.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}
.pg:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
```

- [ ] **Step 2: i18n 加文案**

`web/src/i18n/zh.js` 顶层(与 `admin:` 块平级)加:

```js
  adminList: {
    searchPh: '搜索…',
    total: '共 {n} 条',
  },
```

- [ ] **Step 3: 接入 `admin/DishesView.vue`**

script 部分:

- import 加 `import AdminListBar from '../../components/AdminListBar.vue';`
- `const dishes = ref([]);` 下方加:

```js
const page = ref(1);
const size = 20;
const total = ref(0);
const keyword = ref('');
```

- `load()` 的请求行替换为:

```js
    const data = await api(`/admin/dishes?page=${page.value}&size=${size}&q=${encodeURIComponent(keyword.value)}`, { admin: true });
    dishes.value = data.items;
    total.value = data.total;
```

- 加两个 handler:

```js
function onSearch(q) {
  keyword.value = q;
  page.value = 1;
  load();
}

function onPage(p) {
  page.value = p;
  load();
}
```

template 部分:`<p v-if="error" ...>` 之后、`<section class="card">` 之前插入:

```html
    <AdminListBar :total="total" :page="page" :size="20" @search="onSearch" @page="onPage" />
```

- [ ] **Step 4: 接入 `admin/DiariesView.vue`**

与 Step 3 同构:import AdminListBar;加 `page/size/total/keyword`;`loadDiaries()` 请求行改为:

```js
    const data = await api(`/admin/diaries?page=${page.value}&size=${size}&q=${encodeURIComponent(keyword.value)}`, { admin: true });
    diaries.value = data.items;
    total.value = data.total;
```

加 `onSearch`/`onPage`(调 `loadDiaries`);template 在 `<DiaryCategoriesView .../>` 之后、`<section class="card">` 之前插入同样的 `<AdminListBar .../>`。

- [ ] **Step 5: 接入 `admin/PhotosView.vue`(两层)**

script 部分:

- import 加 AdminListBar。
- 相册层:`const albums = ref([]);` 下方加 `albumPage/albumTotal/albumKeyword` 三个 ref(同 Step 3 模式,size=20);`loadAlbums()` 请求行改为带参分页,赋值 `albums.value = data.items; albumTotal.value = data.total;`,加 `onAlbumSearch`/`onAlbumPage`。
- 移动目标需要全量相册:`moveTargets` 不能再依赖分页后的 `albums`。加:

```js
// 移动照片的目标相册用全量列表(不带分页参数走兼容的旧数组返回)
const allAlbums = ref([]);
async function loadAllAlbums() {
  allAlbums.value = await api('/admin/albums', { admin: true });
}
```

`moveTargets` 改为 `computed(() => allAlbums.value.filter((a) => a.id !== current.value?.id))`;`onMounted` 改为同时调 `loadAlbums()` 和 `loadAllAlbums()`;`createAlbum`、`saveAlbum` 成功后补调 `loadAllAlbums()`;`movePhoto`/`setCover` 里 `albums.value.find(...)` 的封面同步逻辑改到 `allAlbums` 上找。
- 照片层:`const photos = ref([]);` 下方加 `photoPage/photoTotal/photoKeyword`;`selectAlbum` 改为:

```js
async function selectAlbum(album) {
  current.value = album;
  photoPage.value = 1;
  photoKeyword.value = '';
  await reloadPhotos();
}

async function reloadPhotos() {
  if (!current.value) return;
  photosLoading.value = true;
  error.value = '';
  try {
    const data = await api(`/admin/albums/${current.value.id}?page=${photoPage.value}&size=20&q=${encodeURIComponent(photoKeyword.value)}`, { admin: true });
    photos.value = data.photos.items;
    photoTotal.value = data.photos.total;
  } catch (e) {
    error.value = e.message;
  } finally {
    photosLoading.value = false;
  }
}

function onPhotoSearch(q) {
  photoKeyword.value = q;
  photoPage.value = 1;
  reloadPhotos();
}

function onPhotoPage(p) {
  photoPage.value = p;
  reloadPhotos();
}
```

(`selectAlbum` 原来自己管理 photosLoading 的代码删掉,统一走 reloadPhotos。)

template 部分:

- 相册列表 card 的 `<h3>{{ t('adminPhotos.albumList') }}</h3>` 之后插入:

```html
      <AdminListBar :total="albumTotal" :page="albumPage" :size="20" @search="onAlbumSearch" @page="onAlbumPage" />
```

- 照片网格 card 的 `<p v-if="photosLoading" ...>` 之前插入:

```html
      <AdminListBar :total="photoTotal" :page="photoPage" :size="20" @search="onPhotoSearch" @page="onPhotoPage" />
```

- [ ] **Step 6: 构建验证**

Run: `cd web && npm run build`
Expected: 构建成功,无报错。

- [ ] **Step 7: 手测(人工,留给用户)**

- 后台素材页照片 Tab:相册列表搜索/翻页;点进相册照片搜索/翻页;移动照片下拉仍是全量相册;caption 自动保存不受影响。
- 想吃页菜品 Tab、素材页日记 Tab:搜索防抖、翻页、总数正确;编辑/上下架后当前页刷新正常。
- 首页排行榜:热门相册的赞/浏览数为含照片的合计。

- [ ] **Step 8: Commit**

```bash
git add web/src/components/AdminListBar.vue web/src/views/admin/PhotosView.vue web/src/views/admin/DishesView.vue web/src/views/admin/DiariesView.vue web/src/i18n/zh.js
git commit -m "feat(admin): 照片/菜品/日记列表接入分页与搜索(共享 AdminListBar)"
```

---

## Self-Review 记录

- **Spec coverage:** 规格 §1 四个接口 → Task 1-4;§1 parsePagination 抽取 → Task 1;§2 AdminListBar + 三视图 + i18n → Task 6;§3 排行榜 → Task 5;§4 测试/验证 → 各任务 Step;§5 不做项未出现在任何任务。
- **Placeholder scan:** 无 TBD/TODO;所有代码步骤含完整代码;Task 6 Step 3/4 为同构改动,均给出了完整替换代码。
- **Type consistency:** 四个接口统一 `{ items, total, page, size }`;`AdminListBar` 的 props/events 定义(Step 1)与三个视图的接入(Step 3-5)一致;`parsePagination`/`searchFilter` 签名在 Task 1 定义,Task 2/3/4 消费一致;前端 size 统一 20,与后端默认 20 对齐。
