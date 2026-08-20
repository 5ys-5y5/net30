#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
source "$REPO/.net30-3d.env"
BLENDER_BIN="${BLENDER_BIN:-/Applications/Blender.app/Contents/MacOS/Blender}"
if [ ! -x "$BLENDER_BIN" ]; then
  echo "중단: Blender 실행 파일이 없습니다."
  echo "$BLENDER_BIN"
  exit 1
fi
if [ ! -f "$NET30_BLEND_FILE" ]; then
  echo "중단: Blender source 파일이 없습니다."
  echo "$NET30_BLEND_FILE"
  exit 1
fi
"$BLENDER_BIN" --background "$NET30_BLEND_FILE" --python "$REPO/scripts/3d/blender/export_runtime_assets.py" -- "$NET30_RENDER_GLB" "$NET30_PHYSICS_GLB" "$NET30_VITAMIN_GLB"
DEST="$REPO/app/src/3d/vitamin-bottle-service/public/models"
mkdir -p "$DEST"
install -m 0644 "$NET30_RENDER_GLB" "$DEST/vitamin-bottle-render.glb"
install -m 0644 "$NET30_PHYSICS_GLB" "$DEST/vitamin-bottle-collider.glb"
install -m 0644 "$NET30_VITAMIN_GLB" "$DEST/vitamin-shapes.glb"
cat > "$DEST/asset-manifest.json" <<MANIFEST
{
  "schemaVersion": 1,
  "renderModel": "vitamin-bottle-render.glb",
  "physicsModel": "vitamin-bottle-collider.glb",
  "vitaminModel": "vitamin-shapes.glb"
}
MANIFEST
echo "Blender export와 runtime sync 완료"
