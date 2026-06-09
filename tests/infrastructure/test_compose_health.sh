#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Docker Compose Health & Connectivity Test Suite
# Tests that all services start healthy and can communicate with each other.
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.yml"
TEST_OVERRIDE="$SCRIPT_DIR/docker-compose.test.yml"

TIMEOUT=120
POLL_INTERVAL=5
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
NC='\033[0m' # No Color

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
    --timeout=*) TIMEOUT="${arg#*=}" ;;
    --help|-h)
      echo "Usage: $0 [--no-cleanup] [--verbose] [--timeout=SECONDS]"
      echo ""
      echo "Options:"
      echo "  --no-cleanup   Skip docker compose down on exit"
      echo "  --verbose      Show detailed output"
      echo "  --timeout=N    Max seconds to wait for healthy (default: 120)"
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
  compose logs --tail=50 "$svc" >&2 2>/dev/null || true
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

# =============================================================================
# Phase 1: Start services
# =============================================================================
info "Starting services from $COMPOSE_FILE"
phase_start=$(timer_start)
compose up -d
info "Services started [$(timer_elapsed "$phase_start")]"

# =============================================================================
# Phase 2: Wait for all services to become healthy
# =============================================================================
info "Waiting up to ${TIMEOUT}s for services to become healthy..."

SERVICES_WITH_HEALTHCHECK=(db redis minio backend)
elapsed=0
all_healthy=false

while [[ $elapsed -lt $TIMEOUT ]]; do
  all_healthy=true
  for svc in "${SERVICES_WITH_HEALTHCHECK[@]}"; do
    status=$(docker inspect --format='{{.State.Health.Status}}' "$(compose ps -q "$svc" 2>/dev/null)" 2>/dev/null || echo "missing")
    if [[ "$status" != "healthy" ]]; then
      all_healthy=false
      debug "$svc: $status (${elapsed}s elapsed)"
      break
    fi
  done

  if [[ "$all_healthy" == "true" ]]; then
    break
  fi

  sleep "$POLL_INTERVAL"
  elapsed=$((elapsed + POLL_INTERVAL))
done

if [[ "$all_healthy" == "true" ]]; then
  info "All healthchecked services are healthy [${elapsed}s]"
else
  fail "Timed out waiting for services to become healthy after ${TIMEOUT}s"
  for svc in "${SERVICES_WITH_HEALTHCHECK[@]}"; do
    status=$(docker inspect --format='{{.State.Health.Status}}' "$(compose ps -q "$svc" 2>/dev/null)" 2>/dev/null || echo "missing")
    if [[ "$status" != "healthy" ]]; then
      fail "$svc is $status"
      dump_service_logs "$svc"
    fi
  done
fi

# =============================================================================
# Phase 3: Check container states
# =============================================================================
info "Checking container states..."

ALL_SERVICES=(db redis minio backend frontend nginx celery_fast celery_pipeline celery_cron celery_curate celery_beat bgutil-provider rsshub)

for svc in "${ALL_SERVICES[@]}"; do
  t=$(timer_start)
  container_id=$(compose ps -q "$svc" 2>/dev/null || echo "")
  if [[ -z "$container_id" ]]; then
    warn "$svc: no container found [$(timer_elapsed "$t")]"
    continue
  fi

  state=$(docker inspect --format='{{.State.Status}}' "$container_id" 2>/dev/null || echo "unknown")
  if [[ "$state" == "running" ]]; then
    # Check if it has a healthcheck and whether it passed
    has_health=$(docker inspect --format='{{if .State.Health}}yes{{else}}no{{end}}' "$container_id" 2>/dev/null || echo "no")
    if [[ "$has_health" == "yes" ]]; then
      health=$(docker inspect --format='{{.State.Health.Status}}' "$container_id" 2>/dev/null || echo "unknown")
      if [[ "$health" == "healthy" ]]; then
        pass "$svc: running + healthy [$(timer_elapsed "$t")]"
      else
        fail "$svc: running but health=$health [$(timer_elapsed "$t")]"
        dump_service_logs "$svc"
      fi
    else
      pass "$svc: running (no healthcheck) [$(timer_elapsed "$t")]"
    fi
  elif [[ "$state" == "restarting" ]]; then
    fail "$svc: restarting [$(timer_elapsed "$t")]"
    dump_service_logs "$svc"
  elif [[ "$state" == "exited" ]]; then
    fail "$svc: exited [$(timer_elapsed "$t")]"
    dump_service_logs "$svc"
  else
    warn "$svc: state=$state [$(timer_elapsed "$t")]"
  fi
done

# =============================================================================
# Phase 4: Connectivity tests
# =============================================================================
info "Testing service connectivity..."

test_tcp_connectivity() {
  local from_svc="$1"
  local target_host="$2"
  local target_port="$3"
  local label="$4"
  local t
  t=$(timer_start)

  local container_id
  container_id=$(compose ps -q "$from_svc" 2>/dev/null || echo "")
  if [[ -z "$container_id" ]]; then
    fail "$label: source container $from_svc not found [$(timer_elapsed "$t")]"
    return
  fi

  # Try nc first, fall back to bash /dev/tcp, fall back to python
  local result
  result=$(docker exec "$container_id" sh -c "
    if command -v nc >/dev/null 2>&1; then
      nc -z -w 5 $target_host $target_port && echo OK || echo FAIL
    elif command -v python3 >/dev/null 2>&1; then
      python3 -c \"
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(5)
try:
    s.connect(('$target_host', $target_port))
    print('OK')
except:
    print('FAIL')
finally:
    s.close()
\"
    elif command -v python >/dev/null 2>&1; then
      python -c \"
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(5)
try:
    s.connect(('$target_host', $target_port))
    print('OK')
except:
    print('FAIL')
finally:
    s.close()
\"
    else
      echo SKIP
    fi
  " 2>/dev/null || echo "ERROR")

  case "$result" in
    OK) pass "$label [$(timer_elapsed "$t")]" ;;
    SKIP) warn "$label: no connectivity tool available [$(timer_elapsed "$t")]" ;;
    *) fail "$label [$(timer_elapsed "$t")]" ;;
  esac
}

# backend -> db:5432
test_tcp_connectivity "backend" "db" "5432" "backend -> db:5432"

# backend -> redis:6379
test_tcp_connectivity "backend" "redis" "6379" "backend -> redis:6379"

# backend -> minio:9000
test_tcp_connectivity "backend" "minio" "9000" "backend -> minio:9000"

# nginx -> backend:8000
test_tcp_connectivity "nginx" "backend" "8000" "nginx -> backend:8000"

# nginx -> frontend:3000
test_tcp_connectivity "nginx" "frontend" "3000" "nginx -> frontend:3000"

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
  echo -e "${GREEN}All tests passed.${NC}"
  exit 0
fi
