#!/usr/bin/env bash
# Restart clio-fs server and client-ui.
# Usage: ./scripts/restart.sh [--all]  (--all also restarts client-ui)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_SERVER="$REPO_ROOT/.clio-fs/logs/server.log"
LOG_CLIENT_UI="$REPO_ROOT/.clio-fs/logs/client-ui.log"
eval "$(node "$REPO_ROOT/scripts/test-runtime-ports.mjs" --format=shell)"

mkdir -p "$(dirname "$LOG_SERVER")"

echo "▶ Stopping running processes..."

# Kill anything on the reserved background-test ports
for port in "$BACKGROUND_TEST_SERVER_PORT" "$BACKGROUND_TEST_CLIENT_UI_PORT"; do
  pids=$(lsof -i "TCP:$port" -t 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "  killing port $port (pids: $pids)"
    echo "$pids" | xargs kill -9 2>/dev/null || true
  fi
done

# Also kill by process name (handles watch-mode parents)
pkill -f "dev-server.mjs" 2>/dev/null || true
pkill -f "dev-client-ui.mjs" 2>/dev/null || true
pkill -f "dev-compiled.mjs" 2>/dev/null || true

sleep 1

echo "▶ Starting server (background test port $BACKGROUND_TEST_SERVER_PORT)..."
cd "$REPO_ROOT"
corepack pnpm run server >> "$LOG_SERVER" 2>&1 &
SERVER_PID=$!
echo "  server PID: $SERVER_PID → logs: $LOG_SERVER"

echo "▶ Starting client-ui (background test port $BACKGROUND_TEST_CLIENT_UI_PORT)..."
corepack pnpm run client-ui >> "$LOG_CLIENT_UI" 2>&1 &
CLIENT_UI_PID=$!
echo "  client-ui PID: $CLIENT_UI_PID → logs: $LOG_CLIENT_UI"

# Wait for server to be ready
echo "▶ Waiting for server..."
for i in $(seq 1 20); do
  if curl -s -o /dev/null "$BACKGROUND_TEST_SERVER_ORIGIN/health" 2>/dev/null; then
    echo "✓ Server ready at $BACKGROUND_TEST_SERVER_ORIGIN"
    break
  fi
  sleep 1
done

echo ""
echo "  Server      → $BACKGROUND_TEST_SERVER_ORIGIN"
echo "  Server API  → $BACKGROUND_TEST_SERVER_API_ORIGIN"
echo "  Client UI   → $BACKGROUND_TEST_CLIENT_UI_ORIGIN"
echo "  Logs UI     → $BACKGROUND_TEST_SERVER_ORIGIN/logs"
echo ""
echo "Press Ctrl+C to stop tailing logs (processes keep running)."
echo "─────────────────────────────────────────────────────────────"
tail -f "$LOG_SERVER" "$LOG_CLIENT_UI"
