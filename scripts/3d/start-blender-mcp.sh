#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
source "$REPO/.net30-3d.env"
EXECUTABLE="$BLENDER_MCP_ROOT/.venv/bin/blender-mcp"
if [ ! -x "$EXECUTABLE" ]; then
  echo "중단: Blender MCP 실행 파일이 없습니다."
  echo "$EXECUTABLE"
  exit 1
fi
exec "$EXECUTABLE"
