# 设计文档：照片删除按钮移除 / 日记划线评论 / 打卡与抽奖特效

日期：2026-08-22
状态：已获用户确认

## 背景

个人小站（Vue 3 + Vite 前端 `web/`，Cloudflare Worker + D1 后端 `worker/`）。用户提出三项需求：

1. 照片去除删除按钮
2. 日记添加评论功能：可划线评论，也可对整篇日记评论
3. 文案修改（"今天已打卡"、"抽奖"），打卡和抽奖增加特效，并新增轮盘抽奖形式（后台可配置）

## 一、照片去除删除按钮

**范围**：仅管理后台 UI。

- `web/src/views/admin/PhotosView.vue`：
  - 移除「删除相册」按钮（约 279 行）和「删除照片」按钮（约 344 行）
  - 移除 `removeAlbum` / `removePhoto` 方法及对应确认弹窗逻辑
- i18n（`web/src/i18n/zh.js`、`en.js`）：移除 `adminPhotos.confirmDeleteAlbum`、`adminPhotos.confirmDeletePhoto` 两条文案
- **后端不动**：`DELETE /api/admin/albums/:id`、`DELETE /api/admin/photos/:id`（`worker/src/routes/admin.ts:140,177`）保留，仅移除前端入口

## 二、日记划线评论

**整篇评论**：已有 `MessageBoard` 组件（`web/src/components/MessageBoard.vue`，挂载于 `DiaryDetailView.vue:58`），昵称 + 内容 + 管理员审核，保持不变。

**划线评论**（新功能）：

### 数据库

新增迁移 `worker/migrations/0007_message_quote.sql`：

```sql
ALTER TABLE messages ADD COLUMN quote_text TEXT;
```

复用现有 `messages` 表（`target_type='diary'` + `target_id`）与审核流程（`is_approved`）。

### 后端

- `POST /api/messages`（`worker/src/routes/public.ts:100`）：接受可选 `quote_text` 字段，入库
- `GET /api/messages`（`worker/src/routes/public.ts:88`）：返回 `quote_text`
- 管理后台留言列表（`web/src/views/admin/MessagesView.vue`）：若留言带 `quote_text`，显示引用原句

### 前端（`web/src/views/DiaryDetailView.vue`）

- 正文用 `marked.parse` 渲染为 `v-html`（现有逻辑，内容受信任不做 sanitize）
- **选中文本**：在正文容器上监听 `mouseup`/`selectionchange`，选中非空文本时在选区附近浮出「评论」小按钮
- **提交**：点击后弹出小窗（昵称 + 内容输入框），POST 时带上 `quote_text`（选中的纯文本）；提交后提示「审核后显示」，与现有留言一致
- **高亮展示**：加载该日记已审核评论后，对有 `quote_text` 的评论，在正文 DOM 中遍历文本节点，把匹配的原句包上 `<mark class="quote-mark">` 高亮（同一原句出现多次时全部高亮）
- **查看**：点击高亮弹出气泡，显示该句对应的评论列表（昵称 + 内容）

## 三、文案修改 + 打卡/抽奖特效

### 文案（中英文 i18n 同步修改）

代码中无"今天已入住"/"平局"，实际对应现有文案：

- `points.checkedIn`：`今日已签到` → `今天已打卡`
- `points.draw`：`抽一次（{cost} 分）` → `抽奖（{cost} 分）`

### 打卡特效（`web/src/views/PointsView.vue`）

- 打卡成功后：卡片上盖「已打卡」印章动画（旋转 + 缩放砸下）+ 撒花粒子
- 撒花用纯 JS 生成粒子元素 + CSS 动画实现，不引入第三方动画库

### 盲盒特效

- 点击抽奖后：盲盒元素摇晃/跳动约 1.5 秒（悬念），随后结果弹窗爆开（缩放弹入）+ 撒花

### 轮盘抽奖（新增抽奖形式，后台可配置）

- **设置存储**：复用现有 `site_settings` 键值表，新增 `draw_mode` 键，取值 `box`（默认）/ `wheel`
- **后台**：`web/src/views/admin/SettingsView.vue` 的「签到设置」区块增加「抽奖方式」下拉（盲盒开箱 / 轮盘），走现有设置读写接口
- **公共接口**：签到状态接口（`GET /api/checkin/status`）返回 `draw_mode`
- **前端轮盘模式**：
  - 展示所有权重 > 0 的奖品组成的轮盘
  - 点击抽奖：先调 `POST /api/box/draw` 拿到中奖结果，再驱动轮盘减速旋转、指针最终停在中奖奖品上 + 撒花
  - 后端抽奖逻辑（权重随机）完全复用，不改动

### 错误处理

- 划线评论提交失败：提示错误，不清空输入
- 抽奖接口失败：停止动画并显示错误信息
- 特效失败不影响主流程（动画为纯增强）

### 测试

- `worker/` 有 vitest（`worker/test/`）：为 `messages` 接口的 `quote_text` 字段和 `checkin/status` 的 `draw_mode` 字段补充/更新测试
- 前端无测试框架，手动验证：划选→提交→审核→高亮→点击查看；打卡/盲盒/轮盘三种特效
