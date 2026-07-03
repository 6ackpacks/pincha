#!/bin/sh
set -e

case "${SERVICE_MODE:-web}" in
  worker)
    # DEPRECATED 过渡分支：单容器跑 beat + 全队列 worker。
    # 迁移完成后移除，改用 worker-light / worker-llm / worker-legacy + 独立 beat。
    celery -A app.tasks.celery_app beat --loglevel=info &
    exec celery -A app.tasks.celery_app worker --loglevel=info -c 4 \
      --max-memory-per-child=400000 \
      -Q pingcha,pingcha.pipeline,pingcha.curate,pingcha.cron
    ;;
  worker-light)
    # 轻量任务：prepare/finalize/字幕/调度/精选，顶层 import 干净（不传 litellm）
    exec env WORKER_ROLE=light celery -A app.tasks.celery_app worker --loglevel=info \
      -c 3 --max-memory-per-child=200000 \
      -Q pingcha.prepare,pingcha.light,pingcha.curate,pingcha.cron
    ;;
  worker-llm)
    # 重 LLM 任务：enrich/wiki/article（传递 litellm），独占 pingcha.llm
    exec env WORKER_ROLE=llm celery -A app.tasks.celery_app worker --loglevel=info \
      -c 2 --max-memory-per-child=400000 --max-tasks-per-child=20 \
      -Q pingcha.llm
    ;;
  worker-legacy)
    # 迁移期消费旧 pingcha.pipeline 队列残留的 process_video，旧队列清空后移除
    exec env WORKER_ROLE=legacy celery -A app.tasks.celery_app worker --loglevel=info \
      -c 1 \
      -Q pingcha.pipeline,pingcha
    ;;
  worker-all)
    # 单容器多进程：进程级 import 隔离（每个 celery 进程按行内 WORKER_ROLE 决定 include）。
    # light 进程不加载 litellm；llm 进程独占 pingcha.llm；beat 调度（设 light 角色避免加载 litellm）。
    # 适用于单机 2C/4GB 未拆分独立服务的场景。前两个进程后台运行，llm 占据主进程。
    # 多 worker 同容器必须用 -n 唯一 nodename，否则控制平面冲突。
    # 裸 pingcha 队列归 light（include 含 schedule_tasks/curate）；
    # article/wiki 任务路由到 pingcha.llm，由 llm 进程消费。
    env WORKER_ROLE=light celery -A app.tasks.celery_app worker --loglevel=info \
      -n light@%h -c 2 --max-memory-per-child=250000 \
      -Q pingcha,pingcha.prepare,pingcha.light,pingcha.curate,pingcha.cron &
    env WORKER_ROLE=light celery -A app.tasks.celery_app beat --loglevel=info &
    exec env WORKER_ROLE=llm celery -A app.tasks.celery_app worker --loglevel=info \
      -n llm@%h -c 2 --max-memory-per-child=400000 --max-tasks-per-child=20 \
      -Q pingcha.llm
    ;;
  beat)
    # 独立 beat 调度器（推荐与 worker 解耦）
    exec celery -A app.tasks.celery_app beat --loglevel=info
    ;;
  *)
    if [ -n "$DATABASE_URL" ]; then
      echo "Running database migrations..."
      if ! alembic upgrade head; then
        echo "WARNING: Migration failed on first attempt, retrying in 5s..."
        sleep 5
        if ! alembic upgrade head; then
          echo "ERROR: Migration failed twice. Check DATABASE_URL and migration files."
          echo "Starting server anyway — some endpoints may return 500."
        fi
      fi
      echo "Migrations complete."
    fi
    exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}
    ;;
esac
