#!/usr/bin/env python3
"""一次性脚本：把数据库里存量视频的 YouTube/B站封面批量迁移到火山 TOS。

新处理的视频会在管道 Stage 5 自动落库到 TOS（见 video_service.fetch_and_store_thumbnail_sync），
但已处理过的老视频 thumbnail_url 仍是外部图床 URL，前端继续走 /img-proxy 实时回源。
本脚本扫描这些存量视频，逐个复用 fetch_and_store_thumbnail_sync 完成迁移。

用法（在 backend/ 目录下，.env 配好 TOS_* 变量）：

    cd backend
    python -m scripts.backfill_thumbnails --dry-run        # 只统计有多少待迁移
    python -m scripts.backfill_thumbnails                  # 真迁移
    python -m scripts.backfill_thumbnails --limit 50       # 只处理前 50 个（分批跑）
    python -m scripts.backfill_thumbnails --workers 8      # 并发下载上传（默认 4）

幂等：fetch_and_store_thumbnail_sync 自带幂等与 non-fatal 保护，
重复运行只会处理仍指向外部 URL 的视频；单个失败不影响其余。

选取条件：thumbnail_url 以 http(s) 开头、且不包含 TOS bucket 域名（即尚未迁移）。
"""

from __future__ import annotations

import argparse
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# 允许 `python -m scripts.xxx` 从 backend/ 运行时导入 app.*
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text  # noqa: E402

from app.services import storage_service  # noqa: E402
from app.services.video_service import fetch_and_store_thumbnail_sync  # noqa: E402
from app.tasks.shared import get_sync_engine  # noqa: E402


def _find_pending(limit: int | None) -> list[str]:
    """返回 thumbnail_url 仍指向外部图床（未迁移到 TOS）的视频 id 列表。"""
    # 已迁移的地址包含 bucket 域名（public_url 的基址），用它排除
    migrated_marker = storage_service._public_base()
    sql = (
        "SELECT id FROM videos "
        "WHERE thumbnail_url IS NOT NULL "
        "AND thumbnail_url LIKE 'http%' "
        "AND thumbnail_url NOT LIKE :marker "
        "ORDER BY created_at DESC NULLS LAST"
    )
    if limit:
        sql += " LIMIT :lim"

    engine = get_sync_engine()
    with engine.connect() as conn:
        params: dict = {"marker": f"%{migrated_marker.split('//')[-1]}%"}
        if limit:
            params["lim"] = limit
        rows = conn.execute(text(sql), params).fetchall()
    return [str(r[0]) for r in rows]


def main() -> int:
    parser = argparse.ArgumentParser(description="批量迁移存量视频封面到火山 TOS")
    parser.add_argument("--dry-run", action="store_true", help="只统计待迁移数量，不实际迁移")
    parser.add_argument("--limit", type=int, default=None, help="最多处理多少个（分批用）")
    parser.add_argument("--workers", type=int, default=4, help="并发数（默认 4）")
    args = parser.parse_args()

    if not storage_service.is_enabled():
        print("❌ TOS 未配置（检查 .env 的 TOS_ACCESS_KEY/SECRET_KEY/ENDPOINT/REGION/BUCKET）", file=sys.stderr)
        return 1

    pending = _find_pending(args.limit)
    total = len(pending)
    print(f"发现 {total} 个待迁移封面的视频。")

    if total == 0:
        return 0
    if args.dry_run:
        print("[dry-run] 未执行迁移。去掉 --dry-run 真正迁移。")
        return 0

    done, failed = 0, 0

    def _migrate(vid: str) -> tuple[str, bool]:
        try:
            # fetch_and_store_thumbnail_sync 内部已 non-fatal；这里再兜一层防御
            fetch_and_store_thumbnail_sync(vid)
            return vid, True
        except Exception as exc:  # noqa: BLE001
            print(f"  ❌ {vid}: {exc}", file=sys.stderr)
            return vid, False

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = [pool.submit(_migrate, vid) for vid in pending]
        for i, fut in enumerate(as_completed(futures), 1):
            _vid, ok = fut.result()
            done += ok
            failed += not ok
            if i % 20 == 0 or i == total:
                print(f"  进度 {i}/{total}（成功 {done}，失败 {failed}）")

    print(f"\n完成：处理 {total}，迁移成功 {done}，失败 {failed}")
    print("注：部分'成功'可能因下载失败被 non-fatal 跳过、保留原 URL；可重复运行收敛。")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
