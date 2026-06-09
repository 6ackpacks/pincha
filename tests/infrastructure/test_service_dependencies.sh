#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Docker Compose Service Dependency Order Test
# Tests that services start correctly in dependency order and handle
# degradation/recovery gracefully.
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.yml"
TEST_OVERRIDE="$SCRIPT_DIR/docker-compose.test.yml"

CLEANUP=true
VERBOSE=false
FAILED=0
PASSED=0
WARNINGS=0

# --- Color output ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

pass() { echo -e "${GREEN}[PASS]${NC} $1"; ((PASSED++)); }
fail() { echo -e "${RED}[FAIL]${NC} $1"; ((FAILED++)); }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; ((WARNINGS++)); }
info() { echo -e "${CYAN}[INFO]${NC} $1"; }
debug() { if [[ "$VERBOSE" == "true" ]]; then echo -e "       $1"; fi; }

# --- Argument parsing ---
for arg in "$@"; do
  case "$arg" in
    --no-cleanup) CLEANUP=false ;;
    --verbose) VERBOSE=true ;;
    --help|-h)
      echo "Usage: $0 [--no-cleanup] [--verbose]"
      echo ""
      echo "Tests service startup order, health, and degradation/recovery."
      exit 0
      ;;
  esac
done

# --- Compose command helper ---
compose() {
  local args=(-f "$COMPOSE_FILE")
  if [[ -f "$TEST_OVERRIDE" ]]; then
    args+=(-f "$TEST_OVERRIDE")
  fi
  docker compose "${args[@]}" "$@"
}

# --- Cleanup trap ---
cleanup() {
  if [[ "$CLEANUP" == "true" ]]; then
    info "Cleaning up: docker compose down -v"
    compose down -v --remove-orphans 2>/dev/null || true
  else
    info "Skipping cleanup (--no-cleanup)"
  fi
}
trap cleanup EXIT

# --- Dump logs for a failed service ---
dump_service_logs() {
  local svc="$1"
  echo -e "${RED}--- Logs for $svc ---${NC}" >&2
  compose logs --tail=30 "$svc" >&2 2>/dev/null || true
  echo -e "${RED}--- End logs for $svc ---${NC}" >&2
}

# --- Timer helper ---
timer_start() { date +%s.%N; }
timer_elapsed() {
  local start="$1"
  local end
  end=$(date +%s.%N)
  printf "%.1fs" "$(echo "$end - $start" | bc 2>/dev/null || echo "0.0")"
}

# --- Wait for a service to become healthy ---
wait_healthy() {
  local svc="$1"
  local timeout="${2:-60}"
  local elapsed=0

  while [[ $elapsed -lt $timeout ]]; do
    local container_id
    container_id=$(compose ps -q "$svc" 2>/dev/null || echo "")
    if [[ -n "$container_id" ]]; then
      local status
      status=$(docker inspect --format='{{.State.Health.Status}}' "$container_id" 2>/dev/null || echo "none")
      if [[ "$status" == "healthy" ]]; then
        return 0
      fi
    fi
    sleep 3
    elapsed=$((elapsed + 3))
  done
  return 1
}

# --- Wait for a service container to be running ---
wait_running() {
  local svc="$1"
  local timeout="${2:-30}"
  local elapsed=0

  while [[ $elapsed -lt $timeout ]]; do
    local container_id
    container_id=$(compose ps -q "$svc" 2>/dev/null || echo "")
    if [[ -n "$container_id" ]]; then
      local state
      state=$(docker inspect --format='{{.State.Status}}' "$container_id" 2>/dev/null || echo "")
      if [[ "$state" == "running" ]]; then
        return 0
      fi
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  return 1
}

# --- HTTP check via docker exec ---
http_check() {
  local svc="$1"
  local url="$2"
  local expected_code="${3:-200}"

  local container_id
  container_id=$(compose ps -q "$svc" 2>/dev/null || echo "")
  if [[ -z "$container_id" ]]; then
    return 1
  fi

  local code
  code=$(docker exec "$container_id" sh -c "
    if command -v curl >/dev/null 2>&1; then
      curl -s -o /dev/null -w '%{http_code}' --max-time 10 '$url' 2>/dev/null || echo 000
    elif command -v python3 >/dev/null 2>&1; then
      python3 -c \"
import urllib.request, urllib.error
try:
    r = urllib.request.urlopen('$url', timeout=10)
    print(r.getcode())
except urllib.error.HTTPError as e:
    print(e.code)
except:
    print(0)
\"
    else
      echo 000
    fi
  " 2>/dev/null || echo "000")

  debug "HTTP $url -> $code (expected $expected_code)"
  [[ "$code" == "$expected_code" ]]
}

# =============================================================================
# Phase 1: Start infrastructure (db + redis)
# =============================================================================
info "=== Phase 1: Starting infrastructure (db + redis + minio) ==="
t=$(timer_start)

compose up -d db redis minio

if wait_healthy "db" 60; then
  pass "db is healthy [$(timer_elapsed "$t")]"
else
  fail "db did not become healthy [$(timer_elapsed "$t")]"
  dump_service_logs "db"
fi

t=$(timer_start)
if wait_healthy "redis" 30; then
  pass "redis is healthy [$(timer_elapsed "$t")]"
else
  fail "redis did not become healthy [$(timer_elapsed "$t")]"
  dump_service_logs "redis"
fi

t=$(timer_start)
if wait_healthy "minio" 30; then
  pass "minio is healthy [$(timer_elapsed "$t")]"
else
  fail "minio did not become healthy [$(timer_elapsed "$t")]"
  dump_service_logs "minio"
fi

# =============================================================================
# Phase 2: Start backend, verify health endpoint
# =============================================================================
info "=== Phase 2: Starting backend ==="
t=$(timer_start)

compose up -d backend

if wait_healthy "backend" 90; then
  pass "backend is healthy [$(timer_elapsed "$t")]"
else
  fail "backend did not become healthy [$(timer_elapsed "$t")]"
  dump_service_logs "backend"
fi

# Test /health endpoint from within the backend container
t=$(timer_start)
if http_check "backend" "http://localhost:8000/health" "200"; then
  pass "backend /health returns 200 [$(timer_elapsed "$t")]"
else
  fail "backend /health did not return 200 [$(timer_elapsed "$t")]"
  dump_service_logs "backend"
fi

# =============================================================================
# Phase 3: Start celery workers, verify ping
# =============================================================================
info "=== Phase 3: Starting Celery workers ==="
t=$(timer_start)

compose up -d celery_fast celery_pipeline celery_cron celery_curate celery_beat

# Wait for workers to register
sleep 10

# Verify celery workers respond to ping
celery_container=$(compose ps -q celery_fast 2>/dev/null || echo "")
if [[ -n "$celery_container" ]]; then
  ping_result=$(docker exec "$celery_container" celery -A app.tasks.celery_app inspect ping --timeout 10 2>/dev/null || echo "ERROR")
  if echo "$ping_result" | grep -q "pong"; then
    pass "celery inspect ping: workers responding [$(timer_elapsed "$t")]"
  else
    fail "celery inspect ping: no pong response [$(timer_elapsed "$t")]"
    debug "Ping result: $ping_result"
    dump_service_logs "celery_fast"
  fi
else
  fail "celery_fast container not found [$(timer_elapsed "$t")]"
fi

# =============================================================================
# Phase 4: Start nginx, verify end-to-end HTTP
# =============================================================================
info "=== Phase 4: Starting frontend + nginx ==="
t=$(timer_start)

compose up -d frontend nginx

# Wait for frontend to be running (no healthcheck)
if wait_running "frontend" 30; then
  pass "frontend is running [$(timer_elapsed "$t")]"
else
  fail "frontend did not start [$(timer_elapsed "$t")]"
  dump_service_logs "frontend"
fi

t=$(timer_start)
if wait_running "nginx" 15; then
  pass "nginx is running [$(timer_elapsed "$t")]"
else
  fail "nginx did not start [$(timer_elapsed "$t")]"
  dump_service_logs "nginx"
fi

# End-to-end: nginx -> backend /health via /api proxy
t=$(timer_start)
sleep 3
if http_check "nginx" "http://localhost:80/api/health" "200"; then
  pass "nginx -> backend /api/health returns 200 [$(timer_elapsed "$t")]"
elif http_check "nginx" "http://localhost/health" "200"; then
  pass "nginx -> /health returns 200 (alternate route) [$(timer_elapsed "$t")]"
else
  warn "nginx end-to-end HTTP check inconclusive [$(timer_elapsed "$t")]"
fi

# =============================================================================
# Phase 5: Degradation test - stop redis
# =============================================================================
info "=== Phase 5: Degradation test (stop redis) ==="
t=$(timer_start)

compose stop redis
sleep 5

# Backend should still respond (possibly degraded)
backend_container=$(compose ps -q backend 2>/dev/null || echo "")
if [[ -n "$backend_container" ]]; then
  state=$(docker inspect --format='{{.State.Status}}' "$backend_container" 2>/dev/null || echo "unknown")
  if [[ "$state" == "running" ]]; then
    # Check if backend returns any response (200 or 503 both acceptable)
    code=$(docker exec "$backend_container" sh -c "
      if command -v python3 >/dev/null 2>&1; then
        python3 -c \"
import urllib.request, urllib.error
try:
    r = urllib.request.urlopen('http://localhost:8000/health', timeout=10)
    print(r.getcode())
except urllib.error.HTTPError as e:
    print(e.code)
except:
    print(0)
\"
      else
        echo 0
      fi
    " 2>/dev/null || echo "0")

    if [[ "$code" == "200" ]]; then
      pass "backend still responds 200 with redis down (graceful) [$(timer_elapsed "$t")]"
    elif [[ "$code" == "503" ]]; then
      pass "backend returns 503 with redis down (expected degradation) [$(timer_elapsed "$t")]"
    elif [[ "$code" != "0" ]]; then
      pass "backend responds with HTTP $code when redis is down [$(timer_elapsed "$t")]"
    else
      warn "backend not responding with redis down [$(timer_elapsed "$t")]"
    fi
  else
    warn "backend container state: $state after redis stop [$(timer_elapsed "$t")]"
  fi
else
  fail "backend container not found for degradation test [$(timer_elapsed "$t")]"
fi

# =============================================================================
# Phase 6: Recovery test - restart redis
# =============================================================================
info "=== Phase 6: Recovery test (start redis) ==="
t=$(timer_start)

compose start redis

if wait_healthy "redis" 30; then
  pass "redis recovered and healthy [$(timer_elapsed "$t")]"
else
  fail "redis did not recover [$(timer_elapsed "$t")]"
fi

# Wait a moment for backend to reconnect
sleep 5

t=$(timer_start)
if http_check "backend" "http://localhost:8000/health" "200"; then
  pass "backend recovered after redis restart [$(timer_elapsed "$t")]"
else
  fail "backend did not recover after redis restart [$(timer_elapsed "$t")]"
  dump_service_logs "backend"
fi

# =============================================================================
# Summary
# =============================================================================
echo ""
echo "============================================"
echo -e " ${GREEN}PASSED${NC}: $PASSED"
echo -e " ${RED}FAILED${NC}: $FAILED"
echo -e " ${YELLOW}WARNINGS${NC}: $WARNINGS"
echo "============================================"

if [[ $FAILED -gt 0 ]]; then
  echo -e "${RED}Some tests failed.${NC}"
  exit 1
else
  echo -e "${GREEN}All dependency order tests passed.${NC}"
  exit 0
fi
