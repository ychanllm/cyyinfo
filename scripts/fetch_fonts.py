#!/usr/bin/env python3
"""下载、子集化并上传手账风字体到 R2 (cyyinfo-uploads/fonts/)。

用法:
  pip install fonttools
  python scripts/fetch_fonts.py --dry-run   # 只下载+子集化，不上传
  python scripts/fetch_fonts.py             # 下载+子集化+上传 R2

生成 3 个 woff2 子集，被 web/src/style.css 的 @font-face 引用：
  fonts/zcool-kuailes-regular.woff2   标题（站酷快乐体）
  fonts/noto-serif-sc-light.woff2     正文（思源宋体细体 Light）
  fonts/caveat-regular.woff2          英文手写（Caveat）
"""
import argparse
import subprocess
import sys
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FONT_DIR = Path(__file__).resolve().parent / "fonts"
WORKER_DIR = REPO_ROOT / "worker"   # wrangler.toml 在此目录，R2 绑定见 worker/wrangler.toml
BUCKET = "cyyinfo-uploads"

# 目标 woff2 文件名、源 TTF URL（google/fonts GitHub raw）、子集化参数
# pin: 可变字体用 varLib.instancer 固定到的字重
FONTS = [
    {
        "name": "zcool-kuailes-regular.woff2",
        "src": "https://raw.githubusercontent.com/google/fonts/main/"
               "ofl/zcoolkuaile/ZCOOLKuaiLe-Regular.ttf",
    },
    {
        "name": "noto-serif-sc-light.woff2",
        "src": "https://raw.githubusercontent.com/google/fonts/main/"
               "ofl/notoserifsc/NotoSerifSC%5Bwght%5D.ttf",
        "pin": "wght=300",   # 思源宋体 Light
    },
    {
        "name": "caveat-regular.woff2",
        "src": "https://raw.githubusercontent.com/google/fonts/main/"
               "ofl/caveat/Caveat%5Bwght%5D.ttf",
        "pin": "wght=400",
    },
]

# 常用字表（GB2312 全量，6763 汉字 + 符号），子集化时用，缺字回退系统字体
# 用 Python gb2312 编码器遍历解码全部码位生成，无需外部文件。
# 除汉字外的补充字符：ASCII 可见字符 + 常用中文标点/全角符号
EXTRA_CHARS = (
    "".join(chr(c) for c in range(0x20, 0x7F))
    + "　，。、；：？！“”‘’「」『』（）《》〈〉【】〔〕—…·～"
)


def http_download(url: str, dest: Path) -> None:
    print(f"  下载 {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r, open(dest, "wb") as f:
        f.write(r.read())
    print(f"  -> {dest} ({dest.stat().st_size / 1024:.0f} KB)")


def build_gb2312_chars() -> set[str]:
    """解码 GB2312 全部两字节码位（0xA1-0xF7 x 0xA1-0xFE），得到常用汉字+符号。"""
    chars: set[str] = set()
    for hi in range(0xA1, 0xF8):
        for lo in range(0xA1, 0xFF):
            try:
                ch = bytes([hi, lo]).decode("gb2312")
                if ch:
                    chars.add(ch)
            except UnicodeDecodeError:
                pass
    return chars


def build_chars_file() -> Path:
    """构造子集化用的字符表文件（一行一字符）。"""
    chars = set(EXTRA_CHARS) | build_gb2312_chars()
    chars_file = FONT_DIR / "chars.txt"
    chars_file.write_text("".join(sorted(chars)), encoding="utf-8")
    print(f"  字表 {len(chars)} 字符 -> {chars_file}")
    return chars_file


def pin_instance(cfg: dict, ttf: Path) -> Path:
    """可变字体固定字重，返回静态 TTF 路径。"""
    static = FONT_DIR / cfg["name"].replace(".woff2", "-static.ttf")
    cmd = [
        "fonttools", "varLib.instancer", str(ttf),
        cfg["pin"], "-o", str(static),
    ]
    subprocess.run(cmd, check=True)
    return static


def subset_one(ttf: Path, cfg: dict, chars_file: Path) -> Path:
    out = FONT_DIR / cfg["name"]
    cmd = [
        "pyftsubset", str(ttf),
        f"--output-file={out}",
        "--flavor=woff2",
        "--layout-features=*",
        "--name-IDs=*",
        "--no-hinting",
        "--drop-tables+=DSIG",
        f"--text-file={chars_file}",
    ]
    # 注意：Windows 下 pyftsubset 需用 --opt=值 形式，空格分隔会被误当作字形
    print(f"  子集化 {cfg['name']} ...")
    subprocess.run(cmd, check=True)
    print(f"  -> {out} ({out.stat().st_size / 1024:.0f} KB)")
    return out


def upload(woff: Path) -> None:
    cmd = [
        "npx", "wrangler", "r2", "object", "put",
        f"{BUCKET}/fonts/{woff.name}",
        "--file", str(woff),
        "--content-type", "font/woff2",
    ]
    subprocess.run(cmd, check=True, cwd=WORKER_DIR, shell=True)
    print(f"  OK: cyyinfo-uploads/fonts/{woff.name}")


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="下载/子集化/上传手账风字体到 R2 fonts/")
    parser.add_argument("--dry-run", action="store_true", help="只下载+子集化，不上传")
    args = parser.parse_args()

    FONT_DIR.mkdir(exist_ok=True)
    chars_file = build_chars_file()

    print("\n===== 下载与子集化 =====")
    uploaded = []
    for cfg in FONTS:
        ttf = FONT_DIR / cfg["name"].replace(".woff2", ".ttf")
        if not ttf.exists():
            http_download(cfg["src"], ttf)
        else:
            print(f"  已存在 {ttf.name}，跳过下载")
        src_ttf = ttf
        if cfg.get("pin"):
            print(f"  固定字重 {cfg['pin']} ...")
            src_ttf = pin_instance(cfg, ttf)
        out = subset_one(src_ttf, cfg, chars_file)
        uploaded.append(out)

    print("\n===== 上传 R2 =====")
    if args.dry_run:
        print(f"[dry-run] 将上传 {len(uploaded)} 个文件到 {BUCKET}/fonts/")
        for w in uploaded:
            print(f"[dry-run] (cwd={WORKER_DIR}) npx wrangler r2 object put "
                  f"{BUCKET}/fonts/{w.name} --file {w} --content-type font/woff2")
        return

    for w in uploaded:
        upload(w)

    print("\n完成。CSS 中引用路径：/uploads/fonts/<name>.woff2")


if __name__ == "__main__":
    main()
