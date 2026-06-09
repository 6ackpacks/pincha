#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Nginx Routing Test Suite
# Tests that Nginx correctly routes requests to the expected upstream services.
#
# Usage:
#   ./test_nginx_routing.sh [--help] [--base-url URL]
#
# Prerequisites:
#   - Services must be running (use docker-compose.nginx-test.yml for isolated testing)
#   - curl must be installed
#   - python3 must be available (for edge case tests)
#
# Environment:
#   BASE_URL  — Override the target URL (default: http://localhost:8888)
# =============================================================================

# --- Colors ---
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# --- Counters ---
PASSES=0
FAILS=0
SKIPS=0

# --- Helpers ---
pass() { echo -e "${GREEN}[PASS]${NC} $1"; PASSES=$((PASSES + 1)); }
fail() { echo -e "${RED}[FAIL]${NC} $1 — $2"; FAILS=$((FAILS + 1)); }
skip() { echo -e "${YELLOW}[SKIP]${NC} $1"; SKIPS=$((SKIPS + 1)); }
section() { echo -e "\n${BLUE}=== $1 ===${NC}"; }

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --help        Show this help message"
    echo "  --base-url    Override the base URL (default: http://localhost:8888)"
    echo ""
    echo "Environment variables:"
    echo "  BASE_URL      Same as --base-url"
    exit 0
}

# --- Parse args ---
while [[ $# -gt 0 ]]; do
    case "$1" in
        --help|-h) usage ;;
        --base-url) BASE_URL="$2"; shift 2 ;;
        *) echo "Unknown option: $1"; usage ;;
    esac
done

BASE_URL="${BASE_URL:-http://localhost:8888}"

# --- Connectivity check ---
echo "Testing against: $BASE_URL"
if ! curl -s -o /dev/null --connect-timeout 3 "$BASE_URL" 2>/dev/null; then
    echo -e "${RED}ERROR:${NC} Cannot connect to $BASE_URL"
    echo "Make sure Nginx is running. For isolated testing:"
    echo "  docker compose -f tests/infrastructure/docker-compose.nginx-test.yml up -d"
    exit 1
fi
echo ""

# =============================================================================
# Route Tests
# =============================================================================
section "Route Matching"

test_route() {
    local path="$1"
    local expected_upstream="$2"
    local description="${3:-}"
    local response

    response=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$BASE_URL$path" 2>/dev/null || echo "000")

    if [[ "$response" == "000" ]]; then
        fail "Route $path -> $expected_upstream" "connection failed"
    elif [[ "$response" != "502" && "$response" != "503" ]]; then
        pass "Route $path -> $expected_upstream (HTTP $response)${description:+ [$description]}"
    else
        fail "Route $path -> $expected_upstream" "got HTTP $response (upstream unreachable)"
    fi
}

test_route_with_body() {
    local path="$1"
    local expected_service="$2"
    local response body service

    body=$(curl -s --connect-timeout 5 "$BASE_URL$path" 2>/dev/null || echo "")
    if [[ -z "$body" ]]; then
        fail "Route $path -> $expected_service" "empty response"
        return
    fi

    # If mock upstream is running, verify the service name in response
    service=$(echo "$body" | python3 -c "import sys,json; print(json.load(sys.stdin).get('service',''))" 2>/dev/null || echo "")
    if [[ -n "$service" ]]; then
        if [[ "$service" == "$expected_service" ]]; then
            pass "Route $path -> $expected_service (verified via mock)"
        else
            fail "Route $path -> $expected_service" "routed to '$service' instead"
        fi
    else
        # Not using mock upstream; just check it's reachable
        local code
        code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$BASE_URL$path" 2>/dev/null || echo "000")
        if [[ "$code" != "502" && "$code" != "503" && "$code" != "000" ]]; then
            pass "Route $path -> $expected_service (HTTP $code, no mock verification)"
        else
            fail "Route $path -> $expected_service" "HTTP $code"
        fi
    fi
}

# --- Backend routes (/api) ---
test_route "/api/v1/health" "backend" "API health endpoint"
test_route "/api/v1/videos/" "backend" "videos list"
test_route "/api/v1/videos/123" "backend" "video detail"
test_route "/api/v1/videos/123/summary" "backend" "video summary"

# --- Health endpoint (direct /health) ---
test_route "/health" "backend" "root health check"

# --- Image proxy ---
test_route "/img-proxy?url=https://example.com/img.jpg" "backend" "image proxy"

# --- Frontend routes (catch-all /) ---
test_route "/" "frontend" "root page"
test_route "/dashboard" "frontend" "dashboard page"
test_route "/videos/123" "frontend" "video detail page"
test_route "/login" "frontend" "login page"
test_route "/settings" "frontend" "settings page"

# =============================================================================
# Route Verification with Mock Upstream
# =============================================================================
section "Mock Upstream Verification"

test_route_with_body "/api/v1/health" "backend"
test_route_with_body "/" "frontend"
test_route_with_body "/img-proxy?url=test" "backend"
test_route_with_body "/health" "backend"

# =============================================================================
# Proxy Headers
# =============================================================================
section "Proxy Headers"

test_proxy_headers() {
    local body headers

    body=$(curl -s --connect-timeout 5 "$BASE_URL/api/v1/health" 2>/dev/null || echo "")
    headers=$(echo "$body" | python3 -c "
import sys, json
try:
    h = json.load(sys.stdin).get('headers', {})
    for k, v in h.items():
        print(f'{k}: {v}')
except:
    pass
" 2>/dev/null || echo "")

    if [[ -z "$headers" ]]; then
        skip "Cannot verify proxy headers (mock not running)"
        return
    fi

    # X-Real-IP should be set
    if echo "$headers" | grep -qi "x-real-ip"; then
        pass "X-Real-IP header forwarded"
    else
        fail "X-Real-IP" "header not found in upstream request"
    fi

    # X-Forwarded-For should be set
    if echo "$headers" | grep -qi "x-forwarded-for"; then
        pass "X-Forwarded-For header forwarded"
    else
        fail "X-Forwarded-For" "header not found in upstream request"
    fi

    # X-Forwarded-Proto should be set
    if echo "$headers" | grep -qi "x-forwarded-proto"; then
        pass "X-Forwarded-Proto header forwarded"
    else
        fail "X-Forwarded-Proto" "header not found in upstream request"
    fi

    # Host header should be preserved
    if echo "$headers" | grep -qi "host"; then
        pass "Host header forwarded"
    else
        fail "Host header" "not found in upstream request"
    fi
}

test_proxy_headers

# =============================================================================
# WebSocket Upgrade (frontend)
# =============================================================================
section "WebSocket Support"

test_websocket_headers() {
    local body connection_header upgrade_header

    body=$(curl -s --connect-timeout 5 \
        -H "Upgrade: websocket" \
        -H "Connection: upgrade" \
        "$BASE_URL/_next/webpack-hmr" 2>/dev/null || echo "")

    # Check if the upstream received the upgrade headers
    upgrade_header=$(echo "$body" | python3 -c "
import sys, json
try:
    h = json.load(sys.stdin).get('headers', {})
    print(h.get('Upgrade', h.get('upgrade', '')))
except:
    pass
" 2>/dev/null || echo "")

    if [[ "$upgrade_header" == "websocket" ]]; then
        pass "WebSocket Upgrade header forwarded to frontend"
    elif [[ -z "$upgrade_header" ]]; then
        skip "Cannot verify WebSocket headers (mock may not support or non-JSON response)"
    else
        fail "WebSocket Upgrade" "got '$upgrade_header' instead of 'websocket'"
    fi
}

test_websocket_headers

# =============================================================================
# Edge Cases
# =============================================================================
section "Edge Cases"

# Long URL
test_long_url() {
    local long_path code
    long_path=$(python3 -c "print('/api/v1/test/' + 'a' * 2048)" 2>/dev/null)
    code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$BASE_URL$long_path" 2>/dev/null || echo "000")
    if [[ "$code" == "414" || "$code" == "404" || "$code" == "200" ]]; then
        pass "Long URL handled gracefully (HTTP $code)"
    else
        fail "Long URL" "unexpected HTTP $code"
    fi
}

# Query string preservation
test_query_string() {
    local body query
    body=$(curl -s --connect-timeout 5 "$BASE_URL/api/v1/health?foo=bar&baz=qux" 2>/dev/null || echo "")
    query=$(echo "$body" | python3 -c "
import sys, json
try:
    q = json.load(sys.stdin).get('query', {})
    if 'foo' in q and 'baz' in q:
        print('ok')
    else:
        print('missing')
except:
    print('error')
" 2>/dev/null || echo "error")

    if [[ "$query" == "ok" ]]; then
        pass "Query string preserved through proxy"
    elif [[ "$query" == "error" ]]; then
        skip "Cannot verify query string (mock not running)"
    else
        fail "Query string" "parameters lost in proxy"
    fi
}

# Trailing slash handling
test_trailing_slash() {
    local code_with code_without
    code_with=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$BASE_URL/api/v1/videos/" 2>/dev/null || echo "000")
    code_without=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$BASE_URL/api/v1/videos" 2>/dev/null || echo "000")

    if [[ "$code_with" != "502" && "$code_with" != "503" && "$code_with" != "000" ]] &&
       [[ "$code_without" != "502" && "$code_without" != "503" && "$code_without" != "000" ]]; then
        pass "Trailing slash: /api/v1/videos/ (HTTP $code_with) and /api/v1/videos (HTTP $code_without)"
    else
        fail "Trailing slash" "with=$code_with without=$code_without"
    fi
}

test_long_url
test_query_string
test_trailing_slash

# =============================================================================
# HTTP Methods
# =============================================================================
section "HTTP Methods"

test_method() {
    local method="$1"
    local path="$2"
    local code

    code=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" --connect-timeout 5 "$BASE_URL$path" 2>/dev/null || echo "000")
    if [[ "$code" != "502" && "$code" != "503" && "$code" != "000" ]]; then
        pass "$method $path (HTTP $code)"
    else
        fail "$method $path" "HTTP $code"
    fi
}

test_method "GET" "/api/v1/health"
test_method "POST" "/api/v1/videos/"
test_method "PUT" "/api/v1/videos/1"
test_method "DELETE" "/api/v1/videos/1"
test_method "PATCH" "/api/v1/videos/1"

# =============================================================================
# Summary
# =============================================================================
echo ""
echo "========================="
echo -e "Results: ${GREEN}$PASSES passed${NC}, ${RED}$FAILS failed${NC}, ${YELLOW}$SKIPS skipped${NC}"
echo "========================="
[[ $FAILS -eq 0 ]] && exit 0 || exit 1
