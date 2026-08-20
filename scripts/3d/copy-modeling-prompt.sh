#!/usr/bin/env bash
set -euo pipefail

REPO="$(
  cd "$(dirname "$0")/../.." &&
  pwd
)"

PROMPT="$REPO/scripts/3d/prompts/vitamin-bottle-modeling.md"

if [ ! -f "$PROMPT" ]; then
  echo "중단: 모델링 프롬프트가 없습니다."
  exit 1
fi

pbcopy < "$PROMPT"

echo "Blender MCP 모델링 프롬프트를 클립보드에 복사했습니다."
