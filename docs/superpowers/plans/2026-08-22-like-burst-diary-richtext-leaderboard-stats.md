# 连赞、日记富文本、排行榜定位、后台统计 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 实现抖音式连赞（真计数+飘心特效）、日记 Markdown 内嵌 HTML 富文本（居中插图/颜色/字号）、排行榜点击放大并跳转相册定位、管理后台独立统计页。

**Architecture:** 后端 Cloudflare Worker + Hono + D1 + R2（`worker/`），前端 Vue 3 `<script setup>` + vue-router + vue-i18n（`web/`）。点赞改为一行一记 `count` 累加（上限 50）；日记保持 Markdown 存储，样式靠内嵌 HTML；排行榜复用现有 Lightbox；统计页一个聚合接口 + 一个新页面。

**Tech Stack:** Hono 4, D1 (SQLite), R2, Vue 3, vue-i18n, marked, vitest + @cloudflare/vitest-pool-workers

**Spec:** `docs/superpowers/specs/2026-08-22-like-burst-diary-richtext-leaderboard-stats-design.md`

## Global Constraints

- 每用户每目标点赞上限 **50**；`POST /api/likes/burst` 的 `delta` 限整数 **1–10**，非法返回 400。
- 所有 likes 计数从 `COUNT(*)` 改为 `COALESCE(SUM(count), 0)`；排行榜公式 `score = likes*5 + views` 不变。
- 迁移文件风格：顶部中文注释 + 纯 DDL，顺序编号，下一个是 `0013_like_counts.sql`。
- 后端测试：`cd worker && npm test`（vitest，全部测试共享同一 D1，测试数据用大 id 如 90xx 避免碰撞）。
- 前端无自动化测试，前端任务以手动验证步骤收尾；后端任务必须 TDD（先写失败测试）。
- i18n：所有新文案必须同时加 `web/src/i18n/zh.js` 和 `web/src/i18n/en.js` 的同构 key。
- 提交信息风格参考仓库历史（`git log --oneline`），用中文/英文均可，遵循 conventional 前缀。
- **与 spec 的偏差（已确认）**：`messages` 表无 `user_id` 列，用户维度汇总**不含留言数**；总留言数保留在 overview。

---

### Task 1: likes 表加 count 列 + burst 端点 + SUM 计数

**Files:**
- Create: `worker/migrations/0013_like_counts.sql`
- Modify: `worker/src/routes/likes.ts`
- Modify: `worker/src/routes/public.ts:282`
- Test: `worker/test/likes.test.ts`

**Interfaces:**
- Produces: `POST /api/likes/burst`，body `{target_type: string, target_id: number, delta: number(1-10)}`，返回 `{liked: true, count: number}`（count 为目标总赞数 SUM）。`POST /api/likes/toggle`、`GET /api/likes`、`GET /api/likes/batch` 响应结构不变，仅计数口径变为 SUM(count)。

- [x] **Step 1: 写迁移文件**

创建 `worker/migrations/0013_like_counts.sql`：

```sql
-- worker/migrations/0013_like_counts.sql
-- 连赞：同一用户对同一目标可累加多个赞（每行 count 累加，上限 50 由后端控制），计数改用 SUM(count)
ALTER TABLE likes ADD COLUMN count INTEGER NOT NULL DEFAULT 1;
```

- [x] **Step 2: 写失败测试**

在 `worker/test/likes.test.ts` 末尾的 `describe('点赞', ...)` 块**内**（最后一个 `it` 之后）追加：

```ts
  const burst = (user: { token: string }, target_type: string, target_id: number, delta: number) =>
    SELF.fetch('http://x/api/likes/burst', {
      method: 'POST',
      headers: auth(user),
      body: JSON.stringify({ target_type, target_id, delta }),
    });

  it('burst：首次创建行并累加，计数为 SUM(count)', async () => {
    let res = await burst(alice, 'diary', 9100, 3);
    expect(res.status).toBe(200);
    expect(await res.json() as any).toEqual({ liked: true, count: 3 });

    res = await burst(alice, 'diary', 9100, 5);
    expect(await res.json() as any).toEqual({ liked: true, count: 8 });

    // 另一用户累加同一目标
    res = await burst(bob, 'diary', 9100, 2);
    expect(await res.json() as any).toEqual({ liked: true, count: 10 });

    const get = await SELF.fetch('http://x/api/likes?target_type=diary&target_id=9100', { headers: auth(alice) });
    expect(await get.json() as any).toEqual({ count: 10, liked: true });

    const batch = await SELF.fetch('http://x/api/likes/batch?target_type=diary&ids=9100', { headers: auth(bob) });
    expect(await batch.json() as any).toEqual({ '9100': { count: 10, liked: true } });

    await toggle(alice, 'diary', 9100); // 清理（删 alice 行，剩 bob 的 2）
    const after = await SELF.fetch('http://x/api/likes?target_type=diary&target_id=9100');
    expect((await after.json() as any).count).toBe(2);
    await toggle(bob, 'diary', 9100);
  });

  it('burst：delta 非法返回 400，未登录 401', async () => {
    expect((await burst(alice, 'diary', 9101, 0)).status).toBe(400);
    expect((await burst(alice, 'diary', 9101, 11)).status).toBe(400);
    expect((await burst(alice, 'diary', 9101, 1.5)).status).toBe(400);
    expect((await burst(alice, 'song', 9101, 1)).status).toBe(400);
    const anon = await SELF.fetch('http://x/api/likes/burst', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_type: 'diary', target_id: 9101, delta: 1 }),
    });
    expect(anon.status).toBe(401);
  });

  it('burst：单用户上限 50 钳制', async () => {
    for (let i = 0; i < 6; i++) await burst(alice, 'photo', 9102, 10); // 60 > 50
    const get = await SELF.fetch('http://x/api/likes?target_type=photo&target_id=9102', { headers: auth(alice) });
    const data = await get.json() as any;
    expect(data).toEqual({ count: 50, liked: true });
    await toggle(alice, 'photo', 9102); // 清理
    const cleaned = await SELF.fetch('http://x/api/likes?target_type=photo&target_id=9102');
    expect((await cleaned.json() as any).count).toBe(0);
  });
```

- [x] **Step 3: 跑测试确认失败**

Run: `cd worker && npm test -- test/likes.test.ts`
Expected: FAIL（新用例报 404 或计数不符）

- [x] **Step 4: 实现 burst + SUM 计数**

`worker/src/routes/likes.ts`：

1. `countOf` 改为：

```ts
async function countOf(db: D1Database, type: string, id: number): Promise<number> {
  const row = await db.prepare('SELECT COALESCE(SUM(count), 0) AS n FROM likes WHERE target_type = ? AND target_id = ?')
    .bind(type, id).first<{ n: number }>();
  return row?.n ?? 0;
}
```

2. 文件顶部常量后加：

```ts
const MAX_PER_USER = 50; // 单用户单目标连赞上限
const MAX_DELTA = 10;    // 单次 burst 最大增量
```

3. 在 `/toggle` 路由之后新增：

```ts
// 连赞：同一用户可累加多个赞（需登录用户），单用户单目标上限 50
likes.post('/burst', userAuth, async (c) => {
  const me = c.get('user') as { id: number };
  const body = await c.req.json<{ target_type?: string; target_id?: number; delta?: number }>().catch(() => ({}));
  const target = parseTarget(body.target_type, body.target_id);
  if (!target) return c.json({ detail: '非法点赞目标' }, 400);
  const delta = body.delta;
  if (typeof delta !== 'number' || !Number.isInteger(delta) || delta < 1 || delta > MAX_DELTA) {
    return c.json({ detail: '非法 delta' }, 400);
  }
  const db = c.env.DB;
  await db.prepare(
    `INSERT INTO likes (user_id, target_type, target_id, count) VALUES (?, ?, ?, MIN(?, ?))
     ON CONFLICT(user_id, target_type, target_id) DO UPDATE SET count = MIN(count + ?, ?)`
  ).bind(me.id, target.type, target.id, delta, MAX_PER_USER, delta, MAX_PER_USER).run();
  return c.json({ liked: true, count: await countOf(db, target.type, target.id) });
});
```

4. `/batch` 里的计数 SQL 改为：

```ts
    `SELECT target_id, COALESCE(SUM(count), 0) AS n FROM likes WHERE target_type = ? AND target_id IN (${placeholders}) GROUP BY target_id`
```

`/toggle` 不动（DELETE 即撤回全部；INSERT 走 DEFAULT count=1）。

`worker/src/routes/public.ts:282` 的 `LEADERBOARD_STATS` 改为：

```ts
const LEADERBOARD_STATS = `
  LEFT JOIN (SELECT target_id, count AS views FROM view_counts WHERE target_type = ?) v ON v.target_id = t.id
  LEFT JOIN (SELECT target_id, COALESCE(SUM(count), 0) AS likes FROM likes WHERE target_type = ? GROUP BY target_id) l ON l.target_id = t.id`;
```

- [x] **Step 5: 跑全部后端测试确认通过**

Run: `cd worker && npm test`
Expected: PASS（含既有 likes/leaderboard 用例）

- [x] **Step 6: 本地应用迁移**

Run: `cd worker && npm run migrate:local`
Expected: 输出含 `0013_like_counts.sql` 已应用

- [x] **Step 7: Commit**

```bash
git add worker/migrations/0013_like_counts.sql worker/src/routes/likes.ts worker/src/routes/public.ts worker/test/likes.test.ts
git commit -m "feat(likes): 连赞 burst 端点与 count 累加（上限 50），计数改 SUM"
```

---

### Task 2: LikeButton 连击 + 飘心特效 + 长按取消

**Files:**
- Modify: `web/src/components/LikeButton.vue`（整体替换）
- Modify: `web/src/i18n/zh.js`、`web/src/i18n/en.js`（likes 组加 key）

**Interfaces:**
- Consumes: Task 1 的 `POST /api/likes/burst`（`{target_type, target_id, delta}` → `{liked, count}`）。
- Produces: 组件 props/emit 完全不变（`{targetType, targetId, count, liked}`，emit `update` 回传 `{liked, count}`），所有使用点（AlbumsView、AlbumDetailView、Lightbox、DiariesView、DiaryDetailView、MessageBoard）零改动。

- [x] **Step 1: 加 i18n key**

`web/src/i18n/zh.js` 的 `likes` 组（约 :94-98）改为：

```js
  likes: {
    like: '赞',
    liked: '已赞',
    loginToLike: '登录后即可点赞',
    max: '最多只能赞 50 下哦',
    unlikeAll: '长按取消全部赞',
  },
```

`web/src/i18n/en.js` 对应 `likes` 组加：`max: 'Up to 50 likes per person',`、`unlikeAll: 'Long-press to remove all your likes',`（保留原有 like/liked/loginToLike）。

- [x] **Step 2: 整体替换 LikeButton.vue**

```vue
<script setup>
import { ref, onUnmounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api, getUserToken } from '../api';
import { localize } from '../i18n';

const { t } = useI18n();
const router = useRouter();
const route = useRoute();

const props = defineProps({
  targetType: { type: String, required: true }, // 'album' | 'photo' | 'diary' | 'message'
  targetId: { type: Number, required: true },
  count: { type: Number, default: 0 },
  liked: { type: Boolean, default: false },
});
const emit = defineEmits(['update']); // ({ liked, count })

const MAX_TAPS = 50;       // 与后端 MAX_PER_USER 一致（前端按本次会话点按次数钳制）
const FLUSH_MS = 300;      // 连点聚合发送间隔
const LONG_PRESS_MS = 500; // 长按判定

const busy = ref(false);   // 仅长按取消时用
const pop = ref(false);    // 点赞成功的小弹跳动画
const maxTip = ref(false); // 达上限提示

// 飘心粒子
const hearts = ref([]); // [{ id, x, drift, rot }]
let heartSeq = 0;

// 连击聚合
const taps = ref(0);        // 本次会话已点次数（用于上限提示）
const pendingDelta = ref(0);
let flushTimer = null;
let flushing = false;

function spawnHeart(x) {
  const id = ++heartSeq;
  hearts.value.push({
    id,
    x, // 相对按钮的点击横坐标 px
    drift: (Math.random() * 2 - 1) * 24,          // 上飘时随机左右偏移
    rot: (Math.random() * 2 - 1) * 30,            // 随机旋转
  });
  setTimeout(() => {
    hearts.value = hearts.value.filter((h) => h.id !== id);
  }, 800);
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, FLUSH_MS);
}

async function flush() {
  if (flushing) { scheduleFlush(); return; }
  const delta = pendingDelta.value;
  if (!delta) return;
  pendingDelta.value = 0;
  flushing = true;
  try {
    const data = await api('/likes/burst', {
      method: 'POST',
      body: { target_type: props.targetType, target_id: props.targetId, delta },
    });
    emit('update', data); // 服务端权威计数（含他人点赞与上限钳制）
  } catch {
    // 失败回滚乐观增量
    emit('update', { liked: props.liked, count: Math.max(0, props.count - delta) });
  } finally {
    flushing = false;
    if (pendingDelta.value) scheduleFlush();
  }
}

function tap(x) {
  // 未登录：去登录页，登录后回跳当前页（沿用项目 redirect 惯例）
  if (!getUserToken()) {
    router.push({ path: localize('/login'), query: { redirect: route.fullPath } });
    return;
  }
  if (taps.value >= MAX_TAPS) {
    maxTip.value = true;
    setTimeout(() => { maxTip.value = false; }, 1500);
    return;
  }
  taps.value += 1;
  pendingDelta.value += 1;
  spawnHeart(x);
  pop.value = true;
  setTimeout(() => { pop.value = false; }, 400);
  emit('update', { liked: true, count: props.count + 1 }); // 乐观更新
  scheduleFlush();
}

// 点按 / 长按区分：pointerdown 起 500ms 内松开 = 点按(+1)；超过 = 长按(取消全部)
let pressTimer = null;
let longPressed = false;

function onPointerDown() {
  longPressed = false;
  pressTimer = setTimeout(() => {
    longPressed = true;
    cancelAll();
  }, LONG_PRESS_MS);
}
function onPointerUp(e) {
  clearTimeout(pressTimer);
  pressTimer = null;
  if (!longPressed) tap(e.offsetX ?? 14);
}
function onPointerCancel() {
  clearTimeout(pressTimer);
  pressTimer = null;
}

async function cancelAll() {
  if (busy.value || !getUserToken() || !props.liked) return;
  busy.value = true;
  pendingDelta.value = 0; // 丢弃未发送的连点
  try {
    const data = await api('/likes/toggle', {
      method: 'POST',
      body: { target_type: props.targetType, target_id: props.targetId },
    });
    taps.value = 0;
    emit('update', data);
  } catch { /* 错误已由 api.js 统一处理 */ } finally {
    busy.value = false;
  }
}

onUnmounted(() => {
  clearTimeout(pressTimer);
  clearTimeout(flushTimer);
});
</script>

<template>
  <button
    type="button"
    class="like-btn"
    :class="{ liked, pop }"
    :disabled="busy"
    :title="getUserToken() ? (liked ? t('likes.unlikeAll') : t('likes.like')) : t('likes.loginToLike')"
    @pointerdown.stop.prevent="onPointerDown"
    @pointerup.stop.prevent="onPointerUp"
    @pointerleave="onPointerCancel"
    @pointercancel="onPointerCancel"
    @contextmenu.prevent
  >
    <span class="heart">{{ liked ? '♥' : '♡' }}</span>
    <span v-if="count" class="n">{{ count }}</span>
    <span
      v-for="h in hearts"
      :key="h.id"
      class="fly-heart"
      :style="{ left: `${h.x}px`, '--drift': `${h.drift}px`, '--rot': `${h.rot}deg` }"
    >♥</span>
    <span v-if="maxTip" class="max-tip">{{ t('likes.max') }}</span>
  </button>
</template>

<style scoped>
.like-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-card);
  color: var(--color-text-light);
  font-size: 13px;
  line-height: 1.4;
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s;
  user-select: none;
  -webkit-user-select: none;
  touch-action: manipulation; /* 禁双击缩放，保证连击手感 */
}
.like-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.like-btn.liked {
  border-color: var(--color-primary);
  color: var(--color-stamp);
}
.heart {
  font-size: 15px;
  line-height: 1;
}
.like-btn.pop .heart {
  animation: like-pop 0.4s ease;
}
@keyframes like-pop {
  0% { transform: scale(1); }
  40% { transform: scale(1.45); }
  70% { transform: scale(0.9); }
  100% { transform: scale(1); }
}
.like-btn:disabled {
  cursor: default;
}
.fly-heart {
  position: absolute;
  bottom: 100%;
  margin-left: -8px;
  color: var(--color-stamp);
  font-size: 16px;
  pointer-events: none;
  animation: heart-fly 0.8s ease-out forwards;
}
@keyframes heart-fly {
  0% { opacity: 1; transform: translate(0, 0) scale(0.6) rotate(0deg); }
  60% { opacity: 1; }
  100% { opacity: 0; transform: translate(var(--drift), -56px) scale(1.2) rotate(var(--rot)); }
}
.max-tip {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
  background: rgba(30, 24, 18, 0.85);
  color: #f3ece2;
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 6px;
  pointer-events: none;
}
</style>
```

- [x] **Step 3: 手动验证**

Run: `cd worker && npm run dev`（另开终端 `cd web && npm run dev`），浏览器开 `http://localhost:5173`：

- 未登录点击 → 跳登录页（行为不变）
- 登录后单击 → +1 并飘心；快速连点 5 下 → 计数 +5、飘 5 颗心、网络面板约 1 次 burst 请求（delta=5）
- 连点到 50 → 出现上限提示
- 长按 ≥0.5s → 赞清零、心变空心
- 留言板/相册/日记各处的点赞按钮均正常

- [x] **Step 4: Commit**

```bash
git add web/src/components/LikeButton.vue web/src/i18n/zh.js web/src/i18n/en.js
git commit -m "feat(likes): 前端连击飘心特效，点按+1、长按取消全部"
```

---

### Task 3: 日记正文图片上传 API

**Files:**
- Modify: `worker/src/routes/admin.ts`（在 `/diaries/:id/cover` 路由后追加，约 :418）
- Test: `worker/test/diaries.test.ts`

**Interfaces:**
- Produces: `POST /api/admin/diaries/:id/images`（admin token，multipart 字段名 `file`），成功返回 `{url: "/uploads/diary/<uuid>.<ext>"}`；日记不存在 404，缺文件/类型不合法 400，未授权 401。Task 4 依赖此接口。

- [x] **Step 1: 写失败测试**

在 `worker/test/diaries.test.ts` 追加新 describe（文件末尾，仿照文件内既有创建日记的写法——若已有建日记 helper 则复用）：

```ts
describe('日记正文图片', () => {
  it('上传成功返回 /uploads/diary/ url；非图片 400；未授权 401；不存在 404', async () => {
    const token = await adminToken();
    const authH = { Authorization: `Bearer ${token}` };
    // 建一篇日记
    const create = await SELF.fetch('http://x/api/admin/diaries', {
      method: 'POST',
      headers: { ...authH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '插图测试' }),
    });
    const { id } = await create.json() as any;

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const form = new FormData();
    form.append('file', new File([png], 'a.png', { type: 'image/png' }));
    const up = await SELF.fetch(`http://x/api/admin/diaries/${id}/images`, { method: 'POST', headers: authH, body: form });
    expect(up.status).toBe(200);
    const { url } = await up.json() as any;
    expect(url).toMatch(/^\/uploads\/diary\/.+\.png$/);

    // 文件可访问
    const img = await SELF.fetch(`http://x${url}`);
    expect(img.status).toBe(200);

    // 非图片
    const bad = new FormData();
    bad.append('file', new File(['hello'], 'a.txt', { type: 'text/plain' }));
    const badRes = await SELF.fetch(`http://x/api/admin/diaries/${id}/images`, { method: 'POST', headers: authH, body: bad });
    expect(badRes.status).toBe(400);

    // 未授权
    const anon = await SELF.fetch(`http://x/api/admin/diaries/${id}/images`, { method: 'POST', body: form });
    expect(anon.status).toBe(401);

    // 日记不存在
    const form2 = new FormData();
    form2.append('file', new File([png], 'b.png', { type: 'image/png' }));
    const missing = await SELF.fetch('http://x/api/admin/diaries/999999/images', { method: 'POST', headers: authH, body: form2 });
    expect(missing.status).toBe(404);
  });
});
```

（若文件顶部未导入 `adminToken`，在 `import { applyMigrations, ... } from './helpers'` 中补上。）

- [x] **Step 2: 跑测试确认失败**

Run: `cd worker && npm test -- test/diaries.test.ts`
Expected: FAIL（404/405，路由不存在）

- [x] **Step 3: 实现路由**

`worker/src/routes/admin.ts` 在 `admin.post('/diaries/:id/cover', ...)` 块之后插入：

```ts
// 日记正文插图：存 R2 diary/ 前缀，返回可直接写进 markdown 的 url（不落库，正文保存时自然包含）
admin.post('/diaries/:id/images', async (c) => {
  const exists = await c.env.DB.prepare('SELECT id FROM diaries WHERE id = ?').bind(c.req.param('id')).first();
  if (!exists) return c.json({ detail: '日记不存在' }, 404);
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) return c.json({ detail: '缺少文件' }, 400);
  const { key, error } = await saveUpload(c.env, file, 'image', 'diary');
  if (error) return c.json({ detail: error }, 400);
  return c.json({ url: `/uploads/${key}` });
});
```

- [x] **Step 4: 跑测试确认通过**

Run: `cd worker && npm test -- test/diaries.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add worker/src/routes/admin.ts worker/test/diaries.test.ts
git commit -m "feat(diaries): 正文图片上传接口 POST /admin/diaries/:id/images"
```

---

### Task 4: 日记编辑器工具栏（插图 / 颜色 / 字号）

**Files:**
- Modify: `web/src/views/admin/DiaryEditView.vue`
- Modify: `web/src/i18n/zh.js`、`web/src/i18n/en.js`（adminDiaryEdit 组加 key）
- Modify: `web/src/style.css`（`.md-body img` 确认/补 `margin` 居中，约 :113-117）

**Interfaces:**
- Consumes: Task 3 的 `POST /api/admin/diaries/:id/images`。
- Produces: 无对外接口；正文仍存 Markdown 文本，内嵌 `<p align="center"><img></p>` 与 `<span style="...">`。

- [x] **Step 1: 加 i18n key**

`web/src/i18n/zh.js` 的 `adminDiaryEdit` 组内加：

```js
    insertImage: '插入图片',
    textColor: '文字颜色',
    fontSize: '字号',
    colorDefault: '默认',
    sizeDefault: '默认',
    sizeSmall: '小',
    sizeLarge: '大',
    sizeXLarge: '特大',
    selectTextFirst: '请先在正文中选中文字',
    imageEditOnly: '保存草稿后才能插入图片',
```

`web/src/i18n/en.js` 对应加：

```js
    insertImage: 'Insert image',
    textColor: 'Text color',
    fontSize: 'Font size',
    colorDefault: 'Default',
    sizeDefault: 'Default',
    sizeSmall: 'Small',
    sizeLarge: 'Large',
    sizeXLarge: 'X-Large',
    selectTextFirst: 'Select some text in the content first',
    imageEditOnly: 'Save a draft before inserting images',
```

- [x] **Step 2: style.css 确认图片居中**

读 `web/src/style.css` 的 `.md-body img`（约 :113-117）。若已有 `margin-left/right: auto` 或 `margin: ... auto` 则不动；否则补为：

```css
.md-body img {
  max-width: 100%;
  border-radius: 8px;
  display: block;
  margin: 1em auto;
}
```

- [x] **Step 3: DiaryEditView.vue 加工具栏**

`<script setup>` 顶部 import 不变。在 `uploadCover` 函数后追加：

```ts
// ---- 正文工具栏：插图 / 颜色 / 字号（内嵌 HTML，marked 透传）----
const taZh = ref(null);
const taEn = ref(null);
const imageInput = ref(null);

const TEXT_COLORS = [
  { key: 'colorDefault', value: '' },
  { key: '红', value: '#c0392b' },
  { key: '橙', value: '#e67e22' },
  { key: '蓝', value: '#2980b9' },
  { key: '绿', value: '#1e8e4f' },
  { key: '紫', value: '#8e44ad' },
];
const FONT_SIZES = [
  { key: 'sizeDefault', value: '' },
  { key: 'sizeSmall', value: '0.85em' },
  { key: 'sizeLarge', value: '1.25em' },
  { key: 'sizeXLarge', value: '1.5em' },
];

function activeTa() {
  return (contentLang.value === 'en' ? taEn.value : taZh.value);
}
function activeModel() {
  return contentLang.value === 'en' ? contentEn : content;
}

// 在光标处插入文本（插图用）
function insertAtCursor(text) {
  const ta = activeTa();
  const model = activeModel();
  if (!ta) { model.value += text; return; }
  const s = ta.selectionStart ?? model.value.length;
  model.value = model.value.slice(0, s) + text + model.value.slice(s);
}

// 选中文字包裹 <span style="...">（颜色/字号用）
function wrapSelection(style) {
  const ta = activeTa();
  const model = activeModel();
  const s = ta?.selectionStart ?? 0;
  const e = ta?.selectionEnd ?? 0;
  if (!ta || s === e) {
    error.value = t('adminDiaryEdit.selectTextFirst');
    setTimeout(() => { if (error.value === t('adminDiaryEdit.selectTextFirst')) error.value = ''; }, 2000);
    return;
  }
  const sel = model.value.slice(s, e);
  model.value = model.value.slice(0, s) + `<span style="${style}">${sel}</span>` + model.value.slice(e);
}

function pickColor(event) {
  const value = event.target.value;
  event.target.value = '';
  if (!value) return; // 「默认」不包 span，保持原文
  wrapSelection(`color:${value}`);
}
function pickSize(event) {
  const value = event.target.value;
  event.target.value = '';
  if (!value) return;
  wrapSelection(`font-size:${value}`);
}

function triggerImage() {
  if (!isEdit.value) {
    error.value = t('adminDiaryEdit.imageEditOnly');
    setTimeout(() => { if (error.value === t('adminDiaryEdit.imageEditOnly')) error.value = ''; }, 2000);
    return;
  }
  imageInput.value?.click();
}

async function uploadInlineImage(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file || !isEdit.value) return;
  uploading.value = true;
  error.value = '';
  try {
    const form = new FormData();
    form.append('file', file);
    const r = await apiUpload(`/admin/diaries/${diaryId.value}/images`, form);
    insertAtCursor(`\n<p align="center"><img src="${r.url}" alt=""></p>\n`);
  } catch (e) {
    error.value = e.message;
  } finally {
    uploading.value = false;
  }
}
```

模板：两个 `<textarea>` 加 ref（`ref="taZh"`、`ref="taEn"`），并在 `content-head` 的 `lang-tabs` 前插入工具栏：

```html
          <div class="content-head">
            <span class="label">{{ t('adminDiaryEdit.content') }}</span>
            <div class="editor-tools">
              <button type="button" class="tool-btn" :disabled="uploading" @click="triggerImage">
                {{ uploading ? t('adminDiaryEdit.uploading') : t('adminDiaryEdit.insertImage') }}
              </button>
              <select class="tool-select" :title="t('adminDiaryEdit.textColor')" @change="pickColor">
                <option value="">{{ t('adminDiaryEdit.textColor') }}</option>
                <option v-for="c in TEXT_COLORS.slice(1)" :key="c.value" :value="c.value">{{ c.key }}</option>
              </select>
              <select class="tool-select" :title="t('adminDiaryEdit.fontSize')" @change="pickSize">
                <option value="">{{ t('adminDiaryEdit.fontSize') }}</option>
                <option v-for="s in FONT_SIZES.slice(1)" :key="s.value" :value="s.value">{{ t(`adminDiaryEdit.${s.key}`) }}</option>
              </select>
              <input ref="imageInput" type="file" accept="image/*" class="file-input" @change="uploadInlineImage" />
            </div>
            <div class="lang-tabs">
              ...
            </div>
          </div>
```

（lang-tabs 两个按钮保持原样，此处 `...` 仅表示省略展示，实际代码保留原内容。）

样式追加到 `<style scoped>`：

```css
.editor-tools {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  margin-right: 8px;
}
.tool-btn,
.tool-select {
  border: 1px solid var(--color-border);
  background: #fff;
  border-radius: 6px;
  padding: 2px 10px;
  font-size: 12px;
  color: var(--color-text-light);
  cursor: pointer;
}
.tool-btn:hover,
.tool-select:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
```

- [x] **Step 4: 手动验证**

`npm run dev`（worker + web），登录后台编辑一篇日记：

- 选中文字 → 选颜色/字号 → textarea 出现 `<span style="...">`，右侧预览即时生效
- 未选中文字点颜色 → 提示「请先在正文中选中文字」
- 插入图片 → 光标处出现 `<p align="center"><img ...></p>`，预览居中显示
- 发布后前台日记详情页图片居中、颜色字号生效；划线评论在含 span 的段落上仍能选中高亮
- 新建（未保存）状态点插入图片 → 提示先保存草稿

- [x] **Step 5: Commit**

```bash
git add web/src/views/admin/DiaryEditView.vue web/src/i18n/zh.js web/src/i18n/en.js web/src/style.css
git commit -m "feat(diaries): 编辑器工具栏——居中插图、文字颜色与字号"
```

---

### Task 5: 排行榜灯箱放大 + 灯箱跳转 + 相册定位

**Files:**
- Modify: `web/src/components/Lightbox.vue`（加可选 prop `albumLink`）
- Modify: `web/src/views/LeaderboardView.vue`（照片榜点击开灯箱）
- Modify: `web/src/views/AlbumDetailView.vue`（`?photo=` 定位）
- Modify: `web/src/i18n/zh.js`、`web/src/i18n/en.js`（lightbox 组加 key）

**Interfaces:**
- Produces: `Lightbox` 新可选 prop `albumLink: (photo) => string`（vue-router path）；不传则不显示跳转按钮，现有用法零影响。相册定位 URL 格式：`/:lang/albums/:albumId?photo=<photoId>`。

- [x] **Step 1: 加 i18n key**

`zh.js` 的 `lightbox` 组（约 :89-93）加：`viewInAlbum: '在相册中查看',`；`en.js` 对应加：`viewInAlbum: 'View in album',`。

- [x] **Step 2: Lightbox.vue 加 albumLink prop**

script 中 props 改为：

```js
const props = defineProps({
  photos: { type: Array, default: () => [] }, // [{ id, filename, caption }]
  albumLink: { type: Function, default: null }, // (photo) => path，传了显示「在相册中查看」
});
```

模板 `<figure class="stage">` 内、`<LikeButton>` 后加：

```html
      <router-link
        v-if="albumLink && current?.album_id"
        class="album-link"
        :to="albumLink(current)"
      >{{ t('lightbox.viewInAlbum') }}</router-link>
```

样式追加：

```css
.album-link {
  color: #f3ece2;
  font-size: 13px;
  padding: 4px 14px;
  border: 1px solid rgba(243, 236, 226, 0.4);
  border-radius: 999px;
  text-decoration: none;
}
.album-link:hover {
  background: rgba(255, 253, 249, 0.12);
}
```

- [x] **Step 3: LeaderboardView.vue 照片榜改灯箱**

script 改动：

```js
import Lightbox from '../components/Lightbox.vue';
// ...
// 照片榜：点击缩略图页内灯箱放大；灯箱内可跳转到相册对应照片
const lightboxIndex = ref(null);
const boardPhotos = computed(() => board.value?.photos ?? []);
const photoAlbumLink = (p) => localize(`/albums/${p.album_id}?photo=${p.id}`);
```

删除不再用的 `photoLink`（:20）。模板照片榜 `<li>` 改为：

```html
          <li v-for="(p, i) in board.photos" :key="p.id">
            <button type="button" class="item item-btn" @click="lightboxIndex = i">
              <span class="rank" :class="{ medal: i < 3 }">{{ rankLabel(i) }}</span>
              <img :src="`/uploads/${p.filename}`" :alt="pickCaption(p)" class="thumb" loading="lazy" />
              <span class="name">{{ pickCaption(p) }}</span>
              <span class="stats">
                <span class="stat" :title="t('ranking.views')">👁 {{ p.views }}</span>
                <span class="stat" :title="t('ranking.likes')">♥ {{ p.likes }}</span>
              </span>
            </button>
          </li>
```

`</div>`（boards 结束）前加：

```html
      <Lightbox :photos="boardPhotos" v-model:index="lightboxIndex" :album-link="photoAlbumLink" />
```

样式追加（让 button 复用 .item 外观）：

```css
.item-btn {
  width: 100%;
  border: none;
  background: none;
  cursor: pointer;
  text-align: left;
  font: inherit;
}
```

相册榜、日记榜保持 `<router-link>` 不变（日记榜 `diaryLink` 已跳 `/:lang/diaries/:slugOrId`，满足需求）。

- [x] **Step 4: AlbumDetailView.vue 支持 ?photo= 定位**

script 中 `import { ref, onMounted, onUnmounted, watch } from 'vue'` 改为加 `nextTick`：

```js
import { ref, nextTick, onMounted, onUnmounted, watch } from 'vue';
```

`load()` 成功后（`loadLikes();` 之后）调用定位函数，并新增：

```ts
// 从排行榜跳入：?photo=<id> 直接定位到对应拍立得（instant，不播平滑动画）
async function locateFromQuery() {
  const pid = Number(route.query.photo);
  if (!pid || !album.value?.photos?.length) return;
  const i = album.value.photos.findIndex((p) => p.id === pid);
  if (i < 0) return; // 照片已删除/不在本相册：忽略参数
  activeIndex.value = i;
  await nextTick();
  carouselEl.value?.children[i]?.scrollIntoView({ behavior: 'auto', inline: 'center' });
}
```

`load()` 的 try 块内 `loadLikes();` 后加一行 `locateFromQuery();`。

- [x] **Step 5: 手动验证**

- 排行榜页点照片缩略图 → 灯箱放大，左右切换正常，有点赞按钮
- 灯箱点「在相册中查看」→ 跳到相册页且直接定位到该照片（计数器显示正确序号）
- 灯箱 Esc/关闭正常；不传 albumLink 的相册页灯箱不显示跳转按钮
- `?photo=99999`（不存在的 id）→ 正常停在第一张
- 日记榜点击 → 日记详情页

- [x] **Step 6: Commit**

```bash
git add web/src/components/Lightbox.vue web/src/views/LeaderboardView.vue web/src/views/AlbumDetailView.vue web/src/i18n/zh.js web/src/i18n/en.js
git commit -m "feat(leaderboard): 照片榜灯箱放大，可跳转相册定位到对应照片"
```

---

### Task 6: 后台统计 API

**Files:**
- Modify: `worker/src/routes/admin.ts`（文件尾部 `audit-logs` 附近追加）
- Test: `worker/test/stats.test.ts`（新建）

**Interfaces:**
- Produces: `GET /api/admin/stats`（admin token）→ `{ overview: { users, likes, views, messages, photos, albums, diaries }, users: [{ id, username, avatar, created_at, checkins, points, likes }] }`。Task 7 依赖此结构。

- [x] **Step 1: 写失败测试**

新建 `worker/test/stats.test.ts`：

```ts
import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations, adminToken, registerUser } from './helpers';

let token: string;
const auth = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  await applyMigrations();
  token = await adminToken();
});

describe('后台统计', () => {
  it('未授权 401', async () => {
    const res = await SELF.fetch('http://x/api/admin/stats');
    expect(res.status).toBe(401);
  });

  it('返回 overview 与 users 汇总，数值与手工构造一致', async () => {
    const u = await registerUser('stats_user1');
    // 手工造数据：2 次签到、1 个赞（count=3）、7 次浏览
    await env.DB.prepare("INSERT INTO checkins (user_id, checkin_date, streak_day, points_earned) VALUES (?, '2026-08-21', 1, 10), (?, '2026-08-22', 2, 20)")
      .bind(u.id, u.id).run();
    await env.DB.prepare("INSERT INTO likes (user_id, target_type, target_id, count) VALUES (?, 'diary', 9200, 3)")
      .bind(u.id).run();
    await env.DB.prepare("INSERT INTO view_counts (target_type, target_id, count) VALUES ('diary', 9200, 7) ON CONFLICT(target_type, target_id) DO UPDATE SET count = count + 7")
      .run();

    const res = await SELF.fetch('http://x/api/admin/stats', { headers: auth() });
    expect(res.status).toBe(200);
    const data = await res.json() as any;

    expect(data.overview).toMatchObject({
      users: expect.any(Number),
      likes: expect.any(Number),
      views: expect.any(Number),
      messages: expect.any(Number),
      photos: expect.any(Number),
      albums: expect.any(Number),
      diaries: expect.any(Number),
    });

    const row = data.users.find((r: any) => r.id === u.id);
    expect(row).toBeTruthy();
    expect(row.username).toBe('stats_user1');
    expect(row.checkins).toBe(2);
    expect(row.likes).toBe(3);
    expect(row.points).toBe(0);

    // overview 聚合包含刚造的数据
    expect(data.overview.likes).toBeGreaterThanOrEqual(3);
    expect(data.overview.views).toBeGreaterThanOrEqual(7);

    await env.DB.prepare('DELETE FROM likes WHERE target_id = 9200').run();
    await env.DB.prepare('DELETE FROM view_counts WHERE target_id = 9200').run();
  });
});
```

- [x] **Step 2: 跑测试确认失败**

Run: `cd worker && npm test -- test/stats.test.ts`
Expected: FAIL（404）

- [x] **Step 3: 实现路由**

`worker/src/routes/admin.ts` 追加：

```ts
// 后台统计：站点总览 + 用户维度汇总（likes 为连赞总次数 SUM(count)）
admin.get('/stats', async (c) => {
  const db = c.env.DB;
  const one = async (sql: string): Promise<number> =>
    (await db.prepare(sql).first<{ n: number }>())?.n ?? 0;
  const overview = {
    users: await one('SELECT COUNT(*) AS n FROM users'),
    likes: await one('SELECT COALESCE(SUM(count), 0) AS n FROM likes'),
    views: await one('SELECT COALESCE(SUM(count), 0) AS n FROM view_counts'),
    messages: await one('SELECT COUNT(*) AS n FROM messages'),
    photos: await one('SELECT COUNT(*) AS n FROM photos'),
    albums: await one('SELECT COUNT(*) AS n FROM albums'),
    diaries: await one('SELECT COUNT(*) AS n FROM diaries'),
  };
  const { results: users } = await db.prepare(
    `SELECT u.id, u.username, u.avatar, u.created_at, u.points,
            COALESCE(c.checkins, 0) AS checkins,
            COALESCE(l.likes, 0) AS likes
     FROM users u
     LEFT JOIN (SELECT user_id, COUNT(*) AS checkins FROM checkins GROUP BY user_id) c ON c.user_id = u.id
     LEFT JOIN (SELECT user_id, SUM(count) AS likes FROM likes GROUP BY user_id) l ON l.user_id = u.id
     ORDER BY u.created_at DESC`
  ).all();
  return c.json({ overview, users });
});
```

- [x] **Step 4: 跑测试确认通过**

Run: `cd worker && npm test`
Expected: PASS（全量，含新 stats 用例）

- [x] **Step 5: Commit**

```bash
git add worker/src/routes/admin.ts worker/test/stats.test.ts
git commit -m "feat(admin): 统计接口 GET /admin/stats（总览 + 用户维度汇总）"
```

---

### Task 7: 后台统计页（StatsView + 导航 + 路由）

**Files:**
- Create: `web/src/views/admin/StatsView.vue`
- Modify: `web/src/router.js:29-43`（admin children 加 stats，放首位）
- Modify: `web/src/views/admin/AdminLayout.vue:13-24`（导航加「统计」，放首位）
- Modify: `web/src/i18n/zh.js`、`web/src/i18n/en.js`

**Interfaces:**
- Consumes: Task 6 的 `GET /api/admin/stats` 响应结构。

- [x] **Step 1: 加 i18n key**

`zh.js` 的 `admin` 组（约 :169-183）加：`stats: '统计',`（`en.js`：`stats: 'Stats',`）。两个语言文件各新增一组：

```js
  adminStats: {
    title: '数据统计',
    users: '注册用户',
    likes: '总赞数',
    views: '总浏览',
    messages: '留言',
    photos: '照片',
    albums: '相册',
    diaries: '日记',
    userTable: '用户数据',
    colUser: '用户',
    colCreated: '注册时间',
    colCheckins: '签到次数',
    colPoints: '积分',
    colLikes: '总赞数',
    empty: '还没有注册用户',
    loading: '加载中…',
  },
```

`en.js` 对应英文翻译。

- [x] **Step 2: 新建 StatsView.vue**

```vue
<script setup>
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../../api';

const { t } = useI18n();
const data = ref(null);
const loading = ref(true);
const error = ref('');

const CARDS = ['users', 'likes', 'views', 'messages', 'photos', 'albums', 'diaries'];

function fmtTime(s) {
  return s ? String(s).slice(0, 10) : '—';
}

onMounted(async () => {
  try {
    data.value = await api('/admin/stats', { admin: true });
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="stats-page">
    <h2 class="page-title">{{ t('adminStats.title') }}</h2>
    <p v-if="loading" class="hint">{{ t('adminStats.loading') }}</p>
    <p v-else-if="error" class="error">{{ error }}</p>
    <template v-else-if="data">
      <div class="cards">
        <div v-for="key in CARDS" :key="key" class="stat-card">
          <span class="num">{{ data.overview[key] }}</span>
          <span class="cap">{{ t(`adminStats.${key}`) }}</span>
        </div>
      </div>

      <section class="card">
        <span class="label">{{ t('adminStats.userTable') }}</span>
        <p v-if="!data.users.length" class="hint">{{ t('adminStats.empty') }}</p>
        <table v-else class="table">
          <thead>
            <tr>
              <th>{{ t('adminStats.colUser') }}</th>
              <th>{{ t('adminStats.colCreated') }}</th>
              <th>{{ t('adminStats.colCheckins') }}</th>
              <th>{{ t('adminStats.colPoints') }}</th>
              <th>{{ t('adminStats.colLikes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in data.users" :key="u.id">
              <td class="user-cell">
                <img v-if="u.avatar" :src="`/uploads/${u.avatar}`" class="avatar" alt="" />
                <span v-else class="avatar avatar-placeholder">{{ u.username.slice(0, 1).toUpperCase() }}</span>
                {{ u.username }}
              </td>
              <td>{{ fmtTime(u.created_at) }}</td>
              <td>{{ u.checkins }}</td>
              <td>{{ u.points }}</td>
              <td>{{ u.likes }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>

<style scoped>
.page-title {
  font-size: 22px;
  margin-bottom: 20px;
}
.hint {
  color: var(--color-text-light);
  font-size: 13px;
}
.error {
  color: #c0392b;
  font-size: 14px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}
.stat-card {
  background: var(--color-card);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.num {
  font-size: 26px;
  font-weight: 600;
  color: var(--color-primary);
}
.cap {
  font-size: 13px;
  color: var(--color-text-light);
}
.card {
  background: var(--color-card);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 20px 24px;
}
.label {
  display: block;
  font-size: 13px;
  color: var(--color-text-light);
  margin-bottom: 10px;
}
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
.table th,
.table td {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-border);
}
.table th {
  font-size: 13px;
  color: var(--color-text-light);
  font-weight: 400;
}
.user-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}
.avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
}
.avatar-placeholder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-deep);
  color: var(--color-text-light);
  font-size: 13px;
}
</style>
```

- [x] **Step 3: 路由 + 导航**

`web/src/router.js` admin children 数组开头（`{ path: '', redirect ... }` 之后）加：

```js
      { path: 'stats', name: 'admin-stats', component: () => import('./views/admin/StatsView.vue') },
```

`web/src/views/admin/AdminLayout.vue` 的 `navItems` 数组开头加：

```js
  { to: localize('/admin/stats'), label: t('admin.stats') },
```

- [x] **Step 4: 手动验证**

- 后台侧边栏首项为「统计」，点击进入 `/admin/stats`
- 顶部卡片显示 7 个数字；下方用户表显示头像/用户名/注册时间/签到/积分/总赞数
- 连赞几次后刷新，总赞数按累加后的值增长
- 未登录管理员访问 → 跳 admin 登录页（路由 meta.admin 已有守卫）

- [x] **Step 5: Commit**

```bash
git add web/src/views/admin/StatsView.vue web/src/router.js web/src/views/admin/AdminLayout.vue web/src/i18n/zh.js web/src/i18n/en.js
git commit -m "feat(admin): 独立统计页——站点总览卡片与用户数据汇总"
```

---

## Self-Review 结论

- **Spec 覆盖**：连赞（T1/T2）、日记富文本（T3/T4）、排行榜（T5）、统计页（T6/T7）均有对应任务；spec「不做的事」均未引入。
- **偏差**：用户维度汇总无留言数列（messages 表无 user_id），已在 Global Constraints 标注。
- **接口一致性**：burst 请求/响应、`/admin/stats` 响应结构、Lightbox `albumLink` prop 在任务间一致。
