# 探店 + 点菜合并为「想吃」— UI 层合并设计

日期:2026-08-25
状态:已获用户批准

## 背景

点菜(`dishes`)与探店(`stores`)是两套平行模块:后端各有独立路由(`worker/src/routes/dishes.ts`、`stores.ts`)、独立数据表(`0015_dishes.sql`、`0019_stores.sql`,互不引用),前端公开页(`DishesView.vue`、`StoresView.vue`)与管理页结构几乎一一对应。两者都是"美食心愿单"语义(想吃/种草),用户希望合并。

经确认,合并方向为**仅 UI 层合并**:后端 API、数据表、测试全部不动;公开端与管理端都合并;合并后的导航名为「想吃」;点菜 Tab 在前、为默认。

## 先例

完全沿用素材页合并(commit `6ad720c`,`web/src/views/admin/MediaView.vue`)的 Tab 容器模式:

- `?tab=` query 标识当前 Tab,非法值回退到默认 Tab
- 切 Tab 用 `router.replace` 写 query,不产生历史记录
- `<component :is>` + `:key` 强制重挂载,切回时重新拉数据
- 旧路由 redirect 到 `新路径?tab=xxx`

## 设计

### 1. 公开端

- 新建 `web/src/views/FoodView.vue`:Tab 容器,内嵌现有 `web/src/views/DishesView.vue`(点菜,默认)与 `web/src/views/StoresView.vue`(探店)。结构与 scoped 样式复制 `admin/MediaView.vue` 的模式。
- 路由(`web/src/router.js`):
  - 新增 `{ path: '/food', name: 'food', component: () => import('./views/FoodView.vue') }`
  - `/dishes` 改为 `redirect: '/food?tab=dishes'`
  - `/stores` 改为 `redirect: '/food?tab=stores'`
- 导航(`web/src/components/NavBar.vue`):🍲 点菜、🧭 探店两个入口替换为单个「想吃」入口,指向 `/food`(图标沿用 🍲)。
- i18n(`web/src/i18n/zh.js`,站点仅中文):`nav` 下新增 `food: '想吃'`;`nav.dishes`/`nav.stores` 保留,作为 Tab 标签文案。

### 2. 管理端

- 新建 `web/src/views/admin/FoodView.vue`:Tab 容器,内嵌现有 `web/src/views/admin/DishesView.vue`(菜品管理,默认)与 `web/src/views/admin/StoresView.vue`(探店管理)。
- 路由(`web/src/router.js` admin children):
  - 新增 `{ path: 'food', name: 'admin-food', component: () => import('./views/admin/FoodView.vue') }`
  - `dishes` 改为 `redirect: '/admin/food?tab=dishes'`
  - `stores` 改为 `redirect: '/admin/food?tab=stores'`
- 后台菜单(`web/src/utils/admin-nav.js`):`dishes`、`stores` 两项替换为单个 `{ key: 'food', path: '/admin/food', labelKey: 'admin.food' }`,位置在原 `dishes` 处。
- i18n:`admin` 下新增 `food: '想吃'`;`admin.dishes`/`admin.stores` 保留作为 Tab 标签。

### 3. 不动的部分

- `worker/` 零改动:`/api/dishes*`、`/api/stores*`、`/api/admin/dishes*`、`/api/admin/stores*` 及全部测试保持原样。
- 四个原有视图文件(公开/管理的 Dishes/Stores)代码不修改,仅作为 Tab 容器的子组件被引用。

### 4. 兼容与注意点

- 已存的 `admin_nav_order` 设置若含旧 key `dishes`/`stores`:`applyNavOrder` 会忽略未知 key,新 `food` 项追加到末尾,无需数据迁移;管理员可在设置页重新排序。
- 旧的书签/外链 `/dishes`、`/stores`、`/admin/dishes`、`/admin/stores` 经重定向落在对应 Tab,功能不丢失。

### 5. 验证

- `cd web && npm run build` 通过。
- 手测:`/food` 默认点菜 Tab;切 Tab 后 query 变化且无多余历史记录;`/dishes`、`/stores`、`/admin/dishes`、`/admin/stores` 正确重定向;后台菜单只显示一个「想吃」项。
- 后端无改动,不需要跑 worker 测试。
