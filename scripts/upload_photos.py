#!/usr/bin/env python3
"""批量上传本地图片到 R2 (cyyinfo-uploads/photos/)。
用法: python scripts/upload_photos.py <photo_dir> [--dry-run]
"""
import argparse
import subprocess
import sys
import uuid
from pathlib import Path

BUCKET = "cyyinfo-uploads"
REPO_ROOT = Path(__file__).resolve().parent.parent
WORKER_DIR = REPO_ROOT / "worker"

# 支持的图片格式
IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


def main(photo_dir: Path, dry_run: bool) -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    photo_dir = photo_dir.resolve()
    if not photo_dir.is_dir():
        print(f"目录不存在: {photo_dir}")
        sys.exit(1)

    files = sorted(
        f for f in photo_dir.iterdir()
        if f.is_file() and f.suffix.lower() in IMG_EXTS
    )

    if not files:
        print(f"目录中没有支持的图片文件: {photo_dir}")
        sys.exit(0)

    print(f"找到 {len(files)} 个图片文件，开始上传到 R2...\n")

    uploaded = []
    failed = []

    for i, f in enumerate(files, 1):
        ext = f.suffix.lower().lstrip(".") or "jpg"
        key = f"photos/{uuid.uuid4()}.{ext}"
        cmd = [
            "npx", "wrangler", "r2", "object", "put",
            f"{BUCKET}/{key}", "--file", str(f),
        ]

        if dry_run:
            print(f"[dry-run] ({i}/{len(files)}) (cwd={WORKER_DIR}) {' '.join(cmd)}")
            uploaded.append((f.name, key))
        else:
            print(f"({i}/{len(files)}) 上传 {f.name} -> {key} ...", end=" ", flush=True)
            try:
                subprocess.run(cmd, check=True, cwd=WORKER_DIR, capture_output=True, shell=True)
                print("OK")
                uploaded.append((f.name, key))
            except subprocess.CalledProcessError as e:
                print(f"失败!")
                print(f"  stderr: {e.stderr.decode('utf-8', errors='replace')}")
                failed.append(f.name)

    print(f"\n===== 上传完成 =====")
    print(f"成功: {len(uploaded)} 个")
    print(f"失败: {len(failed)} 个")

    if uploaded:
        print("\n已上传的文件列表:")
        for fname, key in uploaded:
            print(f"  {fname} -> {key}")
        urls_path = Path(__file__).parent / "out" / "photos_uploaded.txt"
        urls_path.parent.mkdir(exist_ok=True)
        urls_path.write_text(
            "\n".join(f"{name}\t{key}" for name, key in uploaded),
            encoding="utf-8",
        )
        print(f"\n明细已保存到 {urls_path}")

    if failed:
        print(f"\n失败文件:")
        for fname in failed:
            print(f"  {fname}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="批量上传图片到 R2 photos/ 目录")
    parser.add_argument(
        "photo_dir",
        help="图片目录路径",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="只预览不上传",
    )
    args = parser.parse_args()
    main(Path(args.photo_dir), args.dry_run)
