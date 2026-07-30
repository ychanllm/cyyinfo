# scripts — 音乐批量导入

把本地音乐目录批量上传到 R2（`cyyinfo-uploads`），并生成 `songs` 表的 seed SQL。

## 用法

```bash
# 仓库根目录下，Python 3（Windows 上可用 python 或 py 启动器，已验证 python 3.12）
python scripts/upload_music.py <music_dir>

# 先演练：只解析、生成 SQL，不上传
python scripts/upload_music.py <music_dir> --dry-run
```

## 目录 / 文件名规范

```
<music_dir>/
  <专辑名>/
    01_歌名.mp3
    02_歌名.m4a
```

- `<专辑名>` 必须与 `music_albums` 表中的 `title` **完全一致**（当前预置：`David Tao`、`I'm OK`、`黑色柳丁`）。
- 文件名格式：`曲目号_歌名.mp3|m4a`，分隔符也接受 `-` 或空格；不符合的文件会被跳过并提示。
- 歌名/专辑名中的单引号会自动按 SQL 规则转义。

## 输出

- 每个文件上传到 R2，key 为 `music/<uuid>.<ext>`（调 `npx wrangler r2 object put cyyinfo-uploads ... --remote`）。
- 生成 `scripts/out/songs_seed.sql`，`album_id` 通过专辑 title 子查询关联：

```sql
INSERT INTO songs (album_id, title, track_no, filename)
VALUES ((SELECT id FROM music_albums WHERE title = '<专辑名>'), '<歌名>', 1, 'music/<uuid>.mp3');
```

导入数据库：

```bash
cd worker
npx wrangler d1 execute cyyinfo-db --remote --file=../scripts/out/songs_seed.sql
```

## 前置条件

- `npx wrangler login` 已登录（Worker 已部署，见 `worker/`）。
- 脚本内部以 `cwd=worker/` 执行 wrangler（`wrangler.toml` 在该目录），所以**从仓库根目录直接运行即可**，无需手动 cd 或传 `--config`。
- 本机需有 Python 3（Windows 上 `python` 或 `py` 均可）。
