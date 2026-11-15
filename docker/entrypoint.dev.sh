#!/bin/sh
set -e

echo "[dev] Starting Go API on http://0.0.0.0:4187..."
if [ -f /usr/local/bin/travel-api ]; then
  cd /app/apps/api && /usr/local/bin/travel-api &
else
  cd /app/apps/api && go run main.go &
fi
GO_PID=$!

echo "[dev] Starting Vite dev server on http://0.0.0.0:5173..."
cd /app && pnpm --filter @travel/web dev --host 0.0.0.0 &
VITE_PID=$!

cleanup() {
  echo "[dev] Shutting down services..."
  kill -TERM "$GO_PID" "$VITE_PID" 2>/dev/null || true
  wait "$GO_PID" 2>/dev/null || true
  wait "$VITE_PID" 2>/dev/null || true
}

trap cleanup INT TERM

# Wait for either process to terminate
while kill -0 "$GO_PID" 2>/dev/null && kill -0 "$VITE_PID" 2>/dev/null; do
  sleep 1
done
