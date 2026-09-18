# 探店 + 点菜合并为「想吃」 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把公开的 `/dishes`(点菜)与 `/stores`(探店)页面、以及对应的管理页,分别合并成 Tab 切换的「想吃」页,旧路由重定向;后端零改动。

**Architecture:** 纯前端 UI 层合并。公开端和管理端各新增一个 Tab 容器视图,内嵌现有视图组件;路由把旧路径 redirect 到新路径的 `?tab=` query;导航与后台菜单各减为一个入口。模式完全复制已有的 `web/src/views/admin/MediaView.vue`(素材页合并先例,commit `6ad720c`)。

**Tech Stack:** Vue 3 (`<script setup>`)、vue-router 4、vue-i18n(仅 zh)、Vite。

## Global Constraints

- 规格文档:`docs/superpowers/specs/2026-08-25-food-merge-design.md`,实现必须与其一致。
- 后端 `worker/` 零改动;四个原有视图(`web/src/views/DishesView.vue`、`web/src/views/StoresView.vue`、`web/src/views/admin/DishesView.vue`、`web/src/views/admin/StoresView.vue`)代码不修改,只被引用。
- 站点仅中文,i18n 只改 `web/src/i18n/zh.js`。
- 两空格缩进、保留分号,风格与 `admin/MediaView.vue` 一致。
- 默认 Tab 均为点菜(dishes)。
- 项目无前端测试框架,验证方式为 `cd web && npm run build` 通过。

---

### Task 1: 公开端合并为 /food「想吃」

**Files:**
- Create: `web/src/views/FoodView.vue`
- Modify: `web/src/router.js`(第 18-19 行)
- Modify: `web/src/components/NavBar.vue`(第 42-43 行)
- Modify: `web/src/i18n/zh.js`(nav 块,第 12-13 行附近)

**Interfaces:**
- Consumes: 现有 `web/src/views/DishesView.vue`、`web/src/views/StoresView.vue` 默认导出组件;i18n key `nav.dishes`(点菜)、`nav.stores`(探店)。
- Produces: 路由 `/food`(name `food`),query `tab=dishes|stores`;i18n key `nav.food`(想吃)。Task 2 不依赖本任务的产出。

- [ ] **Step 1: 创建 `web/src/views/FoodView.vue`**

完整文件内容(复制 `admin/MediaView.vue` 的模式):

```vue
<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import DishesView from './DishesView.vue';
import StoresView from './StoresView.vue';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const tabs = [
  { key: 'dishes', labelKey: 'nav.dishes', component: DishesView },
  { key: 'stores', labelKey: 'nav.stores', component: StoresView },
];

const active = computed(() => (tabs.some((x) => x.key === route.query.tab) ? route.query.tab : 'dishes'));
const activeComponent = computed(() => tabs.find((x) => x.key === active.value).component);

// 切换 tab 用 replace 写 query,不产生历史记录;:key 强制重挂载以重新拉数据
function switchTab(key) {
  if (key !== active.value) router.replace({ query: { tab: key } });
}
</script>

<template>
  <div class="food-view">
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

- [ ] **Step 2: 修改路由 `web/src/router.js`**

把第 18-19 行:

```js
  { path: '/dishes', name: 'dishes', component: () => import('./views/DishesView.vue') },
  { path: '/stores', name: 'stores', component: () => import('./views/StoresView.vue') },
```

替换为:

```js
  { path: '/food', name: 'food', component: () => import('./views/FoodView.vue') },
  { path: '/dishes', redirect: '/food?tab=dishes' },
  { path: '/stores', redirect: '/food?tab=stores' },
```

- [ ] **Step 3: 修改导航 `web/src/components/NavBar.vue`**

把第 42-43 行:

```js
  { to: localize('/dishes'), label: t('nav.dishes'), icon: '🍲' },
  { to: localize('/stores'), label: t('nav.stores'), icon: '🧭' },
```

替换为:

```js
  { to: localize('/food'), label: t('nav.food'), icon: '🍲' },
```

- [ ] **Step 4: 修改 i18n `web/src/i18n/zh.js`**

在 `nav` 块中,把:

```js
    dishes: '点菜',
    stores: '探店',
```

改为:

```js
    food: '想吃',
    dishes: '点菜',
    stores: '探店',
```

(`nav.dishes`/`nav.stores` 保留,作为 FoodView 的 Tab 标签。)

- [ ] **Step 5: 构建验证**

Run: `cd web && npm run build`
Expected: 构建成功,无报错。

- [ ] **Step 6: 手测**

Run: `cd web && npm run dev`,浏览器验证:
- `/food` 默认显示点菜 Tab,切到探店 Tab 后地址栏为 `/food?tab=stores`,且后退不会逐 Tab 回退(replace)。
- `/dishes` 重定向到 `/food?tab=dishes`;`/stores` 重定向到 `/food?tab=stores`。
- 顶部导航只显示一个 🍲 入口,在 `/food` 两个 Tab 下都保持 active。
- 点菜/探店两个 Tab 内功能(列表加载、投稿弹窗、想吃 toggle)正常。

- [ ] **Step 7: Commit**

```bash
git add web/src/views/FoodView.vue web/src/router.js web/src/components/NavBar.vue web/src/i18n/zh.js
git commit -m "feat: 公开页点菜/探店合并为想吃页(Tab 切换),旧路由重定向"
```

---

### Task 2: 管理端合并为 /admin/food「想吃」

**Files:**
- Create: `web/src/views/admin/FoodView.vue`
- Modify: `web/src/router.js`(admin children,第 39-40 行)
- Modify: `web/src/utils/admin-nav.js`(DEFAULT_NAV,第 8-9 行)
- Modify: `web/src/i18n/zh.js`(admin 块,第 234-235 行附近)

**Interfaces:**
- Consumes: 现有 `web/src/views/admin/DishesView.vue`、`web/src/views/admin/StoresView.vue` 默认导出组件;i18n key `admin.dishes`(菜品管理)、`admin.stores`(探店管理)。
- Produces: 路由 `/admin/food`(name `admin-food`),query `tab=dishes|stores`;i18n key `admin.food`(想吃);后台菜单 key `food`。

- [ ] **Step 1: 创建 `web/src/views/admin/FoodView.vue`**

完整文件内容(与 `admin/MediaView.vue` 同构):

```vue
<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import DishesView from './DishesView.vue';
import StoresView from './StoresView.vue';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const tabs = [
  { key: 'dishes', labelKey: 'admin.dishes', component: DishesView },
  { key: 'stores', labelKey: 'admin.stores', component: StoresView },
];

const active = computed(() => (tabs.some((x) => x.key === route.query.tab) ? route.query.tab : 'dishes'));
const activeComponent = computed(() => tabs.find((x) => x.key === active.value).component);

// 切换 tab 用 replace 写 query,不产生历史记录;:key 强制重挂载以重新拉数据
function switchTab(key) {
  if (key !== active.value) router.replace({ query: { tab: key } });
}
</script>

<template>
  <div class="food-view">
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

- [ ] **Step 2: 修改路由 `web/src/router.js`**

把 admin children 中的:

```js
      { path: 'dishes', name: 'admin-dishes', component: () => import('./views/admin/DishesView.vue') },
      { path: 'stores', name: 'admin-stores', component: () => import('./views/admin/StoresView.vue') },
```

替换为:

```js
      { path: 'food', name: 'admin-food', component: () => import('./views/admin/FoodView.vue') },
      { path: 'dishes', redirect: '/admin/food?tab=dishes' },
      { path: 'stores', redirect: '/admin/food?tab=stores' },
```

- [ ] **Step 3: 修改后台菜单 `web/src/utils/admin-nav.js`**

把 `DEFAULT_NAV` 中的:

```js
  { key: 'dishes', path: '/admin/dishes', labelKey: 'admin.dishes' },
  { key: 'stores', path: '/admin/stores', labelKey: 'admin.stores' },
```

替换为:

```js
  { key: 'food', path: '/admin/food', labelKey: 'admin.food' },
```

注意:已存的 `admin_nav_order` 设置若含旧 key `dishes`/`stores`,`applyNavOrder` 会忽略未知 key 并把 `food` 追加到末尾——预期行为,无需迁移;管理员可在设置页重新排序。

- [ ] **Step 4: 修改 i18n `web/src/i18n/zh.js`**

在 `admin` 块中,把:

```js
    dishes: '菜品管理',
    stores: '探店管理',
```

改为:

```js
    food: '想吃',
    dishes: '菜品管理',
    stores: '探店管理',
```

(`admin.dishes`/`admin.stores` 保留,作为 Tab 标签。)

- [ ] **Step 5: 构建验证**

Run: `cd web && npm run build`
Expected: 构建成功,无报错。

- [ ] **Step 6: 手测**

登录管理后台,验证:
- 左侧菜单只显示一个「想吃」项,指向 `/admin/food`,默认菜品管理 Tab。
- `/admin/dishes` 重定向到 `/admin/food?tab=dishes`;`/admin/stores` 重定向到 `/admin/food?tab=stores`。
- 两个 Tab 内的增删改、上下架功能正常。
- 设置页菜单排序卡片里只有 `food` 一项,排序保存生效。

- [ ] **Step 7: Commit**

```bash
git add web/src/views/admin/FoodView.vue web/src/router.js web/src/utils/admin-nav.js web/src/i18n/zh.js
git commit -m "feat(admin): 点菜/探店管理合并为想吃页(Tab 切换),旧路由重定向"
```

---

## Self-Review 记录

- **Spec coverage:** 规格第 1 节(公开端)→ Task 1;第 2 节(管理端)→ Task 2;第 3 节(后端/原视图不动)→ Global Constraints;第 4 节(admin_nav_order 兼容)→ Task 2 Step 3 注意项;第 5 节(验证)→ 两任务的 Step 5/6。
- **Placeholder scan:** 无 TBD/TODO,所有代码步骤含完整代码。
- **Type consistency:** 两个 FoodView 的 tabs key 均为 `dishes`/`stores`,与 redirect query、i18n key 后缀一致;i18n key `nav.food`/`admin.food` 在 Task 1/2 Step 4 定义并在各自视图/菜单中消费。
