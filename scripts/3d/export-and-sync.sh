#!/usr/bin/env bash
set -euo pipefail

REPO="$(
  cd "$(dirname "$0")/../.." &&
  pwd
)"

source "$REPO/.net30-3d.env"

BLENDER_BIN="${BLENDER_BIN:-/Applications/Blender.app/Contents/MacOS/Blender}"

if [ ! -x "$BLENDER_BIN" ]; then
  echo "중단: Blender 실행 파일을 찾지 못했습니다."
  echo "$BLENDER_BIN"
  exit 1
fi

if [ ! -f "$NET30_BLEND_FILE" ]; then
  echo "중단: Blender 원본 파일이 없습니다."
  echo "$NET30_BLEND_FILE"
  exit 1
fi

"$BLENDER_BIN" \
  --background \
  "$NET30_BLEND_FILE" \
  --python \
  "$REPO/scripts/3d/blender/export_runtime_assets.py" \
  -- \
  "$NET30_RENDER_GLB" \
  "$NET30_PHYSICS_GLB"

bash "$REPO/scripts/3d/sync-runtime-assets.sh"

npm --prefix "$NET30_3D_SERVICE_DIR" run build
rm -rf "$NET30_3D_SERVICE_DIR/dist"

echo "Blender export와 웹 서비스 검증 완료"
