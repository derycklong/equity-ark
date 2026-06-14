#!/usr/bin/env bash
# Start backend (port 8765) and frontend (port 5173) together.
# Usage: ./dev.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"

# --- Override production .env with localhost values for dev ---
# Note: both OAUTH_REDIRECT_URI and FRONTEND_URL must use the SAME hostname
# (127.0.0.1 or localhost) or the browser treats them as different origins
# and won't send the session cookie.
export ENV=dev
export OAUTH_REDIRECT_URI="http://localhost:8765/api/auth/google/callback"
export FRONTEND_URL="http://localhost:5173"
export CORS_ORIGINS="http://localhost:5173,http://127.0.0.1:5173"

cleanup() {
  jobs -p | xargs -r kill 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT

export PATH="$HOME/.local/bin:$PATH"

# Use a project-local venv if it exists, so the backend has all its deps
# (uvicorn, fastapi, yfinance, ...) without polluting the system Python.
VENV="$HOME/.local/venv"
if [ -x "$VENV/bin/python3" ]; then
  PYTHON="$VENV/bin/python3"
else
  PYTHON=python3
fi
echo ">>> using python: $PYTHON"

# Derive the host from OAUTH_REDIRECT_URI so the backend, frontend, and
# cookie all agree on the same origin. This is critical: if the OAuth
# callback lands on `localhost:8765` but the frontend serves on
# `127.0.0.1:5173`, the browser treats them as separate origins and the
# cookie is not sent — the user has to re-login on every page refresh.
HOST=""
if [ -f "$ROOT/backend/.env" ]; then
  HOST=$(grep -E '^OAUTH_REDIRECT_URI=' "$ROOT/backend/.env" 2>/dev/null \
         | sed -E 's|^OAUTH_REDIRECT_URI=https?://([^:/]+).*|\1|' \
         | tr -d '"' | tr -d "'" \
         | head -1 || true)
fi
HOST=${HOST:-localhost}
echo ">>> using host: $HOST (must match OAUTH_REDIRECT_URI in backend/.env if set)"

# Force-kill anything on the target ports
for port in 8765 5173; do
  pid=$(lsof -ti :"$port" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    echo ">>> killing port $port (pid $pid)"
    kill -9 $pid 2>/dev/null || true
  fi
done
sleep 0.5

echo ">>> starting backend on :8765"
(cd "$ROOT/backend" && "$PYTHON" -m uvicorn app.main:app --host "$HOST" --port 8765 --reload) &
BACKEND_PID=$!

echo ">>> starting frontend on :5173"
(cd "$ROOT/frontend" && npx vite --host "$HOST" --port 5173) &
FRONTEND_PID=$!

echo
echo "Backend  http://$HOST:8765  (docs at /docs)"
echo "Frontend http://$HOST:5173"
echo
wait
