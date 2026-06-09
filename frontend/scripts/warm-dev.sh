#!/usr/bin/env bash
# Pre-warm all Next.js dev routes to eliminate first-visit compilation delay
# Usage: bash scripts/warm-dev.sh

BASE="http://localhost:3000"
ROUTES=(
  "/"
  "/videos"
  "/knowledge"
  "/curate"
  "/learn"
  "/login"
)

echo "Warming up dev server routes..."
for route in "${ROUTES[@]}"; do
  curl -s -o /dev/null -w "  %{url_effective} → %{http_code} (%{time_total}s)\n" "$BASE$route"
done
echo "Done. All routes compiled."
