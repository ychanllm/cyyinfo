# 签到积分系统设计（用户体系 + 签到 + 盲盒 + 兑奖）

日期：2026-08-21
状态：已获用户批准

## 背景

cyyinfo 是 Cloudflare Pages（Vue 3 SPA + Pages Functions / Hono）+ D1 + R2 的情侣纪念站。现有认证只有两级：管理员（`admin_users` 表 + JWT role=admin）和访客（全站共享口令 → JWT role=guest，无唯一身份）。

本设计新增：

1. **用户体系**：口令保护下的自助注册/登录（用户名 + 密码），登录即代替口令门禁。
2. **签到积分**：每日签到得积分，连续签到递增（有上限），断签重置。
3. **盲盒**：固定积分价格抽一次，按后台配置的权重随机出奖。
4. **兑奖**：积分直接兑换奖品；盲盒与兑奖共用同一套奖品体系。
5. **核销**：中奖/兑换的奖品进入"我的奖品"，使用时核销，后台可管理。

## 关键决策（已与用户确认）

- 积分主体：注册用户（非昵称、非设备 ID）。
- 注册方式：先通过全站口令（持有效 guest JWT）才能自助注册；管理员账号体系不变，与用户体系并存。
- 门禁关系：登录（role=user）即视为通过门禁；未登录访客仍可用口令以 guest 身份浏览内容，但签到/积分功能必须登录。
- 签到规则：基础 10 分，连续每天 +5，第 7 天起封顶 40，断签重置；数值后台可配置。
- 盲盒：固定价格（默认 100 分/次，后台可配）+ 权重概率 + 库存控制。
- 核销：中奖/兑换 → 待核销 → 用户点击"使用"（二次确认）或管理员后台操作 → 已核销；管理员可取消（退积分）。
- 忘记密码暂不做自助找回（两人场景，管理员可直接改库；后续可加后台重置）。
- 后端同时写进 `web/functions/_lib/`（生产）和 `worker/src/`（本地 dev 代理 + vitest 测试），新功能代码两边保持一致。

## 角色与认证

三级 JWT 角色：`admin`（现有）/ `user`（新增）/ `guest`（现有）。

### 新增接口

- `POST /api/auth/register` `{username, password}`
  - 要求请求携带有效 guest JWT（即先过全站口令）；站点无口令（公开）时直接开放。
  - username：2–20 字符，字母/数字/中文/下划线，唯一（不区分大小写，`COLLATE NOCASE`）。
  - password：≥ 6 位，bcrypt 哈希存储（复用现有 admin 的哈希方式）。
  - 成功：创建用户并直接签发 user JWT，返回 `{token, username}`。
- `POST /api/auth/login` `{username, password}`
  - 限流 5 次/15 分钟/IP（复用 `security.ts` 的 rateLimit）。
  - 成功：签发 JWT `{sub: user_id, username, role:'user'}`，7 天有效。

### 现有机制改动

- `contentGuard`（`guard.ts`）：放行 `role==='user'` 的 JWT（与 guest 同等视为通过门禁）。
- 新增 `userAuth` 中间件：要求 `role==='user'`，把 `user_id`/`username` 注入上下文；签到/盲盒/兑换/我的奖品接口使用。
- 前端 token 存储：`localStorage.cyyinfo_user_token`；`api.js` 优先级 admin > user > guest。
- 401 处理：签到类接口对 guest/无 token 返回 401，前端引导到登录页（登录后跳回原页面）。

## 数据模型（迁移 `worker/migrations/0006_users_points.sql`）

```sql
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
  checkin_date TEXT NOT NULL,           -- YYYY-MM-DD（站点时区，见下）
  streak_day INTEGER NOT NULL,          -- 本次是连续第几天
  points_earned INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, checkin_date)
);

CREATE TABLE prizes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_en TEXT DEFAULT '',              -- 遵循现有双语惯例
  description TEXT DEFAULT '',
  description_en TEXT DEFAULT '',
  image TEXT DEFAULT '',                -- R2 key，复用现有上传通道
  points_cost INTEGER NOT NULL DEFAULT 0,   -- 兑换价；0 = 不可直接兑换
  box_weight INTEGER NOT NULL DEFAULT 0,    -- 盲盒权重；0 = 不进盲盒池
  stock INTEGER NOT NULL DEFAULT -1,        -- -1 = 无限库存
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE prize_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  prize_id INTEGER NOT NULL REFERENCES prizes(id),
  source TEXT NOT NULL,                 -- 'box' | 'redeem'
  points_spent INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'used' | 'cancelled'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  used_at TEXT
);

CREATE TABLE point_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  change INTEGER NOT NULL,              -- 正为加、负为减
  balance_after INTEGER NOT NULL,
  type TEXT NOT NULL,                   -- 'checkin' | 'box' | 'redeem' | 'cancel_refund'
  ref_id INTEGER,                       -- 关联 checkins.id / prize_records.id
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

`settings` 表新增键（首次读取缺省时用默认值并写入）：

- `checkin_base_points` = `10`
- `checkin_streak_bonus` = `5`
- `checkin_max_points` = `40`
- `box_cost` = `100`

## 签到规则

- 当日首次签到：`streak_day = 上次连续天数 + 1`（昨天有签到则延续，否则重置为 1）。
- 得分：`min(base + (streak_day - 1) * bonus, max)`；默认即第 1 天 10、第 2 天 15 … 第 7 天起 40。
- 日期口径：以 UTC+8 的日历日为准（`checkin_date` 存 YYYY-MM-DD），避免 UTC 零点切割问题。
- `UNIQUE(user_id, checkin_date)` 兜底防并发重复签到；冲突时返回 409。

## API 一览

### 用户端（需 `userAuth`，除 prizes 列表外）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | 注册（需 guest JWT） |
| POST | `/api/auth/login` | 登录（限流） |
| GET | `/api/auth/me` | 当前用户信息 + 积分余额 |
| POST | `/api/checkin` | 签到；已签 409；返回 `{points_earned, streak_day, balance}` |
| GET | `/api/checkin/status` | `{checked_in, streak_day, balance, next_points}` |
| GET | `/api/prizes` | 奖品列表（is_active=1；含兑换价，不暴露库存细节则返回 `in_stock` 布尔） |
| POST | `/api/box/draw` | 抽盲盒；返回 `{prize, balance}`；积分不足 400、奖池为空 409 |
| POST | `/api/prizes/:id/redeem` | 兑换；积分不足 400、不可兑换/无库存 409 |
| GET | `/api/my/prizes` | 我的奖品记录（含 prize 名称/图、状态、时间） |
| POST | `/api/my/prizes/:id/use` | 核销（仅本人、pending → used） |

### 管理端（`adminAuth`，挂在 `routes/admin.ts` 或新文件）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/admin/prizes` | 列表（含停用）/ 创建 |
| PUT/DELETE | `/api/admin/prizes/:id` | 编辑 / 删除（已有记录则软删：is_active=0） |
| GET | `/api/admin/prize-records?status=&user_id=` | 全量记录筛选 |
| POST | `/api/admin/prize-records/:id/use` | 后台核销 |
| POST | `/api/admin/prize-records/:id/cancel` | 取消（仅 pending）：记录置 cancelled，退还 points_spent，写 `cancel_refund` 流水 |
| GET/PUT | `/api/admin/settings` | 复用现有设置接口，新增 4 个签到配置键 |

### 一致性保证（D1）

- 扣积分一律条件更新：`UPDATE users SET points = points - ? WHERE id = ? AND points >= ?`，`changes === 0` 即失败回滚。
- 扣库存同理：`stock = -1` 不扣；否则 `UPDATE prizes SET stock = stock - 1 WHERE id = ? AND stock > 0`。
- 抽盒/兑换用 `db.batch()` 把扣积分、扣库存、写记录、写流水放在一个批次里。
- 盲盒抽奖：取 `is_active=1 AND box_weight>0 AND stock!=0` 的奖品，按权重加权随机；抽中后执行上述批次（库存为 -1 跳过库存更新）。

## 前端

### 新页面

- `LoginView`（`/:lang/login`）：登录/注册两个 tab；注册前先过口令（无 guest token 时跳 GateView）；成功后跳回 `redirect` 参数或 `/points`。
- `PointsView`（`/:lang/points`，NavBar 加入口）：
  - 签到卡片：签到按钮、连续天数、今日已签状态、明日可得积分预览
  - 积分余额
  - 盲盒区：抽盒按钮（显示价格）、抽中结果弹窗
  - 奖品商城：奖品卡片（图、名、描述、兑换价、兑换按钮）
  - 我的奖品：记录列表（状态标签、pending 的可点"使用"，二次确认）
- `GateView`：加"登录账号"链接。

### 后台

- `AdminPrizesView`：奖品 CRUD（列表 + 弹窗编辑，参考 `DiaryCategoriesView`/`RemindersView` 模式；图片复用现有 R2 上传）。
- `AdminPrizeRecordsView`：记录列表（用户、奖品、来源、花费、状态、时间），按状态筛选，核销/取消按钮。
- `SettingsView`：加"签到设置"区块（4 个数值输入）。
- `AdminLayout` 的 `navItems` 加"奖品管理""核销记录"两项；`router.js` 加对应 children。

### 其他

- `api.js`：user token 注入与 401 处理。
- i18n：`web/src/i18n/zh.js`、`en.js` 增加全套 key，跑 `web/scripts/check-i18n-keys.mjs` 校验。

## 后端代码组织

- `web/functions/_lib/routes/auth.ts`（新）：register/login/me。
- `web/functions/_lib/routes/points.ts`（新）：checkin、box、redeem、my/prizes、prizes 列表。
- `web/functions/_lib/routes/admin.ts`：加 prizes CRUD、prize-records 管理（或拆 `admin-prizes.ts`，视行数而定，遵循现有 570 行文件的模式）。
- `web/functions/_lib/auth.ts`：加 user JWT 签发/校验、`userAuth`。
- `web/functions/_lib/guard.ts`：放行 user 角色。
- `web/functions/_lib/index.ts`：挂载新路由。
- 以上全部同步到 `worker/src/`（同路径），保持两边一致。

## 测试（`worker/test/`）

新增 `auth-users.test.ts`、`checkin.test.ts`（vitest + `SELF.fetch`，复用 `helpers.ts` 的 `applyMigrations()`）：

- 注册：无 guest token 拒绝、成功、重名（大小写）拒绝、弱密码拒绝
- 登录：成功、错误密码 401、限流
- 签到：首次得分、当日重复 409、连击递增、达上限封顶、断签重置（构造历史 checkins 行模拟）
- 盲盒：积分不足 400、空奖池 409、抽中扣费减库存、权重为 0/库存 0 不出奖
- 兑换：成功、积分不足、无库存、points_cost=0 拒绝
- 核销：本人 use 成功、他人/非 pending 拒绝；后台 cancel 退积分且写流水

## 不做的事（YAGNI）

- 密码找回/修改页面、后台用户管理页（后续需要再加）
- 多档盲盒、盲盒动画特效
- 积分排行榜、积分过期
- 后台手动调整用户积分（直接改库即可）
