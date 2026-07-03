#!/usr/bin/env python3
"""一次性脚本：把 frontend/public 下的静态图片/视频资源上传到火山 TOS。

用法（在 backend/ 目录下，确保 .env 已配好 TOS_* 变量）：

    cd backend
    python -m scripts.upload_static_assets            # 真上传
    python -m scripts.upload_static_assets --dry-run  # 只列要传什么
    python -m scripts.upload_static_assets --prefix static/v1   # 自定义 key 前缀

资源在 TOS 中的 key = <prefix>/<相对 public 的路径>，例如
    frontend/public/mascot/cha_star.gif -> static/mascot/cha_star.gif
对外 URL = <CDN_BASE 或 TOS 直链>/static/mascot/cha_star.gif

前端引用改造：把 "/mascot/cha_star.gif" 换成 cdnUrl("/mascot/cha_star.gif")
（见 frontend/lib/cdn.ts），NEXT_PUBLIC_CDN_BASE 配成 <CDN_BASE>/static。

脚本默认跳过 TOS 上已存在的同名对象（幂等，可重复运行）；--force 覆盖。
排除以 . 开头的目录（如 .channel-originals 原图）和非图片文件。
"""

from __future__ import annotations

import argparse
import mimetypes
import sys
from pathlib import Path

# 允许 `python -m scripts.xxx` 从 backend/ 运行时导入 app.*
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import storage_service  # noqa: E402

# 相对仓库根的 public 目录
_PUBLIC_DIR = Path(__file__).resolve().parents[2] / "frontend" / "public"

_IMG_EXTS = {".png", ".webp", ".gif", ".jpg", ".jpeg", ".svg", ".ico", ".avif"}
# 前端 cdnUrl 也会引用这些动画/视频源（hero 背景、吉祥物 webm），一并上传
_MEDIA_EXTS = {".mp4", ".webm", ".mov", ".m4v"}
_ASSET_EXTS = _IMG_EXTS | _MEDIA_EXTS


def _iter_assets(public_dir: Path):
    """产出 (本地绝对路径, 相对 public 的 posix 路径)。跳过隐藏目录与非图片。"""
    for path in sorted(public_dir.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(public_dir)
        # 跳过任何以 . 开头的路径段（如 .channel-originals）
        if any(part.startswith(".") for part in rel.parts):
            continue
        if path.suffix.lower() not in _ASSET_EXTS:
            continue
        yield path, rel.as_posix()


def _content_type(path: Path) -> str:
    if path.suffix.lower() == ".svg":
        return "image/svg+xml"
    guessed, _ = mimetypes.guess_type(str(path))
    return guessed or "application/octet-stream"


def main() -> int:
    parser = argparse.ArgumentParser(description="上传 frontend/public 静态图到火山 TOS")
    parser.add_argument("--prefix", default="static", help="TOS key 前缀（默认 static）")
    parser.add_argument("--dry-run", action="store_true", help="只打印将要上传的对象，不实际上传")
    parser.add_argument("--force", action="store_true", help="覆盖已存在的对象")
    args = parser.parse_args()

    if not _PUBLIC_DIR.exists():
        print(f"❌ 找不到 public 目录: {_PUBLIC_DIR}", file=sys.stderr)
        return 1

    if not args.dry_run and not storage_service.is_enabled():
        print("❌ TOS 未配置（检查 .env 的 TOS_ACCESS_KEY/SECRET_KEY/ENDPOINT/REGION/BUCKET）", file=sys.stderr)
        return 1

    prefix = args.prefix.strip("/")
    assets = list(_iter_assets(_PUBLIC_DIR))
    if not assets:
        print("没有找到可上传的图片资源。")
        return 0

    print(f"发现 {len(assets)} 个静态图片资源，前缀 = {prefix}/")
    uploaded, skipped, failed = 0, 0, 0

    for path, rel in assets:
        key = f"{prefix}/{rel}"
        ctype = _content_type(path)
        size_kb = path.stat().st_size / 1024

        if args.dry_run:
            print(f"  [dry] {rel:50s} -> {key}  ({ctype}, {size_kb:.0f}KB)")
            continue

        if not args.force and storage_service.object_exists(key):
            print(f"  ⏭️  已存在，跳过: {key}")
            skipped += 1
            continue

        url = storage_service.upload_bytes(key, path.read_bytes(), content_type=ctype)
        if url:
            print(f"  ✅ {rel:50s} -> {url}")
            uploaded += 1
        else:
            print(f"  ❌ 上传失败: {rel}", file=sys.stderr)
            failed += 1

    if args.dry_run:
        print(f"\n[dry-run] 共 {len(assets)} 个待上传，未执行。")
    else:
        print(f"\n完成：上传 {uploaded}，跳过 {skipped}，失败 {failed}")
        if uploaded:
            print(f"CDN 基址（前端 NEXT_PUBLIC_CDN_BASE）建议设为：{storage_service._public_base()}/{prefix}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
