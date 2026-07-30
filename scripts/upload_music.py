#!/usr/bin/env python3
"""批量导入音乐到 R2 并生成 songs 表 SQL。
用法: python scripts/upload_music.py <music_dir> [--dry-run]
目录结构: <music_dir>/<专辑名>/<曲目号>_<歌名>.mp3
专辑名必须与 music_albums 表中的 title 完全一致（David Tao / I'm OK / 黑色柳丁）。
"""
import argparse
import re
import subprocess
import sys
import uuid
from pathlib import Path

BUCKET = "cyyinfo-uploads"
REPO_ROOT = Path(__file__).resolve().parent.parent
WORKER_DIR = REPO_ROOT / "worker"

def main(music_dir: Path, dry_run: bool) -> None:
    # Windows 控制台默认 GBK，强制 UTF-8 以便正确打印中文专辑名
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    out_dir = Path(__file__).parent / "out"
    out_dir.mkdir(exist_ok=True)
    sql_lines = []
    for album_dir in sorted(p for p in music_dir.iterdir() if p.is_dir()):
        album = album_dir.name
        for f in sorted(album_dir.iterdir()):
            m = re.match(r"(\d+)[_\- ]+(.+)\.(mp3|m4a)$", f.name, re.IGNORECASE)
            if not m:
                print(f"跳过（文件名不符合 曲目号_歌名.mp3）: {f}")
                continue
            track_no, title, ext = int(m.group(1)), m.group(2), m.group(3).lower()
            key = f"music/{uuid.uuid4()}.{ext}"
            cmd = ["npx", "wrangler", "r2", "object", "put",
                   f"{BUCKET}/{key}", "--file", str(f), "--remote"]
            if dry_run:
                print(f"[dry-run] (cwd={WORKER_DIR}) {' '.join(cmd)}")
            else:
                # wrangler.toml 在 worker/ 下，wrangler 需在该目录运行
                subprocess.run(cmd, check=True, cwd=WORKER_DIR)
            safe = title.replace("'", "''")
            sql_lines.append(
                f"INSERT INTO songs (album_id, title, track_no, filename) "
                f"VALUES ((SELECT id FROM music_albums WHERE title = '{album.replace(chr(39), chr(39)*2)}'), '{safe}', {track_no}, '{key}');"
            )
            print(f"OK {album}/{title} -> {key}")
    sql_path = out_dir / "songs_seed.sql"
    sql_path.write_text("\n".join(sql_lines), encoding="utf-8")
    print(f"\n已生成 {sql_path}\n执行: npx wrangler d1 execute cyyinfo-db --remote --file={sql_path}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="批量导入音乐到 R2 并生成 songs 表 SQL")
    parser.add_argument("music_dir", nargs="?", default="music", help="音乐根目录（默认 music）")
    parser.add_argument("--dry-run", action="store_true", help="只解析并生成 SQL，不真正上传 R2")
    args = parser.parse_args()
    main(Path(args.music_dir), args.dry_run)
