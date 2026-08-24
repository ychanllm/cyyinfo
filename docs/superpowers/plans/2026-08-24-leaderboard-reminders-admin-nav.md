# 排行榜点赞合并 + 删除提醒模块 + 后台菜单排序与素材分类 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 热门日记点赞统计合并其下留言(含回复)的赞;整体删除提醒功能;后台左侧菜单支持服务端持久化排序,照片/日记/音乐合并为"素材"Tab 页。

**Architecture:** Worker 端改 leaderboard SQL、删 reminders 端点与 SMTP、settings 白名单加 `admin_nav_order`;前端新建 `MediaView.vue`(Tab 嵌入现有三个管理页)与 `utils/admin-nav.js`(菜单定义+排序加载),AdminLayout 改为配置驱动,SettingsView 加排序卡片。删除 migration 0020 drop reminders 表。

**Tech Stack:** Hono + Cloudflare D1(worker)、Vue 3 + vue-router + vue-i18n(web)、Vitest + @cloudflare/vitest-pool-workers。

## Global Constraints

- 缩进两空格,保留现有分号风格;提交信息用 Conventional Commits(`feat:`/`fix:`/`refactor:`/`docs:`),中文描述。
- 站点已锁定中文,前端新文案只改 `web/src/i18n/zh.js`,不加英文。
- Worker 测试命令:`cd worker && npm test`(Git Bash 下若报 `'"node"' 不是内部或外部命令`,改用 `node node_modules/vitest/vitest.mjs run`)。
- 前端验证:`cd web && npm run build` 必须成功。
- 测试共享同一 D1,新造数据必须在 afterAll 清理,避免影响其它测试文件。
- 新增 migration 序号为 `0020`(0018、0019 已存在)。

---

### Task 1: 热门日记点赞合并留言赞(worker)

**Files:**
- Modify: `worker/src/routes/public.ts:351-359`(日记榜 SQL)
- Test: `worker/test/leaderboard.test.ts`

**Interfaces:**
- Consumes: 现有 `likes` 表(`target_type='message'` 时 target_id 指向 messages.id)、`messages` 表(`target_type='diary'`, `target_id=diaries.id`,楼中楼回复也在同一张表)。
- Produces: `GET /api/leaderboard` 返回的 `diaries[].likes` 变为"日记自身赞 + 其下所有留言/回复的赞"的合并值;`score = 合并 likes * 5 + views`。

- [ ] **Step 1: 写失败测试**

修改 `worker/test/leaderboard.test.ts`:

1) 文件顶部声明区(`let diary1 = 0; ...` 之后)加:

```ts
let msg1 = 0; let msg2 = 0;
```

2) `beforeAll` 末尾(`await toggleLike('diary', diary1);` 之后)加:

```ts
  // 日记二下造一条留言和一条楼中楼回复,各 1 赞:合并后日记二 likes=2、score=2*5+1=11,超过日记一(8)
  const m1 = await env.DB.prepare(
    "INSERT INTO messages (nickname, content, target_type, target_id, is_approved) VALUES ('榜测留言', 'x', 'diary', ?, 1)"
  ).bind(diary2).run();
  msg1 = Number(m1.meta.last_row_id);
  const m2 = await env.DB.prepare(
    "INSERT INTO messages (nickname, content, target_type, target_id, parent_id, is_approved) VALUES ('榜测回复', 'x', 'diary', ?, ?, 1)"
  ).bind(diary2, msg1).run();
  msg2 = Number(m2.meta.last_row_id);
  await toggleLike('message', msg1);
  await toggleLike('message', msg2);
```

3) `afterAll` 的清理循环后加:

```ts
  await env.DB.prepare(`DELETE FROM messages WHERE id IN (${msg1}, ${msg2})`).run();
  await env.DB.prepare("DELETE FROM likes WHERE target_type = 'message' AND target_id IN (?, ?)").bind(msg1, msg2).run();
```

4) 把 `日记榜：只含已发布日记，草稿不上榜` 这个 it 的断言改为:

```ts
  it('日记榜：留言(含回复)的赞合并进日记点赞，草稿不上榜', async () => {
    const board = await (await SELF.fetch('http://x/api/leaderboard')).json() as any;
    const diaries = board.diaries.filter((x: any) => [diary1, diary2, diaryDraft].includes(x.id));
    // 日记二:0 自身赞 + 2 留言赞 + 1 浏览 = score 11;日记一:1 赞 + 3 浏览 = score 8
    expect(diaries.map((x: any) => x.id)).toEqual([diary2, diary1]);
    const d2 = diaries[0];
    expect(d2.likes).toBe(2);
    expect(d2.views).toBe(1);
    expect(d2.score).toBe(11);
    const d1 = diaries[1];
    expect(d1.slug).toBe('lb-diary-1');
    expect(d1.views).toBe(3);
    expect(d1.likes).toBe(1);
    expect(d1.score).toBe(8);
    expect(board.diaries.some((x: any) => x.id === diaryDraft)).toBe(false);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd worker && npm test -- leaderboard`
Expected: FAIL —— `diaries.map(...)` 实际为 `[diary1, diary2]`,期望 `[diary2, diary1]`

- [ ] **Step 3: 改 leaderboard 日记榜 SQL**

`worker/src/routes/public.ts` 中日记榜查询(现 352-359 行)改为:

```ts
  // 日记榜只算已发布的；点赞合并该日记下留言(含楼中楼回复)的赞；带 slug 供前端跳转
  const { results: diaries } = await db.prepare(
    `SELECT t.id, t.title, t.title_en, t.slug,
            COALESCE(v.views, 0) AS views,
            COALESCE(l.likes, 0) + COALESCE(ml.msg_likes, 0) AS likes,
            (COALESCE(l.likes, 0) + COALESCE(ml.msg_likes, 0)) * 5 + COALESCE(v.views, 0) AS score
     FROM diaries t ${LEADERBOARD_STATS}
     LEFT JOIN (
       SELECT m.target_id AS diary_id, COALESCE(SUM(l2.count), 0) AS msg_likes
       FROM messages m
       JOIN likes l2 ON l2.target_type = 'message' AND l2.target_id = m.id
       WHERE m.target_type = 'diary'
       GROUP BY m.target_id
     ) ml ON ml.diary_id = t.id
     WHERE t.status = 'published'
       AND COALESCE(v.views, 0) + COALESCE(l.likes, 0) + COALESCE(ml.msg_likes, 0) > 0
     ORDER BY score DESC, t.id ASC LIMIT 10`
  ).bind('diary', 'diary').all();
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd worker && npm test -- leaderboard`
Expected: PASS

- [ ] **Step 5: 全量回归 + 提交**

Run: `cd worker && npm test`
Expected: 全部 PASS

```bash
git add worker/src/routes/public.ts worker/test/leaderboard.test.ts
git commit -m "feat(leaderboard): 热门日记点赞合并其下留言(含回复)的赞"
```

---

### Task 2: 删除提醒模块(worker 端 + migration)

**Files:**
- Delete: `worker/src/smtp.ts`
- Modify: `worker/src/routes/public.ts`(删 69-125 端点、12-17 ReminderRow、第 7 行 import)
- Modify: `worker/src/routes/admin.ts`(删 68-69 中间件注册、662-691 CRUD)
- Modify: `worker/src/types.ts`(删第 12 行)
- Create: `worker/migrations/0020_drop_reminders.sql`

**Interfaces:**
- Consumes: 无
- Produces: `/api/reminders/check`、`/api/admin/reminders*` 端点不存在(404);`Env` 不再含 `REMINDER_TOKEN`

- [ ] **Step 1: 删除 smtp.ts 与 public.ts 中的提醒代码**

```bash
rm worker/src/smtp.ts
```

`worker/src/routes/public.ts`:
- 删第 7 行 `import { sendEmail } from '../smtp';`
- 删 12-17 行整个 `ReminderRow` interface
- 删 69-125 行整个 `pub.post('/reminders/check', ...)` 端点(含上方注释行 `// 定时任务触发：...`)

- [ ] **Step 2: 删 admin.ts 与 types.ts 中的提醒代码**

`worker/src/routes/admin.ts` 删两行:

```ts
admin.use('/reminders', adminAuth);
admin.use('/reminders/*', adminAuth);
```

以及 662-691 行整个 `// ---- 提醒事项 CRUD ----` 段(GET/POST/PUT/DELETE 四个 handler)。

`worker/src/types.ts` 删:

```ts
  REMINDER_TOKEN: string; // GitHub Actions 定时触发 /api/reminders/check 用的 token
```

- [ ] **Step 3: 新增 migration**

Create `worker/migrations/0020_drop_reminders.sql`:

```sql
DROP TABLE IF EXISTS reminders;
DELETE FROM settings WHERE key IN ('smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'default_recipient');
```

注意:`admin.ts` 的 GET/PUT `/settings` 仍读写 smtp_* 键,本任务不动它(Task 4 会移除这些键的白名单,migration 清数据不依赖代码顺序)。

- [ ] **Step 4: 类型检查 + 全量测试**

Run: `cd worker && npm run typecheck && npm test`
Expected: typecheck 无错误;测试全部 PASS(测试里没有 reminders 引用)

- [ ] **Step 5: 提交**

```bash
git add worker/src/smtp.ts worker/src/routes/public.ts worker/src/routes/admin.ts worker/src/types.ts worker/migrations/0020_drop_reminders.sql
git commit -m "feat: 移除提醒模块——Worker 端点、SMTP 客户端与 reminders 表"
```

---

### Task 3: 删除提醒模块(前端 + workflow)

**Files:**
- Delete: `.github/workflows/reminders.yml`
- Delete: `web/src/views/admin/RemindersView.vue`
- Modify: `web/src/router.js`(删第 40 行)
- Modify: `web/src/views/admin/AdminLayout.vue`(删第 19 行导航项)
- Modify: `web/src/i18n/zh.js`(删 `admin.reminders`、`adminReminders` 块、adminSettings 里 smtp 相关键)
- Modify: `web/src/views/admin/SettingsView.vue`(删 SMTP 卡片及相关 script)

**Interfaces:**
- Consumes: Task 2 已删后端端点(前端删完才一致,两步间隔内后台提醒页会 404,可接受)
- Produces: 前端无任何 reminders/smtp 引用

- [ ] **Step 1: 删文件**

```bash
rm .github/workflows/reminders.yml web/src/views/admin/RemindersView.vue
```

- [ ] **Step 2: router.js 与 AdminLayout.vue 各删一行**

`web/src/router.js` 删:

```js
      { path: 'reminders', name: 'admin-reminders', component: () => import('./views/admin/RemindersView.vue') },
```

`web/src/views/admin/AdminLayout.vue` 删:

```js
  { to: localize('/admin/reminders'), label: t('admin.reminders') },
```

- [ ] **Step 3: zh.js 删提醒与 SMTP 文案**

`web/src/i18n/zh.js`:
- 删 `admin` 块里的 `reminders: '提醒',`
- 删整个 `adminReminders: { ... }` 块
- `adminSettings` 块里删这些键:`smtp`、`smtpHint`、`smtpHost`、`smtpPort`、`smtpUser`、`smtpPass`、`smtpPassPh`、`defaultRecipient`、`smtpSaved`

- [ ] **Step 4: SettingsView.vue 删 SMTP 卡片**

`web/src/views/admin/SettingsView.vue`:
- script 删 ref 声明:`smtpHost`、`smtpPort`、`smtpUser`、`smtpPass`、`smtpConfigured`、`defaultRecipient`
- `loadSettings` 里删 `smtpHost.value = ...` 到 `defaultRecipient.value = ...` 共 6 行
- 删整个 `saveSmtp` 函数
- template 删整个 `<section class="card">` SMTP 卡片(`<h3>{{ t('adminSettings.smtp') }}</h3>` 那段)

- [ ] **Step 5: 全局搜残留 + 构建**

Run: `cd web && grep -rn "reminder\|Reminder\|smtp\|Smtp" src/ || echo CLEAN`
Expected: CLEAN(或仅剩无关注释)

Run: `cd web && npm run build`
Expected: 构建成功

- [ ] **Step 6: 提交**

```bash
git add .github/workflows/reminders.yml web/src/views/admin/RemindersView.vue web/src/router.js web/src/views/admin/AdminLayout.vue web/src/i18n/zh.js web/src/views/admin/SettingsView.vue
git commit -m "feat: 移除提醒模块——后台页面、定时 workflow 与 SMTP 设置"
```

---

### Task 4: settings 支持 admin_nav_order(worker + 测试)

**Files:**
- Modify: `worker/src/routes/admin.ts`(`GET /settings` 约 163-181 行、`PUT /settings` 约 183-225 行;同时移除遗留的 smtp_* 白名单)
- Test: `worker/test/settings.test.ts`

**Interfaces:**
- Consumes: `getSetting`/`setSetting`(`worker/src/guard.ts`)
- Produces: `GET /api/admin/settings` 返回新增 `admin_nav_order: string`(JSON 数组字符串或 `''`);`PUT /api/admin/settings` 接受 `admin_nav_order`,必须是 JSON 字符串数组否则 400

- [ ] **Step 1: 写失败测试**

`worker/test/settings.test.ts` 的 `describe('账号与设置')` 内追加:

```ts
  it('菜单排序:PUT admin_nav_order 后 GET 读回;非法 JSON 数组 400', async () => {
    const order = JSON.stringify(['settings', 'stats', 'media']);
    let res = await SELF.fetch('http://x/api/admin/settings', {
      method: 'PUT', headers: auth(), body: JSON.stringify({ admin_nav_order: order }),
    });
    expect(res.status).toBe(200);
    const s = await (await SELF.fetch('http://x/api/admin/settings', { headers: auth() })).json() as any;
    expect(s.admin_nav_order).toBe(order);

    res = await SELF.fetch('http://x/api/admin/settings', {
      method: 'PUT', headers: auth(), body: JSON.stringify({ admin_nav_order: 'not-json' }),
    });
    expect(res.status).toBe(400);
    res = await SELF.fetch('http://x/api/admin/settings', {
      method: 'PUT', headers: auth(), body: JSON.stringify({ admin_nav_order: '{"a":1}' }),
    });
    expect(res.status).toBe(400);

    // 恢复默认(空串=未设置)
    res = await SELF.fetch('http://x/api/admin/settings', {
      method: 'PUT', headers: auth(), body: JSON.stringify({ admin_nav_order: '' }),
    });
    expect(res.status).toBe(200);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd worker && npm test -- settings`
Expected: FAIL —— `s.admin_nav_order` 为 undefined

- [ ] **Step 3: 实现**

`worker/src/routes/admin.ts`:

1) 先清理提醒功能遗留的 SMTP 白名单(随功能一并移除):
- `GET /settings` 返回对象中删 `smtp_host`、`smtp_port`、`smtp_user`、`smtp_configured`、`default_recipient` 五行
- `PUT /settings` 解构中删 `smtp_host, smtp_port, smtp_user, smtp_pass, default_recipient,`,并删对应的五行 `if (smtp_... !== undefined) await setSetting(...)` / `if (default_recipient !== undefined) ...`

2) `GET /settings` 返回对象中(`admin_like_user_id` 行后)加:

```ts
    admin_nav_order: await getSetting(c.env.DB, 'admin_nav_order'),
```

`PUT /settings` 解构里加 `admin_nav_order`,并在 `admin_like_user_id` 处理后加:

```ts
  if (admin_nav_order !== undefined) {
    // 菜单顺序:空串清除;否则必须是 JSON 字符串数组
    const v = String(admin_nav_order).trim();
    if (v !== '') {
      try {
        const parsed = JSON.parse(v);
        if (!Array.isArray(parsed) || !parsed.every((k) => typeof k === 'string')) throw new Error();
      } catch {
        return c.json({ detail: '菜单顺序格式非法' }, 400);
      }
    }
    await setSetting(c.env.DB, 'admin_nav_order', v);
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd worker && npm test -- settings`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add worker/src/routes/admin.ts worker/test/settings.test.ts
git commit -m "feat(admin): settings 支持 admin_nav_order 菜单顺序存取"
```

---

### Task 5: 素材页 MediaView + 路由调整

**Files:**
- Create: `web/src/views/admin/MediaView.vue`
- Modify: `web/src/router.js`(admin children,约 31-37 行)
- Modify: `web/src/i18n/zh.js`(`admin` 块加 `media`)

**Interfaces:**
- Consumes: 现有 `PhotosView.vue`/`DiariesView.vue`/`MusicView.vue`(作为子组件嵌入,均不自持路由参数)
- Produces: 路由 `/admin/media?tab=photos|diaries|music`(默认 photos);旧 `/admin/photos`、`/admin/diaries`、`/admin/music` 重定向到对应 tab;`/admin` 默认重定向到 `/admin/media`;`zh.js` 新增 `admin.media = '素材'`(Task 6 的 AdminLayout 依赖该文案 key)

- [ ] **Step 1: zh.js 加文案**

`web/src/i18n/zh.js` `admin` 块(`stats: '统计',` 后)加:

```js
    media: '素材',
```

- [ ] **Step 2: 新建 MediaView.vue**

Create `web/src/views/admin/MediaView.vue`:

```vue
<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import PhotosView from './PhotosView.vue';
import DiariesView from './DiariesView.vue';
import MusicView from './MusicView.vue';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const tabs = [
  { key: 'photos', labelKey: 'admin.photos', component: PhotosView },
  { key: 'diaries', labelKey: 'admin.diaries', component: DiariesView },
  { key: 'music', labelKey: 'admin.music', component: MusicView },
];

const active = computed(() => (tabs.some((x) => x.key === route.query.tab) ? route.query.tab : 'photos'));
const activeComponent = computed(() => tabs.find((x) => x.key === active.value).component);

// 切换 tab 用 replace 写 query,不产生历史记录;:key 强制重挂载以重新拉数据
function switchTab(key) {
  if (key !== active.value) router.replace({ query: { tab: key } });
}
</script>

<template>
  <div class="media-view">
    <div class="tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab"
        :class="{ active: active === tab.key }"
        @click="switchTab(tab.key)"
      >
        {{ t(tab.labelKey) }}
      </button>
    </div>
    <component :is="activeComponent" :key="active" />
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
}
.tab {
  border: 1px solid var(--color-border);
  background: var(--color-card);
  border-radius: 8px;
  padding: 8px 20px;
  font-size: 14px;
  color: var(--color-text);
  cursor: pointer;
}
.tab.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}
</style>
```

- [ ] **Step 3: 调整路由**

`web/src/router.js` admin children 中:

- `{ path: '', redirect: '/admin/photos' }` 改为 `{ path: '', redirect: '/admin/media' }`
- `{ path: 'photos', name: 'admin-photos', component: ... }` 改为 `{ path: 'photos', redirect: '/admin/media?tab=photos' }`
- `{ path: 'diaries', name: 'admin-diaries', component: ... }` 改为 `{ path: 'diaries', redirect: '/admin/media?tab=diaries' }`(`diaries/new`、`diaries/:id/edit` 两行保持不变)
- `{ path: 'music', name: 'admin-music', component: ... }` 改为 `{ path: 'music', redirect: '/admin/media?tab=music' }`
- 在 stats 行后新增:

```js
      { path: 'media', name: 'admin-media', component: () => import('./views/admin/MediaView.vue') },
```

- [ ] **Step 4: 构建验证**

Run: `cd web && npm run build`
Expected: 构建成功

手动自测(执行者可 `cd web && npm run dev` 快速过一遍):`/admin/photos` 跳到 `/admin/media?tab=photos`;三个 tab 切换正常;`/admin/diaries/new` 与 `/admin/diaries/:id/edit` 仍正常。

- [ ] **Step 5: 提交**

```bash
git add web/src/views/admin/MediaView.vue web/src/router.js web/src/i18n/zh.js
git commit -m "feat(admin): 照片/日记/音乐合并为素材页(Tab 切换),旧路由重定向"
```

---

### Task 6: 菜单配置模块 + AdminLayout 动态排序

**Files:**
- Create: `web/src/utils/admin-nav.js`
- Modify: `web/src/views/admin/AdminLayout.vue:12-26`(navItems)

**Interfaces:**
- Consumes: Task 4 的 `GET /admin/settings`(`admin_nav_order` 字段)、Task 5 的 `admin.media` 文案与 `/admin/media` 路由
- Produces(供 Task 7 使用):
  - `DEFAULT_NAV: Array<{ key: string, path: string, labelKey: string }>` — 默认顺序,10 项
  - `navOrder: Ref<string[] | null>` — 共享响应式状态,null 表示未设置/未加载
  - `applyNavOrder(order: unknown): Array<{key,path,labelKey}>` — 按 order 重排;未知 key 忽略,缺失项追加到末尾
  - `loadNavOrder(): Promise<void>` — 拉 settings 并写入 navOrder,失败置 null

- [ ] **Step 1: 新建 admin-nav.js**

Create `web/src/utils/admin-nav.js`:

```js
import { ref } from 'vue';
import { api } from '../api';

// 后台左侧菜单的默认顺序;key 稳定不变,排序设置存的是 key 数组
export const DEFAULT_NAV = [
  { key: 'stats', path: '/admin/stats', labelKey: 'admin.stats' },
  { key: 'media', path: '/admin/media', labelKey: 'admin.media' },
  { key: 'dishes', path: '/admin/dishes', labelKey: 'admin.dishes' },
  { key: 'stores', path: '/admin/stores', labelKey: 'admin.stores' },
  { key: 'messages', path: '/admin/messages', labelKey: 'admin.messages' },
  { key: 'prizes', path: '/admin/prizes', labelKey: 'admin.prizes' },
  { key: 'prize-records', path: '/admin/prize-records', labelKey: 'admin.prizeRecords' },
  { key: 'users', path: '/admin/users', labelKey: 'admin.users' },
  { key: 'changelog', path: '/admin/changelog', labelKey: 'admin.changelog' },
  { key: 'settings', path: '/admin/settings', labelKey: 'admin.settings' },
];

// null = 使用默认顺序(未设置或加载失败)
export const navOrder = ref(null);

// 按已存顺序重排:未知 key 忽略,顺序里缺失的项追加到末尾
export function applyNavOrder(order) {
  if (!Array.isArray(order)) return DEFAULT_NAV;
  const known = new Map(DEFAULT_NAV.map((item) => [item.key, item]));
  const picked = [];
  for (const key of order) {
    const item = known.get(key);
    if (item && !picked.includes(item)) picked.push(item);
  }
  for (const item of DEFAULT_NAV) {
    if (!picked.includes(item)) picked.push(item);
  }
  return picked;
}

export async function loadNavOrder() {
  try {
    const data = await api('/admin/settings', { admin: true });
    navOrder.value = data.admin_nav_order ? JSON.parse(data.admin_nav_order) : null;
  } catch {
    navOrder.value = null;
  }
}
```

- [ ] **Step 2: AdminLayout.vue 改为配置驱动**

`web/src/views/admin/AdminLayout.vue` script 部分改为:

```vue
<script setup>
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { clearAdminToken } from '../../api';
import { localize } from '../../i18n';
import { navOrder, applyNavOrder, loadNavOrder } from '../../utils/admin-nav';
import MiniPlayer from '../../components/MiniPlayer.vue';

const { t } = useI18n();
const router = useRouter();

const navItems = computed(() =>
  applyNavOrder(navOrder.value).map((item) => ({ to: localize(item.path), label: t(item.labelKey) }))
);

onMounted(loadNavOrder);

function logout() {
  clearAdminToken();
  router.replace(localize('/admin/login'));
}
</script>
```

(template 和 style 不动。)

- [ ] **Step 3: 构建验证 + 提交**

Run: `cd web && npm run build`
Expected: 构建成功

```bash
git add web/src/utils/admin-nav.js web/src/views/admin/AdminLayout.vue
git commit -m "feat(admin): 左侧菜单改为配置驱动,支持 settings 里的 admin_nav_order"
```

---

### Task 7: SettingsView 菜单排序卡片

**Files:**
- Modify: `web/src/views/admin/SettingsView.vue`
- Modify: `web/src/i18n/zh.js`(`adminSettings` 块加文案)

**Interfaces:**
- Consumes: Task 6 的 `DEFAULT_NAV`/`applyNavOrder`/`navOrder`/`loadNavOrder`;Task 4 的 `PUT /admin/settings`(`admin_nav_order`)
- Produces: 设置页"菜单排序"卡片:列表 + 上移/下移按钮 + 保存;保存后侧边栏立即按新顺序渲染

- [ ] **Step 1: zh.js 加文案**

`web/src/i18n/zh.js` `adminSettings` 块(如 `checkin: '签到设置',` 附近)加:

```js
    navOrder: '菜单排序',
    navOrderHint: '调整管理后台左侧菜单的排列顺序,保存后立即生效。',
    moveUp: '上移',
    moveDown: '下移',
    navOrderSaved: '菜单顺序已保存',
```

- [ ] **Step 2: SettingsView.vue 加排序逻辑**

script 顶部 import 加:

```js
import { DEFAULT_NAV, applyNavOrder, loadNavOrder } from '../../utils/admin-nav';
```

ref 声明区加:

```js
// 菜单排序:当前顺序的 key 数组
const navKeys = ref([]);
```

`loadSettings` 的 try 块里(`adminLikeUserId.value = ...` 行后)加:

```js
    navKeys.value = applyNavOrder(data.admin_nav_order ? JSON.parse(data.admin_nav_order) : null).map((i) => i.key);
```

新增函数:

```js
function moveNav(index, dir) {
  const target = index + dir;
  if (target < 0 || target >= navKeys.value.length) return;
  const arr = [...navKeys.value];
  [arr[index], arr[target]] = [arr[target], arr[index]];
  navKeys.value = arr;
}

async function saveNavOrder() {
  saving.value = true;
  error.value = '';
  success.value = '';
  try {
    await api('/admin/settings', {
      method: 'PUT',
      admin: true,
      body: { admin_nav_order: JSON.stringify(navKeys.value) },
    });
    await loadNavOrder(); // 刷新共享 navOrder,侧边栏立即按新顺序渲染
    success.value = t('adminSettings.navOrderSaved');
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}
```

template 在"签到设置"卡片后(即最后一个 `</section>` 之前的位置,或卡片列表末尾)加:

```vue
      <section class="card">
        <h3>{{ t('adminSettings.navOrder') }}</h3>
        <p class="status">{{ t('adminSettings.navOrderHint') }}</p>
        <ul class="nav-order-list">
          <li v-for="(key, i) in navKeys" :key="key" class="nav-order-item">
            <span>{{ t(DEFAULT_NAV.find((x) => x.key === key).labelKey) }}</span>
            <span class="nav-order-actions">
              <button type="button" class="btn" :disabled="i === 0" @click="moveNav(i, -1)">
                {{ t('adminSettings.moveUp') }}
              </button>
              <button type="button" class="btn" :disabled="i === navKeys.length - 1" @click="moveNav(i, 1)">
                {{ t('adminSettings.moveDown') }}
              </button>
            </span>
          </li>
        </ul>
        <button type="button" class="submit-btn" :disabled="saving" @click="saveNavOrder">
          {{ saving ? t('adminSettings.saving') : t('adminSettings.save') }}
        </button>
      </section>
```

style 块末尾加:

```css
.nav-order-list {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.nav-order-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  font-size: 14px;
}
.nav-order-actions {
  display: flex;
  gap: 6px;
}
.nav-order-actions .btn {
  padding: 4px 10px;
  font-size: 13px;
}
```

- [ ] **Step 3: 构建验证 + 提交**

Run: `cd web && npm run build`
Expected: 构建成功

手动自测:设置页调整顺序 → 保存 → 侧边栏顺序立即变化;刷新页面后保持。

```bash
git add web/src/views/admin/SettingsView.vue web/src/i18n/zh.js
git commit -m "feat(admin): 设置页新增菜单排序卡片(上移/下移,保存即生效)"
```

---

### Task 8: 收尾验证

**Files:** 无新增改动

- [ ] **Step 1: worker 全量测试 + 类型检查**

Run: `cd worker && npm run typecheck && npm test`
Expected: 全部 PASS

- [ ] **Step 2: 前端构建**

Run: `cd web && npm run build`
Expected: 构建成功

- [ ] **Step 3: 残留扫描**

Run: `grep -rn "reminder\|Reminder\|REMINDER\|smtp" worker/src web/src .github/ || echo CLEAN`
Expected: CLEAN(docs/ 历史设计文档不处理)

- [ ] **Step 4: 提示用户手动清理(不代为执行)**

- GitHub 仓库 secret `REMINDER_TOKEN` 可删除
- Cloudflare Worker secret `REMINDER_TOKEN` 可删除(`npx wrangler secret delete REMINDER_TOKEN`)
- 生产 D1 应用 migration:`cd worker && npm run migrate:apply`
