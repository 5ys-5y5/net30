#!/usr/bin/env bash
set -euo pipefail

REPO="$(
  cd "$(dirname "$0")/../.." &&
  pwd
)"

source "$REPO/.net30-3d.env"

HOST_PID=""
SERVICE_PID=""

cleanup() {
  if [ -n "$HOST_PID" ]; then
    kill "$HOST_PID" >/dev/null 2>&1 || true
  fi

  if [ -n "$SERVICE_PID" ]; then
    kill "$SERVICE_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

if [ ! -f "$NET30_3D_SERVICE_DIR/package.json" ]; then
  echo "중단: 독립 3D 서비스가 설치되지 않았습니다."
  exit 1
fi

npm --prefix "$NET30_3D_SERVICE_DIR" run dev -- \
  --host 127.0.0.1 \
  --port 5174 &
SERVICE_PID="$!"

VITE_NET30_3D_SERVICE_URL="http://127.0.0.1:5174" \
npm --prefix "$REPO/app" run dev -- \
  --host 127.0.0.1 \
  --port 5173 &
HOST_PID="$!"

echo "NET30 Host: http://127.0.0.1:5173/"
echo "3D Service: http://127.0.0.1:5174/"
echo "종료: Ctrl+C"

wait
