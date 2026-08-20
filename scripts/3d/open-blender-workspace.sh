#!/usr/bin/env bash
set -euo pipefail

REPO="$(
  cd "$(dirname "$0")/../.." &&
  pwd
)"

source "$REPO/.net30-3d.env"

if [ -f "$NET30_BLEND_FILE" ]; then
  open -a Blender "$NET30_BLEND_FILE"
else
  open -a Blender
  echo "새 파일 저장 위치:"
  echo "$NET30_BLEND_FILE"
fi
