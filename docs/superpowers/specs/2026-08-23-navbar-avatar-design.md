# 导航栏左上角用户头像 — 设计

日期：2026-08-23

## 需求

在站点导航栏（NavBar）左上角、站名旁边，持久显示当前登录用户的头像。

- 仅在用户登录后显示；游客/管理员会话不显示。
- 无头像用户显示用户名首字母的圆形占位（与积分页占位样式一致）。
- 点击头像跳转到积分页 `/points`（头像上传入口在积分页）。
- 全局常驻：NavBar 为 sticky 且位于 router-view 外，天然满足"一直显示"。

## 方案

采用共享状态方案（方案 B）：新增 `web/src/me.js` 导出响应式 `me` 与 `loadMe()`，
避免 NavBar 自行定时/路由拉取，保证登录、换头像后全局即时同步。

### 组件改动

- **`web/src/me.js`（新增）**：`me = ref(null)`；`loadMe()` 有用户 token 时拉 `/auth/me`，无 token 或失败时置 `null`。
- **`web/src/components/NavBar.vue`**：
  - 左侧新增头像 `<router-link>`（`v-if="me"`），置于站名前，点击跳 `localize('/points')`。
  - `onMounted` 调 `loadMe()`；watch 路由变化：有 token 且 `me` 为空时补拉（覆盖刚登录场景），无 token 时清空 `me`（覆盖 token 失效场景）。
  - 样式：32px 圆形，`object-fit: cover`，占位用 `--color-primary` 底 + 白字首字母。
- **`web/src/views/UserLoginView.vue`**：登录/注册成功后 `await loadMe()` 再跳转。
- **`web/src/views/PointsView.vue`**：`load()` 内把 `meData` 同步进共享 `me`；头像上传成功后同步共享 `me` 的 `avatar`。

### 错误处理

`/auth/me` 失败（含 401 token 失效，api.js 会自行清 token 并跳登录页）→ `me` 置空，头像静默隐藏，不影响导航栏其他功能。

### 测试

web 端无测试框架，验证方式为 `npm run build` 编译通过 + 手动验证：
登录后各页面左上角显示头像；换头像即时更新；未登录不显示；点击跳积分页。
