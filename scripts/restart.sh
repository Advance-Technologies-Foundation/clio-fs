#!/usr/bin/env bash
# Restart clio-fs server and client-ui.
# Usage: ./scripts/restart.sh [--all]  (--all also restarts client-ui)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_SERVER="$REPO_ROOT/.clio-fs/logs/server.log"
LOG_CLIENT_UI="$REPO_ROOT/.clio-fs/logs/client-ui.log"

mkdir -p "$(dirname "$LOG_SERVER")"

echo "▶ Stopping running processes..."

# Kill anything on the known ports
for port in 4010 4020 4030; do
  pids=$(lsof -i "TCP:$port" -t 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "  killing port $port (pids: $pids)"
    echo "$pids" | xargs kill -9 2>/dev/null || true
  fi
done

# Also kill by process name (handles watch-mode parents)
pkill -f "dev-server.mjs"    2>/dev/null || true
pkill -f "dev-client-ui.mjs" 2>/dev/null || true
pkill -f "dev-compiled.mjs"  2>/dev/null || true

sleep 1

echo "▶ Starting server (ports 4010 + 4020)..."
cd "$REPO_ROOT"
corepack pnpm run server >> "$LOG_SERVER" 2>&1 &
SERVER_PID=$!
echo "  server PID: $SERVER_PID → logs: $LOG_SERVER"

echo "▶ Starting client-ui (port 4030)..."
corepack pnpm run client-ui >> "$LOG_CLIENT_UI" 2>&1 &
CLIENT_UI_PID=$!
echo "  client-ui PID: $CLIENT_UI_PID → logs: $LOG_CLIENT_UI"

# Wait for server-ui to be ready
echo "▶ Waiting for server-ui..."
for i in $(seq 1 20); do
  if curl -s -o /dev/null http://127.0.0.1:4020/health 2>/dev/null; then
    echo "✓ Server UI ready at http://127.0.0.1:4020"
    break
  fi
  if curl -s -o /dev/null http://127.0.0.1:4010/health 2>/dev/null; then
    true  # server api is up, keep waiting for ui
  fi
  sleep 1
done

echo ""
echo "  Server API  → http://127.0.0.1:4010"
echo "  Server UI   → http://127.0.0.1:4020"
echo "  Client UI   → http://127.0.0.1:4030"
echo "  Logs UI     → http://127.0.0.1:4020/logs"
echo ""
echo "Press Ctrl+C to stop tailing logs (processes keep running)."
echo "─────────────────────────────────────────────────────────────"
tail -f "$LOG_SERVER" "$LOG_CLIENT_UI"
