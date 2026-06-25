import os

from celery import Celery
from celery.schedules import crontab


def _resolve_broker_url() -> str:
    """Resolve Celery broker URL from environment variables.

    Priority:
    1. CELERY_BROKER_URL (explicit)
    2. REDIS_URI / REDIS_CONNECTION_STRING (PaaS platform readonly injection) + /1 db
    3. Fallback to redis://redis:6379/1 (docker-compose default)
    """
    explicit = os.getenv("CELERY_BROKER_URL")
    if explicit:
        return explicit

    # Some PaaS platforms inject REDIS_URI or REDIS_CONNECTION_STRING via service linking
    redis_base = os.getenv("REDIS_URI") or os.getenv("REDIS_CONNECTION_STRING")
    if redis_base:
        # Ensure we use db 1 for Celery broker (db 0 is for app cache)
        return redis_base.rstrip("/") + "/1"

    return "redis://redis:6379/1"


broker_url = _resolve_broker_url()


def _resolve_includes() -> list[str]:
    """Resolve which task modules to import based on WORKER_ROLE.

    迁移期按角色隔离顶层 import，避免 light worker 误加载传递 litellm 的重模块。

    - light:  轻量任务（prepare/finalize/字幕/调度/精选），顶层 import 干净。
    - llm:    重 LLM 任务（enrich/wiki/article），会传递 litellm。
    - legacy: 旧的单体 video_tasks（迁移期由 worker-legacy 消费旧队列残留）。
    - 其他(all/web): 全部加载（去重，保持顺序）。
    """
    light = [
        "app.tasks.video_prepare_tasks",
        "app.tasks.video_finalize_tasks",
        "app.tasks.subtitle_tasks",
        "app.tasks.schedule_tasks",
        "app.tasks.curate_v2_tasks",
    ]
    llm = [
        "app.tasks.video_enrich_tasks",
        "app.tasks.wiki_tasks",
        "app.tasks.article_tasks",
        "app.tasks.video_tasks",
    ]
    legacy = []

    role = os.getenv("WORKER_ROLE", "all")
    if role == "light":
        return light
    if role == "llm":
        return llm
    if role == "legacy":
        return legacy

    # all / web / 未知角色：全部加载（去重，保持顺序）
    seen: set[str] = set()
    merged: list[str] = []
    for module in light + llm + legacy:
        if module not in seen:
            seen.add(module)
            merged.append(module)
    return merged


celery_app = Celery(
    "pingcha",
    broker=broker_url,
    include=_resolve_includes(),
)

celery_app.conf.update(
    result_backend=broker_url,
    broker_connection_retry_on_startup=True,
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    # --- 任务可靠性保护 ---
    task_acks_late=True,              # worker 崩溃时任务重新入队，不丢失
    task_reject_on_worker_lost=True,  # worker 意外断开时拒绝任务（配合 acks_late）
    # 超时策略：全局默认 10min，Pipeline 任务（视频/文章处理）通过装饰器覆盖为 60min
    task_soft_time_limit=600,   # 10min（全局默认）
    task_time_limit=720,        # 12min（全局默认）
    # --- 内存保护 ---
    worker_max_tasks_per_child=20,    # 每个 worker 子进程处理 20 个任务后重启，防内存泄漏
    worker_max_memory_per_child=300000,  # 300MB (KB), 子进程超过此限制后自动重启
    worker_prefetch_multiplier=1,    # 每次只预取 1 个任务，避免长任务堆积在内存中
    # --- 结果过期 ---
    result_expires=3600,              # 任务结果 1h 后过期，减少 Redis 内存占用
    task_routes={
        # --- 新拆分管道（按阶段隔离队列）---
        "app.tasks.video_prepare_tasks.*": {"queue": "pingcha.prepare"},
        "app.tasks.video_enrich_tasks.*": {"queue": "pingcha.llm"},
        "app.tasks.video_finalize_tasks.*": {"queue": "pingcha.light"},
        # --- legacy video_tasks 中的 LLM 任务（generate_full_summary 等）---
        "app.tasks.video_tasks.generate_full_summary": {"queue": "pingcha.llm"},
        "app.tasks.video_tasks.process_video": {"queue": "pingcha.llm"},
        # --- article / wiki 重 LLM 任务（由 llm 进程消费）---
        "app.tasks.article_tasks.process_article": {"queue": "pingcha.llm"},
        "app.tasks.article_tasks.*": {"queue": "pingcha.llm"},
        "app.tasks.wiki_tasks.*": {"queue": "pingcha.llm"},
        "app.tasks.curate_v2_tasks.*": {"queue": "pingcha.curate"},
        "app.tasks.schedule_tasks.*": {"queue": "pingcha"},
        "pingcha.cron.*": {"queue": "pingcha"},
        "app.tasks.*": {"queue": "pingcha"},
    },
    task_queues={
        "pingcha": {"exchange": "pingcha", "routing_key": "pingcha"},
        "pingcha.prepare": {"exchange": "pingcha.prepare", "routing_key": "pingcha.prepare"},
        "pingcha.llm": {"exchange": "pingcha.llm", "routing_key": "pingcha.llm"},
        "pingcha.light": {"exchange": "pingcha.light", "routing_key": "pingcha.light"},
        "pingcha.curate": {"exchange": "pingcha.curate", "routing_key": "pingcha.curate"},
        "pingcha.cron": {"exchange": "pingcha.cron", "routing_key": "pingcha.cron"},
    },
    beat_schedule={
        "check-stale-heartbeats": {
            "task": "app.tasks.schedule_tasks.check_stale_heartbeats",
            "schedule": 300.0,  # every 5 minutes
            "options": {"queue": "pingcha"},  # 与现状一致，保留在 pingcha 队列
        },
        "curate-v2-pipeline": {
            "task": "app.tasks.curate_v2_tasks.daily_curate_pipeline",
            "schedule": crontab(hour=21, minute=0),  # 21:00 UTC = 05:00 Beijing
            "options": {"queue": "pingcha.cron"},
        },
        "curate-v2-notify": {
            "task": "app.tasks.curate_v2_tasks.send_daily_notifications",
            "schedule": crontab(hour=0, minute=0),  # 00:00 UTC = 08:00 Beijing
            "options": {"queue": "pingcha.cron"},
        },
    },
)
