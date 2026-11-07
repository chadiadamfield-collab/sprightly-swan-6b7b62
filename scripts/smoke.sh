#!/usr/bin/env bash
# Build the app, start the production server, and check it answers.
# Usage: bash scripts/smoke.sh        (from the project root)
set -euo pipefail
PORT="${PORT:-3123}"
export VITE_DATA_MODE="${VITE_DATA_MODE:-demo}"

echo "==> tests";  bun run test
echo "==> types";  bunx tsc --noEmit
echo "==> build";  bun run build

echo "==> start server on :$PORT"
PORT="$PORT" node .output/server/index.mjs >/tmp/smoke-server.log 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT

for i in $(seq 1 20); do
  code=$(curl -s -o /tmp/smoke-page.html -w '%{http_code}' "http://localhost:$PORT/" || true)
  [ "$code" = "200" ] && break
  sleep 1
done
[ "$code" = "200" ] || { echo "FAIL: HTTP $code"; cat /tmp/smoke-server.log; exit 1; }

echo "==> OK: server answered 200 ($(wc -c </tmp/smoke-page.html) bytes)"
