#!/bin/bash
# 一键启动脚本
# 用法: bash start-local.sh [infra|backend|celery|pipeline|cron|beat|frontend|all]
# all 模式: 所有服务后台运行，Ctrl+C 一键停止

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
VENV_PYTHON="$BACKEND_DIR/venv/bin/python3.13"

PIDS=()

cleanup() {
    echo ""
    echo ">>> 停止所有服务..."
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null
    done
    wait 2>/dev/null
    echo ">>> 已全部停止"
    exit 0
}

start_infra() {
    echo ">>> 启动基础设施 (db/redis/minio/bgutil)..."
    docker compose -f "$PROJECT_ROOT/docker-compose.infra.yml" up -d
    echo ">>> 等待 PostgreSQL 就绪..."
    sleep 3
}

start_backend() {
    echo ">>> 启动 Backend (FastAPI)..."
    cd "$BACKEND_DIR"
    "$VENV_PYTHON" -m uvicorn app.main:app --reload --reload-include '*.env' --port 8000
}

start_celery_fast() {
    echo ">>> 启动 Celery fast worker..."
    cd "$BACKEND_DIR"
    "$VENV_PYTHON" -m celery -A app.tasks.celery_app worker --loglevel=info -c 4 -Q pingcha -P solo
}

start_celery_pipeline() {
    echo ">>> 启动 Celery pipeline worker..."
    cd "$BACKEND_DIR"
    "$VENV_PYTHON" -m celery -A app.tasks.celery_app worker --loglevel=info -c 2 -Q pingcha.pipeline -P solo
}

start_celery_cron() {
    echo ">>> 启动 Celery cron worker..."
    cd "$BACKEND_DIR"
    "$VENV_PYTHON" -m celery -A app.tasks.celery_app worker --loglevel=info -c 1 -Q pingcha.cron -P solo
}

start_celery_beat() {
    echo ">>> 启动 Celery beat..."
    cd "$BACKEND_DIR"
    "$VENV_PYTHON" -m celery -A app.tasks.celery_app beat --loglevel=info
}

start_frontend() {
    echo ">>> 启动 Frontend (Next.js)..."
    cd "$FRONTEND_DIR"
    npm run dev
}

case "${1:-all}" in
    infra)     start_infra ;;
    backend)   start_backend ;;
    celery)    start_celery_fast ;;
    pipeline)  start_celery_pipeline ;;
    cron)      start_celery_cron ;;
    beat)      start_celery_beat ;;
    frontend)  start_frontend ;;
    all)
        trap cleanup SIGINT SIGTERM

        start_infra

        echo ">>> 启动 Backend..."
        (cd "$BACKEND_DIR" && "$VENV_PYTHON" -m uvicorn app.main:app --reload --reload-include '*.env' --port 8000) &
        PIDS+=($!)

        echo ">>> 启动 Celery Fast..."
        (cd "$BACKEND_DIR" && "$VENV_PYTHON" -m celery -A app.tasks.celery_app worker -Q pingcha -c 4 -P solo) &
        PIDS+=($!)

        echo ">>> 启动 Celery Pipeline..."
        (cd "$BACKEND_DIR" && "$VENV_PYTHON" -m celery -A app.tasks.celery_app worker -Q pingcha.pipeline -c 2 -P solo) &
        PIDS+=($!)

        echo ">>> 启动 Celery Beat..."
        (cd "$BACKEND_DIR" && "$VENV_PYTHON" -m celery -A app.tasks.celery_app beat) &
        PIDS+=($!)

        echo ">>> 启动 Frontend..."
        (cd "$FRONTEND_DIR" && npm run dev) &
        PIDS+=($!)

        echo ""
        echo "========================================="
        echo "  所有服务已启动"
        echo "  访问: http://localhost:3000"
        echo "  按 Ctrl+C 停止所有服务"
        echo "========================================="

        wait
        ;;
    *)
        echo "用法: bash start-local.sh [infra|backend|celery|pipeline|cron|beat|frontend|all]"
        ;;
esac
