#!/usr/bin/env python3
"""验证 app.main 启动后 litellm 不在 sys.modules 中。

用法: python tests/verify_no_litellm.py

退出码：
  0 = PASS（无 litellm）
  1 = FAIL（litellm 被加载）
"""
import sys
import os

# Set dummy env before any app imports
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://u:p@localhost/db")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("CELERY_BROKER_URL", "redis://localhost:6379/1")
os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault("APP_ENV", "development")


def main():
    # Clear all app.* and litellm modules before importing
    to_remove = [k for k in list(sys.modules.keys())
                 if 'litellm' in k or k.startswith('app.')]
    for m in to_remove:
        del sys.modules[m]

    # Import app.main (triggers full import chain)
    try:
        import app.main  # type: ignore
    except Exception as e:
        # Import may fail due to DB connectivity — that's OK for this test.
        # The goal is: did litellm get loaded before the failure?
        print(f"[WARN] app.main import raised: {e}", file=sys.stderr)

    # Check
    litellm_modules = sorted(k for k in sys.modules if 'litellm' in k)

    if litellm_modules:
        print(f"FAIL: litellm loaded after app.main import:")
        for m in litellm_modules:
            print(f"  - {m}")
        print()
        print("Hint: Move heavy service imports to lazy import or workflow layer.")
        sys.exit(1)
    else:
        print("PASS: no litellm in sys.modules after app.main import")
        sys.exit(0)


if __name__ == "__main__":
    main()
