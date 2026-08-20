#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
if [ -f "$REPO/.net30-3d.env" ]; then source "$REPO/.net30-3d.env"; fi
HOST_PID=""
SERVICE_PID=""
HUB_PID=""
cleanup() {
  [ -n "$HOST_PID" ] && kill "$HOST_PID" >/dev/null 2>&1 || true
  [ -n "$SERVICE_PID" ] && kill "$SERVICE_PID" >/dev/null 2>&1 || true
  [ -n "$HUB_PID" ] && kill "$HUB_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM
npm --prefix "$REPO/app/src/3d/modeling-hub" run dev & HUB_PID="$!"
npm --prefix "$REPO/app/src/3d/vitamin-bottle-service" run dev & SERVICE_PID="$!"
VITE_NET30_3D_SERVICE_URL="http://127.0.0.1:5174" VITE_NET30_MODELING_HUB_URL="http://127.0.0.1:8787" npm --prefix "$REPO/app" run dev -- --host 127.0.0.1 --port 5173 & HOST_PID="$!"
echo "Host: http://127.0.0.1:5173/"
echo "Model page: http://127.0.0.1:5173/model"
echo "3D service: http://127.0.0.1:5174/"
echo "Modeling hub: http://127.0.0.1:8787/health"
wait
