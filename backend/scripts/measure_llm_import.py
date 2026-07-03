#!/usr/bin/env python3
"""测量 LLM_BACKEND 不同值时 import 的 RSS 增量。

用法:
    LLM_BACKEND=litellm python scripts/measure_llm_import.py
    LLM_BACKEND=openai_compatible python scripts/measure_llm_import.py
"""

import os
import sys
import time

# 确保 backend/ 在 sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _rss_mb() -> float:
    """从 /proc/self/status 读取 VmRSS（MB）；macOS 回退到 resource 模块。"""
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) / 1024
    except FileNotFoundError:
        pass
    try:
        import resource
        return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 * 1024)
    except Exception:
        return 0.0


def _measure_import(module_name: str) -> tuple[float, float]:
    """返回 (rss_delta_mb, elapsed_ms)。"""
    before = _rss_mb()
    t0 = time.perf_counter()
    try:
        __import__(module_name)
    except Exception as e:
        print(f"  [警告] import {module_name} 失败: {e}", file=sys.stderr)
    elapsed_ms = (time.perf_counter() - t0) * 1000
    delta_mb = _rss_mb() - before
    return delta_mb, elapsed_ms


def main() -> None:
    backend = os.environ.get("LLM_BACKEND", "litellm")
    print(f"backend = {backend}")

    # 1. 基线
    baseline = _rss_mb()
    print(f"基线 RSS: {baseline:.1f} MB")

    # 2. 设置必要的最小环境变量，避免 config.py 触发 DB 连接
    os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://x:x@localhost/x")
    os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
    os.environ.setdefault("SECRET_KEY", "test-secret")
    os.environ.setdefault("JWT_SECRET_KEY", "test-jwt-secret")

    # 3. import llm_client
    before = _rss_mb()
    t0 = time.perf_counter()
    try:
        import app.services.llm_client  # noqa: F401
        elapsed_ms = (time.perf_counter() - t0) * 1000
        delta_mb = _rss_mb() - before
        print(f"import app.services.llm_client — 增量: {delta_mb:+.1f} MB, 耗时: {elapsed_ms:.0f} ms")
    except Exception as e:
        elapsed_ms = (time.perf_counter() - t0) * 1000
        print(f"import app.services.llm_client 失败 ({e}) — 耗时: {elapsed_ms:.0f} ms", file=sys.stderr)

    # 4. 各 transport 库单独增量（对比用）
    print("\n--- transport 库单独增量 ---")
    for lib in ("litellm", "openai"):
        delta, ms = _measure_import(lib)
        print(f"import {lib:<10} — 增量: {delta:+.1f} MB, 耗时: {ms:.0f} ms")


if __name__ == "__main__":
    main()
