#!/bin/bash
# Prevent common secrets and local environment files from being pushed.
# Prints only file paths and line numbers; never prints matched secret values.

set -euo pipefail

RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

PATTERNS=(
  'OPENAI_API_KEY[[:space:]]*=[[:space:]]*sk-[a-zA-Z0-9_-]{20,}'
  'ANTHROPIC_API_KEY[[:space:]]*=[[:space:]]*sk-ant-[a-zA-Z0-9_-]{20,}'
  'SENTRY_AUTH_TOKEN[[:space:]]*=[[:space:]]*sntrys_[a-zA-Z0-9]{20,}'
  'TYPELESS_API_KEY[[:space:]]*=[[:space:]]*[a-zA-Z0-9_./+=-]{20,}'
  '[A-Za-z0-9_]*API_KEY[[:space:]]*=[[:space:]]*[a-zA-Z0-9_./+=-]{20,}'
  '[A-Za-z0-9_]*SECRET[[:space:]]*=[[:space:]]*[a-zA-Z0-9_./+=-]{20,}'
  '[A-Za-z0-9_]*TOKEN[[:space:]]*=[[:space:]]*[a-zA-Z0-9_./+=-]{20,}'
  'JWT_SECRET_KEY[[:space:]]*=[[:space:]]*[a-zA-Z0-9_/+=-]{32,}'
  'AKIA[0-9A-Z]{16}'
  'gh[pousr]_[A-Za-z0-9_]{20,}'
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'
)

PLACEHOLDERS='your[-_]|replace[_-]?with|change[_-]?me|example|placeholder|local_dev|test[-_]?key|dummy'
ZERO_SHA=0000000000000000000000000000000000000000
FOUND=0

report() {
  if [ "$FOUND" -eq 0 ]; then
    echo -e "${RED}[pre-push] Secret scan blocked this push.${NC}"
    echo ""
  fi
  FOUND=1
}

while read -r local_ref local_sha remote_ref remote_sha; do
  if [ "$local_sha" = "$ZERO_SHA" ]; then
    continue
  fi

  if [ "$remote_sha" = "$ZERO_SHA" ]; then
    range="$(git merge-base HEAD main 2>/dev/null || echo "$local_sha")...$local_sha"
  else
    range="$remote_sha...$local_sha"
  fi

  changed_files=$(git diff --name-only "$range" 2>/dev/null || true)
  if [ -z "$changed_files" ]; then
    continue
  fi

  sensitive_files=$(echo "$changed_files" | grep -E '(^|/)\.env($|\.)|\.pem$|\.key$|\.p12$|\.pfx$|service-account.*\.json$|credentials.*\.json$' || true)
  if [ -n "$sensitive_files" ]; then
    report
    echo -e "${YELLOW}Sensitive local files are tracked in this push:${NC}"
    echo "$sensitive_files"
    echo ""
  fi

  while IFS= read -r file; do
    [ -z "$file" ] && continue
    [ -f "$file" ] || continue
    case "$file" in
      .env.example|frontend/.env.example|scripts/pre-push-hook.sh) continue ;;
    esac

    for pattern in "${PATTERNS[@]}"; do
      matches=$(grep -En "$pattern" "$file" 2>/dev/null | grep -Evi "$PLACEHOLDERS" || true)
      if [ -n "$matches" ]; then
        report
        echo -e "${YELLOW}Potential secret pattern:${NC} $pattern"
        echo "$matches" | awk -F: -v f="$file" '{print f ":" $1}' | head -5
        echo ""
      fi
    done
  done <<< "$changed_files"
done

if [ "$FOUND" -ne 0 ]; then
  echo -e "${RED}Remove the sensitive content or untrack local files before pushing.${NC}"
  exit 1
fi

echo "[pre-push] Secret scan passed"
