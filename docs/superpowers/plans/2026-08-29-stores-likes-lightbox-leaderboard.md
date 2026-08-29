# 探店点赞 + 想吃灯箱 + 排行榜扩展 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 探店卡片接入点赞（target_type='store'）、想吃两个 tab 封面图点击灯箱放大、排行榜新增探店榜（按点赞）和点菜榜（按想吃数）。

**Architecture:** 迁移 0024 重建 likes 表扩展 CHECK；likes.ts 加 'store' 目标与通知分支；public.ts 排行榜加两个查询；前端复用现有 LikeButton / Lightbox 组件接入 StoresView/DishesView/LeaderboardView。

**Tech Stack:** Hono + Cloudflare Worker + D1（worker/），Vue 3（web/），Vitest + Miniflare（worker/test/）。

**Spec:** `docs/superpowers/specs/2026-08-29-stores-likes-lightbox-leaderboard-design.md`

## Global Constraints

- 两空格缩进，保留现有风格；不新增依赖；Conventional Commits。
- 迁移只追加：新文件 `worker/migrations/0024_likes_store.sql`，不改旧迁移。
- 通知生成失败不阻断点赞（notifyLike 既有 try/catch）；点赞去重含接收人维度（沿用现状）。
- 测试串行共享 D1：fixtures 用「榜测」等独特命名，describe 内或 afterAll 清理自建数据（先删引用方）。
- 前端这些视图用 i18n `t()`（web/src/i18n/zh.js 单一中文 locale）；新文案加 zh.js key，不硬编码（LeaderboardView/StoresView/DishesView 现状如此）。
- 仓库根 `D:\vibeProject\kimiProject\cyyinfo`；Worker 命令在 `worker/`、前端在 `web/` 下执行。
- Windows 上 miniflare 偶发 EBUSY 警告是已知噪音；web/src 部分文件 CRLF 行尾，Edit 注意。

---

### Task 1: likes 支持 store 类型（迁移 + 后端 + 通知）

**Files:**
- Create: `worker/migrations/0024_likes_store.sql`
- Modify: `worker/src/routes/likes.ts`（:10 TARGET_TYPES；notifyLike 的 else 分支 :109-111）
- Test: `worker/test/likes.test.ts`（追加 describe）

**Interfaces:**
- Consumes: 现有 likes 表（列序：id, user_id, target_type, target_id, created_at, count, daily_count, daily_date）；`notifyLike(c, liker, target)` 签名。
- Produces: `target_type='store'` 的 toggle/burst/batch 可用；赞店铺 → 站长收 like 通知（detail='店铺'，jump target_type='store'）。Task 2/3 依赖。

- [ ] **Step 1: 写迁移文件 `worker/migrations/0024_likes_store.sql`**（列序已与本地 D1 `.schema likes` 核对）

```sql
CREATE TABLE likes_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('album','photo','diary','message','store')),
  target_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  count INTEGER NOT NULL DEFAULT 1,
  daily_count INTEGER NOT NULL DEFAULT 0,
  daily_date TEXT,
  UNIQUE(user_id, target_type, target_id)
);
INSERT INTO likes_new SELECT id, user_id, target_type, target_id, created_at, count, daily_count, daily_date FROM likes;
DROP TABLE likes;
ALTER TABLE likes_new RENAME TO likes;
CREATE INDEX IF NOT EXISTS idx_likes_target ON likes(target_type, target_id);
```

- [ ] **Step 2: 追加失败测试到 `worker/test/likes.test.ts` 末尾**

文件已有 helper：`alice`/`bob`（beforeAll 注册）、`auth(u)`、`toggle(user, type, id)`、`SELF`/`env`。追加：

```ts
describe('店铺点赞（store）', () => {
  let storeId = 0;

  beforeAll(async () => {
    const r = await env.DB.prepare("INSERT INTO stores (name, is_active) VALUES ('赞测店铺', 1)").run();
    storeId = Number(r.meta.last_row_id);
  });

  it('toggle/burst/batch 支持 target_type=store；dish 仍 400', async () => {
    const res = await toggle(alice, 'store', storeId);
    expect(res.status).toBe(200);
    expect(await res.json() as any).toMatchObject({ liked: true, count: 1 });

    const batch = await SELF.fetch(`http://x/api/likes/batch?target_type=store&ids=${storeId},999999`, { headers: auth(alice) });
    const b = await batch.json() as any;
    expect(b[String(storeId)]).toMatchObject({ count: 1, liked: true });

    // dish 不在 CHECK 内
    expect((await toggle(alice, 'dish', 1)).status).toBe(400);
  });

  it('赞店铺 → 站长收到 like 通知（detail=店铺，jump=store）', async () => {
    const n = await env.DB.prepare(
      "SELECT recipient_type, type, actor_nickname, target_type, target_id, detail FROM notifications WHERE type = 'like' AND target_type = 'store' ORDER BY id DESC"
    ).first<any>();
    expect(n).toMatchObject({
      recipient_type: 'admin', type: 'like', actor_nickname: 'likes_alice',
      target_type: 'store', target_id: storeId, detail: '店铺',
    });
  });

  it('迁移后旧点赞数据与 daily 字段完好', async () => {
    const row = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE name = 'likes'"
    ).first<{ sql: string }>();
    expect(row!.sql).toContain("'store'");
    expect(row!.sql).toContain('daily_count');
    // 本文件既有用例的点赞行仍在（count 字段非空）
    const cnt = await env.DB.prepare('SELECT COUNT(*) AS n FROM likes').first<{ n: number }>();
    expect(cnt!.n).toBeGreaterThan(0);
  });

  it('清理', async () => {
    await env.DB.prepare("DELETE FROM notifications WHERE type = 'like' AND target_type = 'store'").run();
    await env.DB.prepare("DELETE FROM likes WHERE target_type = 'store'").run();
    await env.DB.prepare('DELETE FROM stores WHERE id = ?').bind(storeId).run();
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd worker && npm run migrate:local && npm test -- --run test/likes.test.ts`
Expected: 前两个用例 FAIL（store 被当非法类型 400）。

- [ ] **Step 4: 改 `worker/src/routes/likes.ts`**

4a. :10 的 TARGET_TYPES：

```ts
const TARGET_TYPES = ['album', 'photo', 'diary', 'message', 'store'];
```

4b. notifyLike 的 `} else { return; }`（:109-111）之前插入 store 分支：

```ts
    } else if (target.type === 'store') {
      const s = await db.prepare('SELECT id FROM stores WHERE id = ?').bind(target.id).first();
      const admin = await db.prepare('SELECT id FROM admin_users LIMIT 1').first<{ id: number }>();
      if (!s || !admin) return;
      if (liker.role === 'admin') return; // 站长操作不通知
      recipient = { type: 'admin', id: admin.id };
      detail = '店铺';
    } else {
```

- [ ] **Step 5: 跑测试确认通过 + 回归**

Run: `cd worker && npm test -- --run test/likes.test.ts test/notifications.test.ts test/comment-replies.test.ts && npm run typecheck`
Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add worker/migrations/0024_likes_store.sql worker/src/routes/likes.ts worker/test/likes.test.ts
git commit -m "feat: support store likes with admin notification"
```

---

### Task 2: 排行榜后端加探店榜/点菜榜

**Files:**
- Modify: `worker/src/routes/public.ts:360`（GET /leaderboard return 前）
- Test: `worker/test/leaderboard.test.ts`（追加 describe）

**Interfaces:**
- Consumes: Task 1 的 store 点赞；`stores(is_active)`、`dishes(is_active)`、`dish_wants(dish_id)` 表。
- Produces: `GET /api/leaderboard` 返回 `{ albums, photos, diaries, stores, dishes }`；stores 项 `{id, name, likes, score}`；dishes 项 `{id, name, wants}`。Task 3 前端依赖。

- [ ] **Step 1: 追加失败测试到 `worker/test/leaderboard.test.ts` 末尾**

文件已有 helper：`user`（lb_user）、`toggleLike(type, id)`、`SELF`/`env`、独特的「榜测」命名约定。追加：

```ts
describe('探店榜与点菜榜', () => {
  let storeA = 0; let storeB = 0; let dishA = 0; let dishB = 0;

  beforeAll(async () => {
    const s1 = await env.DB.prepare("INSERT INTO stores (name, is_active) VALUES ('榜测店铺甲', 1)").run();
    storeA = Number(s1.meta.last_row_id);
    const s2 = await env.DB.prepare("INSERT INTO stores (name, is_active) VALUES ('榜测店铺乙', 1)").run();
    storeB = Number(s2.meta.last_row_id);
    const d1 = await env.DB.prepare("INSERT INTO dishes (name, is_active) VALUES ('榜测菜甲', 1)").run();
    dishA = Number(d1.meta.last_row_id);
    const d2 = await env.DB.prepare("INSERT INTO dishes (name, is_active) VALUES ('榜测菜乙', 1)").run();
    dishB = Number(d2.meta.last_row_id);
    // 店铺甲 2 赞（user + 另一个用户），店铺乙 1 赞；菜甲 2 想吃，菜乙 1 想吃
    const other = await registerUser('lb_user2');
    await toggleLike('store', storeA);
    await SELF.fetch('http://x/api/likes/toggle', {
      method: 'POST',
      headers: { Authorization: `Bearer ${other.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_type: 'store', target_id: storeA }),
    });
    await toggleLike('store', storeB);
    await env.DB.prepare('INSERT INTO dish_wants (user_id, dish_id) VALUES (?, ?), (?, ?), (?, ?)')
      .bind(user.id, dishA, other.id, dishA, user.id, dishB).run();
  });

  afterAll(async () => {
    await env.DB.prepare("DELETE FROM notifications WHERE type = 'like' AND target_type = 'store'").run();
    await env.DB.prepare("DELETE FROM likes WHERE target_type = 'store'").run();
    await env.DB.prepare('DELETE FROM dish_wants WHERE dish_id IN (?, ?)').bind(dishA, dishB).run();
    await env.DB.prepare('DELETE FROM dishes WHERE id IN (?, ?)').bind(dishA, dishB).run();
    await env.DB.prepare('DELETE FROM stores WHERE id IN (?, ?)').bind(storeA, storeB).run();
  });

  it('探店榜按赞数排序，无赞不进榜；点菜榜按想吃数排序', async () => {
    const res = await SELF.fetch('http://x/api/leaderboard');
    expect(res.status).toBe(200);
    const data = await res.json() as any;

    const stores = data.stores as any[];
    const sa = stores.find((s) => s.id === storeA);
    const sb = stores.find((s) => s.id === storeB);
    expect(sa).toMatchObject({ name: '榜测店铺甲', likes: 2, score: 10 });
    expect(sb).toMatchObject({ name: '榜测店铺乙', likes: 1, score: 5 });
    expect(stores.indexOf(sa)).toBeLessThan(stores.indexOf(sb));

    const dishes = data.dishes as any[];
    const da = dishes.find((d) => d.id === dishA);
    const db_ = dishes.find((d) => d.id === dishB);
    expect(da).toMatchObject({ name: '榜测菜甲', wants: 2 });
    expect(db_).toMatchObject({ name: '榜测菜乙', wants: 1 });
    expect(dishes.indexOf(da)).toBeLessThan(dishes.indexOf(db_));
  });

  it('下架的店/菜不进榜', async () => {
    await env.DB.prepare('UPDATE stores SET is_active = 0 WHERE id = ?').bind(storeB).run();
    await env.DB.prepare('UPDATE dishes SET is_active = 0 WHERE id = ?').bind(dishB).run();
    const data = await (await SELF.fetch('http://x/api/leaderboard')).json() as any;
    expect((data.stores as any[]).find((s) => s.id === storeB)).toBeUndefined();
    expect((data.dishes as any[]).find((d) => d.id === dishB)).toBeUndefined();
    await env.DB.prepare('UPDATE stores SET is_active = 1 WHERE id = ?').bind(storeB).run();
    await env.DB.prepare('UPDATE dishes SET is_active = 1 WHERE id = ?').bind(dishB).run();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd worker && npm test -- --run test/leaderboard.test.ts`
Expected: 新用例 FAIL（返回无 stores/dishes 字段）。

- [ ] **Step 3: 改 `worker/src/routes/public.ts`**

`return c.json({ albums, photos, diaries });`（:360）替换为：

```ts
  // 探店榜：按点赞（score = 赞*5，与既有口径一致；无浏览量）
  const { results: stores } = await db.prepare(
    `SELECT t.id, t.name,
            COALESCE(l.likes, 0) AS likes, COALESCE(l.likes, 0) * 5 AS score
     FROM stores t
     LEFT JOIN (SELECT target_id, COALESCE(SUM(count), 0) AS likes FROM likes WHERE target_type = 'store' GROUP BY target_id) l ON l.target_id = t.id
     WHERE t.is_active = 1 AND COALESCE(l.likes, 0) > 0
     ORDER BY score DESC, t.id ASC LIMIT 10`
  ).all();
  // 点菜榜：按想吃数
  const { results: dishes } = await db.prepare(
    `SELECT t.id, t.name, COUNT(w.id) AS wants
     FROM dishes t JOIN dish_wants w ON w.dish_id = t.id
     WHERE t.is_active = 1
     GROUP BY t.id ORDER BY wants DESC, t.id ASC LIMIT 10`
  ).all();
  return c.json({ albums, photos, diaries, stores, dishes });
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd worker && npm test -- --run test/leaderboard.test.ts && npm run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/public.ts worker/test/leaderboard.test.ts
git commit -m "feat: add stores and dishes leaderboards"
```

---

### Task 3: 前端（探店点赞 + 两视图灯箱 + 排行榜两榜 + 通知跳转）

**Files:**
- Modify: `web/src/views/StoresView.vue`（LikeButton + Lightbox）
- Modify: `web/src/views/DishesView.vue`（Lightbox）
- Modify: `web/src/views/LeaderboardView.vue`（两个新榜）
- Modify: `web/src/i18n/zh.js:157-166`（ranking 加三个 key）
- Modify: `web/src/notifications.js`（notificationLink 加 store）

**Interfaces:**
- Consumes: Task 1 的 `/likes/batch?target_type=store`、Task 2 的 leaderboard `stores`/`dishes` 数组；`LikeButton` props（targetType/targetId/count/liked/dailyRemaining，emit `update` 载荷整体替换）；`Lightbox` props（`photos: [{filename, caption?}]`、v-model:index，无 id 自动隐藏点赞）。
- Produces: 无下游依赖。

- [ ] **Step 1: 改 `web/src/views/StoresView.vue`**

1a. script import 区加：

```js
import LikeButton from '../components/LikeButton.vue';
import Lightbox from '../components/Lightbox.vue';
```

1b. state 区（`const stores = ref([])` 之后）加：

```js
// 点赞状态：storeId -> { count, liked, daily_remaining? }
const likeStates = ref({});
// 封面灯箱：单图（无 id → Lightbox 自动隐藏点赞与箭头）
const lightboxIndex = ref(null);
const lightboxPhotos = ref([]);

function openLightbox(s) {
  if (!s.image) return;
  lightboxPhotos.value = [{ filename: s.image, caption: s.name }];
  lightboxIndex.value = 0;
}
```

1c. `load()` 的 `stores.value = await api('/stores');` 之后加批量拉点赞：

```js
    const ids = stores.value.map((s) => s.id);
    if (ids.length) {
      try {
        const batch = await api(`/likes/batch?target_type=store&ids=${ids.join(',')}`);
        const map = {};
        for (const s of stores.value) map[s.id] = batch[s.id] || { count: 0, liked: false };
        likeStates.value = map;
      } catch { /* 点赞状态加载失败不阻塞列表 */ }
    }
```

1d. 模板封面 img（:127）加点击放大：

```html
          <img v-if="s.image" :src="`/uploads/${s.image}`" :alt="s.name" class="cover-img zoomable" @click="openLightbox(s)" />
```

1e. 模板 `.meta` 内、`dishes` div 之后（`no-dishes` p 之后）加点赞按钮：

```html
          <div class="like-row">
            <LikeButton
              v-if="likeStates[s.id]"
              target-type="store"
              :target-id="s.id"
              :count="likeStates[s.id].count"
              :liked="likeStates[s.id].liked"
              :daily-remaining="likeStates[s.id].daily_remaining ?? null"
              @update="likeStates[s.id] = $event"
            />
          </div>
```

1f. 模板末尾（`</div>` 关闭 .stores 之前，modal 之后）加：

```html
    <Lightbox :photos="lightboxPhotos" v-model:index="lightboxIndex" />
```

1g. style 加：

```css
.zoomable {
  cursor: zoom-in;
}
.like-row {
  margin-top: 10px;
  display: flex;
  justify-content: center;
}
```

- [ ] **Step 2: 改 `web/src/views/DishesView.vue`（只加灯箱）**

2a. import 区加 `import Lightbox from '../components/Lightbox.vue';`
2b. state 加（同 1b 的灯箱部分，变量名相同）：

```js
const lightboxIndex = ref(null);
const lightboxPhotos = ref([]);

function openLightbox(d) {
  if (!d.image) return;
  lightboxPhotos.value = [{ filename: d.image, caption: d.name }];
  lightboxIndex.value = 0;
}
```

2c. 封面 img（:122）加 `class="cover-img zoomable" @click="openLightbox(d)"`。
2d. 模板末尾（modal 之后）加 `<Lightbox :photos="lightboxPhotos" v-model:index="lightboxIndex" />`。
2e. style 加 `.zoomable { cursor: zoom-in; }`。

- [ ] **Step 3: 排行榜与 i18n**

3a. `web/src/i18n/zh.js` 的 `ranking` 块（:157-166）`likes: '点赞数',` 之后加：

```js
    stores: '热门探店',
    dishes: '热门点菜',
    wants: '想吃',
```

3b. `web/src/views/LeaderboardView.vue` script 加链接函数（diaryLink 之后）：

```js
const storesLink = () => localize('/food?tab=stores');
const dishesLink = () => localize('/food?tab=dishes');
```

3c. 模板「日记榜」section 之后、`<Lightbox ... />` 之前加两个 section：

```html
      <!-- 探店榜 -->
      <section class="card">
        <h2 class="card-title">{{ t('ranking.stores') }}</h2>
        <ol v-if="board?.stores?.length" class="list">
          <li v-for="(s, i) in board.stores" :key="s.id">
            <router-link :to="storesLink()" class="item">
              <span class="rank" :class="{ medal: i < 3 }">{{ rankLabel(i) }}</span>
              <span class="name">{{ s.name }}</span>
              <span class="stats">
                <span class="stat" :title="t('ranking.likes')">♥ {{ s.likes }}</span>
              </span>
            </router-link>
          </li>
        </ol>
        <p v-else class="empty">{{ t('ranking.empty') }}</p>
      </section>

      <!-- 点菜榜 -->
      <section class="card">
        <h2 class="card-title">{{ t('ranking.dishes') }}</h2>
        <ol v-if="board?.dishes?.length" class="list">
          <li v-for="(d, i) in board.dishes" :key="d.id">
            <router-link :to="dishesLink()" class="item">
              <span class="rank" :class="{ medal: i < 3 }">{{ rankLabel(i) }}</span>
              <span class="name">{{ d.name }}</span>
              <span class="stats">
                <span class="stat" :title="t('ranking.wants')">🍜 {{ d.wants }}</span>
              </span>
            </router-link>
          </li>
        </ol>
        <p v-else class="empty">{{ t('ranking.empty') }}</p>
      </section>
```

（`.boards` 是 3 列网格，5 个卡片自动换行，无需改 CSS。）

- [ ] **Step 4: 通知跳转支持 store**

`web/src/notifications.js` 的 `notificationLink` 中，diary 分支之前加：

```js
  if (n.target_type === 'store' && n.target_id) return localize('/food?tab=stores');
```

- [ ] **Step 5: 构建 + 全量回归**

Run: `cd web && npm run build && cd ../worker && npm test`
Expected: 构建成功；全部测试 PASS。

- [ ] **Step 6: Commit**

```bash
git add web/src/views/StoresView.vue web/src/views/DishesView.vue web/src/views/LeaderboardView.vue web/src/i18n/zh.js web/src/notifications.js
git commit -m "feat: store likes, food lightbox, and new leaderboard sections"
```

---

## 备注（执行者须知）

- 部署提醒（不在本计划执行范围，执行前与用户确认）：`cd worker && npm run migrate:apply`（0024）→ `npm run deploy` → web Pages 发布（`npm run build && npx wrangler pages deploy dist --project-name=cyyinfo --branch=main`）。
- 生产 likes 表重建会保留全部旧点赞数据（INSERT SELECT 显式列清单已与现状核对）。
