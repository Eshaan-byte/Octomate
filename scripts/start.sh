#!/usr/bin/env bash
# Container entrypoint: runs the ElizaOS agent and Next.js web server in
# parallel. If either process exits, we tear the whole container down so
# Nosana's healthcheck restarts the job.

set -euo pipefail

AGENT_PORT="${AGENT_PORT:-4111}"
PORT="${PORT:-3000}"

echo "[start] launching OctoMate"
echo "[start] agent port: $AGENT_PORT"
echo "[start] web port:   $PORT"
echo "[start] model:      ${OPENAI_MODEL:-unset}"
echo "[start] endpoint:   ${OPENAI_API_BASE_URL:-unset}"

cleanup() {
  echo "[start] shutting down"
  # Kill the whole process group
  kill 0 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Start the agent in the background
(
  cd /app/agent && node dist/index.js
) &
AGENT_PID=$!
echo "[start] agent pid: $AGENT_PID"

# Give the agent a moment to bind its port
sleep 2

# Start Next.js in the foreground
(
  cd /app/web && node_modules/.bin/next start -p "$PORT"
) &
WEB_PID=$!
echo "[start] web pid:   $WEB_PID"

# Wait for either child to exit; when one dies, the EXIT trap tears the rest down.
wait -n "$AGENT_PID" "$WEB_PID"
echo "[start] a child process exited; shutting down"
exit 1
