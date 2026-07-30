# cyyinfo — 我们的小站

情侣私密小站：相册、日记、音乐、留言、桌宠。Cloudflare 全栈部署，单 Pages 域名对外。

## 架构

```
浏览器
  │
  ▼
Cloudflare Pages（cyyinfo.pages.dev）        ← 前端 Vue3 SPA（web/dist）
  │  /api/*、/uploads/*
  ▼
Pages Functions 代理（web/functions/）       ← 同域转发，浏览器无跨域
  │
  ▼
Cloudflare Worker（cyyinfo-api.gsonfox618.workers.dev，worker/）
  ├── D1（cyyinfo-db）      ← 相册/照片/日记/歌曲/留言/账号/设置
  └── R2（cyyinfo-uploads） ← 图片、音频、封面等上传文件
```

- `web/functions/api/[[path]].ts` 与 `web/functions/uploads/[[path]].ts` 把请求原样转发到 Worker，前端永远只请求同域相对路径。
- Worker 用 Hono；JWT 鉴权（管理员 / 访客口令两种 token）；访客口令开启时公共接口返回 401，凭 `/api/passcode/verify` 换取的访客 token 访问。

## 目录结构

```
worker/            Hono API（TypeScript）
  src/routes/      admin / public / storage 三组路由
  migrations/      D1 迁移（0001_initial.sql）
  wrangler.toml    D1 / R2 绑定（database_id 已回填）
web/               Vue3 + Vite 前端
  functions/       Pages Functions 代理（api、uploads）
  dist/            构建产物（部署到 Pages）
scripts/
  upload_music.py  音乐批量导入脚本（R2 上传 + 生成 SQL）
docs/              设计与任务文档
```

## 本地开发

需要两个终端：

```bash
# 终端 1：API（先建 worker/.dev.vars，内容见下）
cd worker
npm install
npm run migrate:local     # 首次：初始化本地 D1
npm run dev               # http://localhost:8787

# 终端 2：前端（Vite 已配置代理到 8787）
cd web
npm install
npm run dev               # http://localhost:5173
```

`worker/.dev.vars`（不入库）：

```
JWT_SECRET=<任意随机长字符串>
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<本地管理员密码>
```

## 测试

```bash
cd worker && npm test     # vitest，全部 API 单测
cd web && npm run build   # 前端构建验证
```

## 部署（已执行的真实步骤）

前置：`npx wrangler login`（账号 gsonfox618@gmail.com）。

```bash
cd worker
npx wrangler d1 create cyyinfo-db            # → database_id 回填 wrangler.toml
npx wrangler r2 bucket create cyyinfo-uploads
npx wrangler d1 migrations apply cyyinfo-db --remote
echo "<随机64位hex>" | npx wrangler secret put JWT_SECRET
echo "admin"         | npx wrangler secret put ADMIN_USERNAME
echo "<强随机密码>"   | npx wrangler secret put ADMIN_PASSWORD
npm run deploy                               # → https://cyyinfo-api.gsonfox618.workers.dev

cd ../web
# 把 functions/ 两个文件里的 WORKER 常量改为上面的真实域名
npm run build
npx wrangler pages project create cyyinfo --production-branch=main   # 仅首次
npx wrangler pages deploy dist --project-name=cyyinfo --branch=main  # → https://cyyinfo.pages.dev

# 最后把 https://cyyinfo.pages.dev 加进 worker/src/index.ts 的 ALLOWED_ORIGINS，重新 npm run deploy
```

之后更新：Worker 改动 → `cd worker && npm run deploy`；前端改动 → `cd web && npm run build && npx wrangler pages deploy dist --project-name=cyyinfo`。

可选 git CI：Cloudflare Dashboard → Pages → cyyinfo → 连接 Git 仓库，构建命令 `cd web && npm install && npm run build`，输出目录 `web/dist`，之后 push 即自动发布。

## Secret 清单

| 名称 | 说明 |
|---|---|
| `JWT_SECRET` | JWT 签名密钥（64 位随机 hex） |
| `ADMIN_USERNAME` | 首管理员用户名（`admin`） |
| `ADMIN_PASSWORD` | 首管理员初始密码。**初始值记录在部署报告（`.superpowers/sdd/task-20-report.md`）中，请登录后台「账号管理」尽快修改** |

修改 secret：`echo "<新值>" | npx wrangler secret put <名称>`（在 `worker/` 下执行）。

## 音乐批量导入

```bash
python scripts/upload_music.py <音乐目录> [--dry-run]
```

目录结构：`<音乐目录>/<专辑名>/<曲目号>_<歌名>.mp3`（支持 mp3/m4a）。专辑名必须与后台「音乐」里已建好的专辑标题完全一致。脚本会把文件上传到 R2 并生成 SQL 写入 D1（先 `--dry-run` 预览）。

## 访客口令

后台「设置」页可设置访客口令：设置后全站公共内容（相册/日记/音乐/留言）需要先在门禁页输入口令换取访客 token；清空口令即恢复公开。当前线上为公开状态（未设口令）。
