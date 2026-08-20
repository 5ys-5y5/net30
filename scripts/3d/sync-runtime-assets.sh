#!/usr/bin/env bash
set -euo pipefail

REPO="$(
  cd "$(dirname "$0")/../.." &&
  pwd
)"

source "$REPO/.net30-3d.env"

SOURCE_RENDER="$NET30_RENDER_GLB"
SOURCE_PHYSICS="$NET30_PHYSICS_GLB"
DESTINATION="$NET30_3D_SERVICE_DIR/public/models"

for FILE_TO_CHECK in \
  "$SOURCE_RENDER" \
  "$SOURCE_PHYSICS"
do
  if [ ! -f "$FILE_TO_CHECK" ]; then
    echo "중단: GLB 파일이 없습니다."
    echo "$FILE_TO_CHECK"
    exit 1
  fi

  MAGIC="$(
    dd if="$FILE_TO_CHECK" \
      bs=1 \
      count=4 \
      2>/dev/null
  )"

  if [ "$MAGIC" != "glTF" ]; then
    echo "중단: GLB v2 파일이 아닙니다."
    echo "$FILE_TO_CHECK"
    exit 1
  fi
done

if [ ! -d "$NET30_3D_SERVICE_DIR" ]; then
  echo "중단: 독립 3D 서비스 폴더가 없습니다."
  echo "$NET30_3D_SERVICE_DIR"
  exit 1
fi

mkdir -p "$DESTINATION"

install -m 0644 \
  "$SOURCE_RENDER" \
  "$DESTINATION/vitamin-bottle-render.glb"

install -m 0644 \
  "$SOURCE_PHYSICS" \
  "$DESTINATION/vitamin-bottle-collider.glb"

RENDER_SHA="$(
  shasum -a 256 \
    "$DESTINATION/vitamin-bottle-render.glb" |
  awk '{print $1}'
)"

PHYSICS_SHA="$(
  shasum -a 256 \
    "$DESTINATION/vitamin-bottle-collider.glb" |
  awk '{print $1}'
)"

RENDER_SIZE="$(
  stat -f '%z' \
    "$DESTINATION/vitamin-bottle-render.glb"
)"

PHYSICS_SIZE="$(
  stat -f '%z' \
    "$DESTINATION/vitamin-bottle-collider.glb"
)"

GENERATED_AT="$(
  date -u '+%Y-%m-%dT%H:%M:%SZ'
)"

cat > "$DESTINATION/asset-manifest.json" <<EOF
{
  "schemaVersion": 1,
  "generatedAt": "$GENERATED_AT",
  "sourceBlend": "$NET30_BLEND_FILE",
  "renderModel": {
    "file": "vitamin-bottle-render.glb",
    "sha256": "$RENDER_SHA",
    "bytes": $RENDER_SIZE
  },
  "physicsModel": {
    "file": "vitamin-bottle-collider.glb",
    "sha256": "$PHYSICS_SHA",
    "bytes": $PHYSICS_SIZE
  }
}
EOF

echo "런타임 GLB 동기화 완료"
echo "$DESTINATION"
