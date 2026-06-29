#!/bin/sh
set -e

case "${SERVICE_MODE:-web}" in
  worker|worker-all)
    # Run beat in background + worker in foreground (single container)
    # worker-all: Zeabur SERVICE_MODE value, aliased to worker for backward compat
    celery -A app.tasks.celery_app beat --loglevel=info &
    exec celery -A app.tasks.celery_app worker --loglevel=info -c 4 \
      --max-memory-per-child=400000 \
      -Q pingcha,pingcha.pipeline,pingcha.curate,pingcha.cron
    ;;
  beat)
    # Standalone beat (kept for backward compat, prefer worker mode)
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
    exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} \
      --proxy-headers --forwarded-allow-ips='*'
    ;;
esac
