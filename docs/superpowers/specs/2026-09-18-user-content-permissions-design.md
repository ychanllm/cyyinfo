# 用户内容上传权限（日记 / 相册）设计

日期：2026-09-18
状态：已确认

## 需求

管理员可以指定注册用户拥有上传、管理日记和相册的权限：

- 日记、相册为两个**独立权限**，可分别授予
- 获权用户的操作范围**等同管理员**（可管理全部日记 / 相册内容，不限于自己上传的）
- 获权用户**复用现有后台界面**（`/admin`），只看到有权限的栏目
- 管理员在**独立的「权限管理」页**设置权限

## 数据模型（迁移 0021）

```sql
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN ('diary', 'album')),
  granted_by INTEGER REFERENCES admin_users(id),
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, permission)
);
```

日记作者归属：

- 重建 `diaries` 表：`author_id` 改为可空，新增 `author_user_id INTEGER REFERENCES users(id)`（可空）
- 公开查询（`worker/src/routes/public.ts` 日记列表/详情）改为 `LEFT JOIN admin_users` + `LEFT JOIN users`，作者名取 `COALESCE(admin_users.display_name, users.username)`
- 相册 / 照片表不加归属字段（权限范围等同管理员，无需区分）
- `diary_versions` 不记录编辑人，无需改动

## 后端

### 中间件 `contentAuth(permission)`（`worker/src/auth.ts`）

- 管理员令牌 → 直接放行（现有行为不变）
- 用户令牌 → 校验 `users.auth_version` 后查 `user_permissions`，有对应权限则放行并 `c.set('user', ...)`
- 否则 401
- 权限每请求查库，撤销立即生效

### 路由门岗调整（`worker/src/routes/admin.ts`）

只换中间件，不改业务逻辑：

- `/diaries/*`、`/diary-categories/*` → `contentAuth('diary')`
- `/albums/*`、`/photos/*` → `contentAuth('album')`
- 其余后台路由（用户、设置、消息、奖品、站点用户等）仍仅 `adminAuth`

创建日记时：管理员设 `author_id`，获权用户设 `author_user_id`。

### 权限管理 API（仅管理员）

- `GET /api/admin/permissions` — 返回所有注册用户及其 `diary` / `album` 授权状态
- `PUT /api/admin/permissions/:userId` — body `{ diary: bool, album: bool }`，upsert / 删除授权记录，写审计日志

### `GET /api/auth/me` 扩展

返回用户权限列表 `permissions: ['diary', 'album']`，前端据此显示后台入口。

## 前端

### 管理员「权限管理」页

- 新路由 `/admin/permissions`，视图 `web/src/views/admin/PermissionsView.vue`
- `web/src/utils/admin-nav.js` 的 `DEFAULT_NAV` 增加 `permissions` 项（「权限管理」），置于「用户」之后，沿用 `admin_nav_order` 设置机制
- 页面：表格列出所有注册用户（用户名、注册时间），每行「日记上传」「相册上传」两个开关，切换即调 `PUT /api/admin/permissions/:userId`，失败回滚开关并提示
- 仅管理员可见（路由 `meta.admin`，后端接口同样仅管理员）

### 获权用户进入后台

- 用户在前台 `/login` 登录后，若 `me.permissions` 非空，导航 / 个人区显示「内容管理」入口跳转 `/admin`
- 路由守卫（`web/src/router.js`）：`/admin/*` 允许「管理员令牌 **或** 持有权限的用户令牌」进入
- 侧边栏过滤（`AdminLayout.vue`）：管理员看到全部栏目；获权用户只看到有权限的栏目（媒体页按权限显示相册 / 日记 tab），其余栏目隐藏
- API 客户端（`web/src/api.js`）：`admin: true` 的请求优先用管理员令牌，无管理员令牌时回退用户令牌
- 获权用户的操作界面与管理员完全一致（复用 `MediaView`、相册 / 日记编辑页）

## 安全与审计

- 权限授予 / 撤销仅管理员可调
- 获权用户仅能访问日记 / 相册路由，其余后台路由中间件不变
- 审计（复用 `worker/src/audit.ts` 的 `logAudit`）：
  - 授予 / 撤销权限各记一条（操作人、目标用户、权限、动作）
  - 获权用户创建 / 编辑 / 删除日记、相册、照片时，操作人记录为 `user:<id>`

## 测试（`worker/test/permissions.test.ts`）

- 管理员授予 / 撤销权限，列表接口返回正确状态
- 非管理员调用权限管理接口 → 401/403
- 获权用户可创建 / 编辑 / 删除日记、上传照片；无权限用户访问同路由 → 401
- 撤销后立即失去访问能力
- 用户创建的日记公开页作者显示其用户名
- 现有测试保持通过（管理员行为无变化）
