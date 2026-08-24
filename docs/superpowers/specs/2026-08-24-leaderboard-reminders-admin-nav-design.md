# 设计:排行榜热门日记点赞合并、删除提醒模块、后台菜单排序与素材分类

日期:2026-08-24
状态:已获用户批准

## 背景

三个独立需求:

1. 排行榜"热门日记"的点赞统计要把日记下留言(含楼中楼回复)的点赞也合并计算。
2. 管理后台整体移除"提醒"功能及所有相关代码。
3. 管理后台左侧菜单支持自定义排列顺序;照片、日记、音乐三个管理页合并为一个"素材"页面(Tab 切换)。

## 需求 1:热门日记点赞合并留言赞

### 现状

- `worker/src/routes/public.ts` `GET /api/leaderboard`(约 352-359 行)日记榜 SQL:`likes = SUM(likes.count) WHERE target_type='diary'`,`score = likes*5 + views`,取前 10。
- 日记下的留言存在 `messages` 表(`target_type='diary'`, `target_id=diaries.id`),楼中楼回复通过 `parent_id` 挂在同一日记下;留言可被点赞(`likes.target_type='message'`)。

### 方案

日记榜 SQL 增加一个 JOIN:

```sql
LEFT JOIN (
  SELECT m.target_id AS diary_id, COALESCE(SUM(l.count), 0) AS msg_likes
  FROM messages m
  JOIN likes l ON l.target_type = 'message' AND l.target_id = m.id
  WHERE m.target_type = 'diary'
  GROUP BY m.target_id
) ml ON ml.diary_id = t.id
```

- `likes = 日记自身赞 + 该日记下所有留言(含回复)的赞`,展示的 ♥ 与排序 score 均使用合并值。
- 上榜过滤条件 `views + likes > 0` 同步使用合并后的 likes。
- 前端 `LeaderboardView.vue` 无需改动(展示字段名不变)。

### 测试

在 `worker/test/` 补充/修改排行榜测试:构造"日记自身 N 赞 + 其下留言 M 赞"的数据,断言接口返回的 likes = N + M 且排序正确。

## 需求 2:整体删除提醒模块

用户确认**功能整体删除**。

### 整删文件

- `.github/workflows/reminders.yml`(每 5 分钟 curl `/api/reminders/check` 的 cron workflow)
- `web/src/views/admin/RemindersView.vue`(管理页)
- `worker/src/smtp.ts`(自实现 SMTP 客户端,全仓仅 reminders/check 调用)

### 共享文件内局部删除

- `worker/src/routes/public.ts`:删 `sendEmail` import、`ReminderRow` interface、`POST /api/reminders/check` 端点(约 69-125 行)
- `worker/src/routes/admin.ts`:删 reminders CRUD 段(约 662-691 行)及 68-69 行相关注册
- `worker/src/types.ts`:删 `REMINDER_TOKEN` 字段
- `web/src/router.js`:删 reminders 路由一行
- `web/src/views/admin/AdminLayout.vue`:删提醒导航项一行(与需求 3 的重构合并进行)
- `web/src/i18n/zh.js`:删 `admin.reminders` 与整个 `adminReminders` 文案块,以及 `adminSettings.smtp*` 相关文案
- `web/src/views/admin/SettingsView.vue`:删 SMTP 配置卡片及对应 script 逻辑(smtpHost/Port/User/Pass/defaultRecipient)

### 数据库

新增 migration `0018_drop_reminders.sql`:

```sql
DROP TABLE IF EXISTS reminders;
DELETE FROM settings WHERE key IN ('smtp_host','smtp_port','smtp_user','smtp_pass','default_recipient');
```

旧 migration(0002、0017)按惯例保留不动。

### 手动清理(代码外,提示用户)

- GitHub 仓库 secret `REMINDER_TOKEN`
- Cloudflare Worker secret `REMINDER_TOKEN`

### 测试

`worker/test/` 无 reminders/smtp 相关测试,无需清理。删除后跑 `npm test` 确认无回归。

## 需求 3:后台菜单排序 + "素材"分类

### 素材页(合并照片/日记/音乐)

- 新建 `web/src/views/admin/MediaView.vue`:顶部 Tab(照片 / 日记 / 音乐),将现有 `PhotosView.vue`、`DiariesView.vue`、`MusicView.vue` 作为子组件嵌入,各自逻辑不动。
- Tab 状态同步到 URL query(`/admin/media?tab=photos|diaries|music`),刷新后保持。
- 路由调整(`web/src/router.js`):
  - 新增 `/admin/media` → MediaView
  - 旧 `/admin/photos`、`/admin/diaries`、`/admin/music` 重定向到 `/admin/media?tab=对应`
  - `/admin` 默认重定向改为 `/admin/media`
  - 日记编辑子路由(`diaries/new`、`diaries/:id/edit`)保持不变
- 文案:`zh.js` 增加 `admin.media = '素材'`。

### 菜单排序

- **存储**:D1 `settings` 表新增 key `admin_nav_order`,值为菜单项 key 的 JSON 数组,如 `["stats","media","dishes","stores","messages","prizes","prize-records","users","changelog","settings"]`。
- **后端**:`worker/src/routes/admin.ts` 的 `GET /settings` / `PUT /settings` 白名单加入 `admin_nav_order`(复用现有 getSetting/setSetting 助手,无需新端点)。
- **AdminLayout.vue**:`navItems` 从硬编码数组改为:定义带稳定 key 的默认数组(照片/日记/音乐三项替换为单个 `media` 素材项),挂载时读 settings 中的 `admin_nav_order` 按序重排;settings 中缺失的新增项追加在末尾,已删除的 key 忽略。读取失败/为空时回退默认顺序。
- **排序 UI**:`SettingsView.vue` 新增"菜单排序"卡片:列出全部菜单项,每项带"上移/下移"按钮,点击"保存"调 `PUT /admin/settings` 写入 `admin_nav_order`。保存后侧边栏即时生效(AdminLayout 重新拉取或通过共享状态刷新)。

### 测试

- 后端:`admin.ts` settings 白名单变更补测试(GET/PUT `admin_nav_order` 往返)。
- 前端无测试框架,手动验证:排序保存、刷新保持、素材页三个 Tab、旧路由重定向、日记编辑子路由正常。

## 影响面汇总

| 区域 | 变更 |
|---|---|
| worker | public.ts(排行榜 SQL + 删 reminders 端点)、admin.ts(删 CRUD + settings 白名单)、types.ts、smtp.ts(删)、migration 0018(新增)、测试 |
| web | MediaView.vue(新)、AdminLayout.vue、SettingsView.vue、router.js、zh.js、RemindersView.vue(删) |
| 仓库 | 删 .github/workflows/reminders.yml |
| 外部 | 用户手动删 GitHub/Cloudflare 的 REMINDER_TOKEN secret |
