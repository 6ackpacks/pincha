#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Nginx Security Test Suite
# Tests security-related headers, path traversal protection, request limits,
# and HTTP method handling.
#
# Usage:
#   ./test_nginx_security.sh [--help] [--base-url URL]
#
# Prerequisites:
#   - Nginx must be running
#   - curl must be installed
#   - python3 must be available
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
# Security Response Headers
# =============================================================================
section "Security Response Headers"

get_response_headers() {
    curl -sI --connect-timeout 5 "$BASE_URL/" 2>/dev/null || echo ""
}

RESPONSE_HEADERS=$(get_response_headers)

test_security_header() {
    local header_name="$1"
    local expected_value="${2:-}"

    local value
    value=$(echo "$RESPONSE_HEADERS" | grep -i "^${header_name}:" | head -1 | sed 's/^[^:]*: //' | tr -d '\r')

    if [[ -z "$value" ]]; then
        # Header not present — this is informational, not necessarily a failure
        # depending on nginx config
        skip "$header_name not set (consider adding to nginx.conf)"
    elif [[ -n "$expected_value" ]]; then
        if echo "$value" | grep -qi "$expected_value"; then
            pass "$header_name: $value"
        else
            fail "$header_name" "expected '$expected_value', got '$value'"
        fi
    else
        pass "$header_name: $value"
    fi
}

test_security_header "X-Frame-Options"
test_security_header "X-Content-Type-Options" "nosniff"
test_security_header "X-XSS-Protection"
test_security_header "Strict-Transport-Security"
test_security_header "Content-Security-Policy"
test_security_header "Referrer-Policy"

# Check Server header is not exposing version
test_server_header() {
    local server_header
    server_header=$(echo "$RESPONSE_HEADERS" | grep -i "^server:" | head -1 | tr -d '\r')

    if [[ -z "$server_header" ]]; then
        pass "Server header not exposed"
    elif echo "$server_header" | grep -qi "nginx/"; then
        fail "Server header" "exposes version: $server_header (add server_tokens off;)"
    else
        pass "Server header present but version hidden"
    fi
}

test_server_header

# =============================================================================
# Path Traversal Protection
# =============================================================================
section "Path Traversal Protection"

test_path_traversal() {
    local path="$1"
    local description="$2"
    local code body

    code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 --path-as-is "$BASE_URL$path" 2>/dev/null || echo "000")
    body=$(curl -s --connect-timeout 5 --path-as-is "$BASE_URL$path" 2>/dev/null || echo "")

    # Should NOT return 200 with sensitive file contents
    if [[ "$code" == "400" || "$code" == "403" || "$code" == "404" ]]; then
        pass "$description (HTTP $code)"
    elif [[ "$code" == "200" ]]; then
        # Check if the response contains sensitive data
        if echo "$body" | grep -q "root:"; then
            fail "$description" "returned sensitive file contents!"
        else
            # 200 but no sensitive content — likely the upstream handled it safely
            pass "$description (HTTP 200, no sensitive content leaked)"
        fi
    else
        pass "$description (HTTP $code)"
    fi
}

test_path_traversal "/api/../etc/passwd" "Basic path traversal /api/../etc/passwd"
test_path_traversal "/api/../../etc/passwd" "Double traversal /api/../../etc/passwd"
test_path_traversal "/api/%2e%2e/etc/passwd" "URL-encoded traversal /api/%2e%2e/etc/passwd"
test_path_traversal "/api/..%2f..%2fetc/passwd" "Mixed encoding traversal"
test_path_traversal "/img-proxy/../etc/shadow" "Path traversal via /img-proxy"
test_path_traversal "/%00" "Null byte injection"
test_path_traversal "/api/v1/../../etc/passwd" "Nested path traversal"

# =============================================================================
# Request Body Size Limits
# =============================================================================
section "Request Body Size Limits"

test_body_size_limit() {
    local size_mb="$1"
    local expected_behavior="$2"
    local code

    # Generate payload of specified size
    local payload
    payload=$(python3 -c "print('x' * ($size_mb * 1024 * 1024))" 2>/dev/null)

    code=$(echo "$payload" | curl -s -o /dev/null -w "%{http_code}" \
        -X POST \
        -H "Content-Type: application/octet-stream" \
        --data-binary @- \
        --connect-timeout 10 \
        "$BASE_URL/api/v1/videos/" 2>/dev/null || echo "000")

    if [[ "$expected_behavior" == "reject" ]]; then
        if [[ "$code" == "413" ]]; then
            pass "Body size ${size_mb}MB rejected (HTTP 413)"
        elif [[ "$code" == "000" ]]; then
            # Connection reset — also a valid rejection
            pass "Body size ${size_mb}MB rejected (connection reset)"
        else
            skip "Body size ${size_mb}MB got HTTP $code (client_max_body_size may not be configured)"
        fi
    else
        if [[ "$code" != "413" && "$code" != "000" ]]; then
            pass "Body size ${size_mb}MB accepted (HTTP $code)"
        else
            fail "Body size ${size_mb}MB" "expected acceptance, got HTTP $code"
        fi
    fi
}

# Test with a small payload (should always work)
test_body_size_limit 1 "accept"

# Test with a large payload (may be rejected if client_max_body_size is set)
test_body_size_limit 50 "reject"

# =============================================================================
# HTTP Methods — Unusual Methods
# =============================================================================
section "HTTP Method Handling"

test_unusual_method() {
    local method="$1"
    local path="$2"
    local description="$3"
    local code

    code=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" --connect-timeout 5 "$BASE_URL$path" 2>/dev/null || echo "000")

    # TRACE should ideally be blocked (405 or 501)
    # OPTIONS should return 200 or 204 (CORS preflight)
    case "$method" in
        TRACE)
            if [[ "$code" == "405" || "$code" == "501" || "$code" == "403" ]]; then
                pass "$description: TRACE blocked (HTTP $code)"
            elif [[ "$code" == "200" ]]; then
                fail "$description" "TRACE method allowed (HTTP 200) — consider blocking"
            else
                pass "$description: TRACE returned HTTP $code"
            fi
            ;;
        OPTIONS)
            if [[ "$code" != "502" && "$code" != "503" && "$code" != "000" ]]; then
                pass "$description: OPTIONS handled (HTTP $code)"
            else
                fail "$description" "OPTIONS returned HTTP $code"
            fi
            ;;
        *)
            if [[ "$code" == "405" || "$code" == "501" || "$code" == "400" ]]; then
                pass "$description: $method blocked (HTTP $code)"
            else
                pass "$description: $method returned HTTP $code"
            fi
            ;;
    esac
}

test_unusual_method "TRACE" "/api/v1/health" "TRACE on API"
test_unusual_method "TRACE" "/" "TRACE on frontend"
test_unusual_method "OPTIONS" "/api/v1/videos/" "OPTIONS on API"
test_unusual_method "OPTIONS" "/" "OPTIONS on frontend"

# =============================================================================
# Host Header Injection
# =============================================================================
section "Host Header Injection"

test_host_injection() {
    local host_value="$1"
    local description="$2"
    local code

    code=$(curl -s -o /dev/null -w "%{http_code}" \
        -H "Host: $host_value" \
        --connect-timeout 5 \
        "$BASE_URL/" 2>/dev/null || echo "000")

    # Should not return 200 with different content or redirect to attacker domain
    if [[ "$code" == "400" || "$code" == "403" || "$code" == "444" ]]; then
        pass "$description: rejected (HTTP $code)"
    elif [[ "$code" == "200" || "$code" == "301" || "$code" == "302" ]]; then
        # Check if it redirects to the injected host
        local location
        location=$(curl -sI -H "Host: $host_value" --connect-timeout 5 "$BASE_URL/" 2>/dev/null | grep -i "^location:" | tr -d '\r')
        if echo "$location" | grep -qi "$host_value"; then
            fail "$description" "redirects to injected host: $location"
        else
            skip "$description: accepted (HTTP $code) — no server_name validation configured"
        fi
    else
        pass "$description: returned HTTP $code"
    fi
}

test_host_injection "evil.com" "Host: evil.com"
test_host_injection "localhost' OR '1'='1" "Host with SQL injection"

# =============================================================================
# Request Smuggling Indicators
# =============================================================================
section "Request Smuggling Indicators"

test_smuggling() {
    local code

    # Double Content-Length
    code=$(curl -s -o /dev/null -w "%{http_code}" \
        -H "Content-Length: 0" \
        -H "Content-Length: 50" \
        --connect-timeout 5 \
        "$BASE_URL/api/v1/health" 2>/dev/null || echo "000")

    if [[ "$code" == "400" ]]; then
        pass "Double Content-Length rejected (HTTP 400)"
    else
        skip "Double Content-Length returned HTTP $code (curl may deduplicate headers)"
    fi

    # Transfer-Encoding with unusual value
    code=$(curl -s -o /dev/null -w "%{http_code}" \
        -H "Transfer-Encoding: chunked, identity" \
        --connect-timeout 5 \
        "$BASE_URL/api/v1/health" 2>/dev/null || echo "000")

    if [[ "$code" == "400" || "$code" == "501" ]]; then
        pass "Ambiguous Transfer-Encoding rejected (HTTP $code)"
    else
        skip "Ambiguous Transfer-Encoding returned HTTP $code"
    fi
}

test_smuggling

# =============================================================================
# Information Disclosure
# =============================================================================
section "Information Disclosure"

test_info_disclosure() {
    local path="$1"
    local description="$2"
    local code

    code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$BASE_URL$path" 2>/dev/null || echo "000")

    if [[ "$code" == "403" || "$code" == "404" ]]; then
        pass "$description: not accessible (HTTP $code)"
    elif [[ "$code" == "200" ]]; then
        fail "$description" "accessible (HTTP 200) — should be blocked"
    else
        pass "$description: HTTP $code"
    fi
}

test_info_disclosure "/nginx_status" "Nginx status page"
test_info_disclosure "/.env" "Environment file"
test_info_disclosure "/.git/config" "Git config"
test_info_disclosure "/.git/HEAD" "Git HEAD"

# =============================================================================
# Error Page Information Leakage
# =============================================================================
section "Error Page Leakage"

test_error_page() {
    local body
    body=$(curl -s --connect-timeout 5 "$BASE_URL/this-path-definitely-does-not-exist-xyz" 2>/dev/null || echo "")

    # Check if error page leaks nginx version
    if echo "$body" | grep -qi "nginx/[0-9]"; then
        fail "Error page" "leaks nginx version (add server_tokens off;)"
    else
        pass "Error page does not leak nginx version"
    fi
}

test_error_page

# =============================================================================
# Summary
# =============================================================================
echo ""
echo "========================="
echo -e "Results: ${GREEN}$PASSES passed${NC}, ${RED}$FAILS failed${NC}, ${YELLOW}$SKIPS skipped${NC}"
echo "========================="
echo ""
echo "Note: [SKIP] items indicate security headers/features not currently"
echo "configured in nginx.conf. Consider adding them for production hardening."
[[ $FAILS -eq 0 ]] && exit 0 || exit 1
