#!/usr/bin/env bash
set -Eeuo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
ASSET_ROOT="${NET30_3D_ASSET_ROOT:-$REPO/../net30-3d-assets}"
MODEL_ID="vitamin-bottle"
MCP_ROOT="${BLENDER_MCP_ROOT:-$HOME/.local/share/blender_mcp}"
PYTHON_BIN="${PYTHON_BIN:-python3}"

mkdir -p \
  "$ASSET_ROOT/blender/$MODEL_ID/source" \
  "$ASSET_ROOT/blender/$MODEL_ID/textures" \
  "$ASSET_ROOT/blender/$MODEL_ID/renders" \
  "$ASSET_ROOT/blender/$MODEL_ID/cache" \
  "$ASSET_ROOT/exports/render" \
  "$ASSET_ROOT/exports/physics" \
  "$ASSET_ROOT/jobs" \
  "$MCP_ROOT"

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "중단: Python 3 실행 파일을 찾지 못했습니다: $PYTHON_BIN"
  exit 1
fi

if [ ! -x "$MCP_ROOT/.venv/bin/python" ]; then
  "$PYTHON_BIN" -m venv "$MCP_ROOT/.venv"
fi

"$MCP_ROOT/.venv/bin/python" -m pip install --upgrade pip wheel

if [ -d "$MCP_ROOT/source/.git" ]; then
  if [ -n "$(git -C "$MCP_ROOT/source" status --porcelain)" ]; then
    echo "중단: Blender MCP source에 로컬 변경이 있습니다."
    git -C "$MCP_ROOT/source" status --short
    exit 1
  fi
  git -C "$MCP_ROOT/source" fetch --prune origin
  git -C "$MCP_ROOT/source" pull --ff-only
else
  rm -rf "$MCP_ROOT/source"
  git clone https://projects.blender.org/lab/blender_mcp.git "$MCP_ROOT/source"
fi

if [ -f "$MCP_ROOT/source/pyproject.toml" ]; then
  "$MCP_ROOT/.venv/bin/python" -m pip install -e "$MCP_ROOT/source"
elif [ -f "$MCP_ROOT/source/mcp/pyproject.toml" ]; then
  "$MCP_ROOT/.venv/bin/python" -m pip install -e "$MCP_ROOT/source/mcp"
else
  echo "중단: Blender MCP Python package 위치를 찾지 못했습니다."
  echo "$MCP_ROOT/source"
  exit 1
fi

if [ ! -x "$MCP_ROOT/.venv/bin/blender-mcp" ]; then
  echo "중단: Blender MCP 실행 파일이 설치되지 않았습니다."
  echo "$MCP_ROOT/.venv/bin/blender-mcp"
  exit 1
fi

cat > "$REPO/.net30-3d.env" <<ENVEOF
NET30_REPO="$REPO"
NET30_3D_ASSET_ROOT="$ASSET_ROOT"
NET30_BLEND_FILE="$ASSET_ROOT/blender/$MODEL_ID/source/vitamin-bottle.blend"
NET30_RENDER_GLB="$ASSET_ROOT/exports/render/vitamin-bottle-render.glb"
NET30_PHYSICS_GLB="$ASSET_ROOT/exports/physics/vitamin-bottle-collider.glb"
NET30_VITAMIN_GLB="$ASSET_ROOT/exports/render/vitamin-shapes.glb"
BLENDER_MCP_ROOT="$MCP_ROOT"
NET30_BLENDER_MCP_COMMAND="bash"
NET30_BLENDER_MCP_ARGS="$REPO/scripts/3d/start-blender-mcp.sh"
ENVEOF

grep -qxF '.net30-3d.env' "$REPO/.gitignore" || printf '%s\n' '.net30-3d.env' >> "$REPO/.gitignore"

echo "NET30 3D asset pipeline 준비 완료"
echo "$REPO/.net30-3d.env"
echo "Blender MCP executable: $MCP_ROOT/.venv/bin/blender-mcp"
