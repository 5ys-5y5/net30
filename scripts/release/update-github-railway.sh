#!/usr/bin/env bash
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
PROJECT_ID="${RAILWAY_PROJECT_ID:-f9fd5482-8475-4178-b271-f7aa2007bd1d}"
ENVIRONMENT_ID="${RAILWAY_ENVIRONMENT_ID:-ede92c75-b65d-4c56-8496-0e51220d8c8f}"
PUBLIC_URL="${NET30_PUBLIC_URL:-https://net30-production.up.railway.app}"
COMMIT_MESSAGE="${1:-fix: stabilize 3d runtime and modeling studio}"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/net30-release.XXXXXX")"

cleanup() { rm -rf -- "$TEMP_DIR"; }
trap cleanup EXIT INT TERM

export GIT_PAGER=cat
export PAGER=cat
export LESS=FRX

cd "$REPO"

if [ "$(git branch --show-current)" != "main" ]; then
  echo "중단: GitHub 자동 배포 대상인 main 브랜치에서 실행하세요."
  exit 1
fi

git diff --check
npm --prefix docs/design-system run validate
npm --prefix docs/design-system run proof
npm run build
npm run check:railway

bash scripts/railway/sync-services.sh

git add -- \
  .gitignore \
  app/package.json \
  app/scripts \
  app/src/3d \
  app/src/main.tsx \
  app/src/modeling-studio \
  app/src/sku-data.ts \
  app/vite.config.ts \
  docs/design-system \
  scripts/3d \
  scripts/railway \
  scripts/release \
  server/railway-server.mjs

if ! git diff --cached --quiet; then
  git commit -m "$COMMIT_MESSAGE"
fi

COMMIT_SHA="$(git rev-parse HEAD)"
git push origin main

health_file="$TEMP_DIR/health.json"
for attempt in $(seq 1 120); do
  if curl -fsS "$PUBLIC_URL/health" -o "$health_file"; then
    deployed_sha="$(node -e 'const fs=require("fs"); const expected=process.argv[1]; const body=JSON.parse(fs.readFileSync(process.argv[2], "utf8")); process.exit(body.commitSha === expected ? 0 : 1);' "$COMMIT_SHA" "$health_file" 2>/dev/null && printf '%s' "$COMMIT_SHA" || true)"
    if [ "$deployed_sha" = "$COMMIT_SHA" ]; then
      break
    fi
  fi
  sleep 5
done

if [ "${deployed_sha:-}" != "$COMMIT_SHA" ]; then
  echo "중단: Railway가 새 main 커밋을 10분 안에 제공하지 않았습니다."
  exit 1
fi

curl -fsS "$PUBLIC_URL/model" -o /dev/null
curl -fsS "$PUBLIC_URL/3d/models/showcase-vial.glb" --range 0-3 -o "$TEMP_DIR/canonical.glb"
curl -fsS "$PUBLIC_URL/models/showcase-vial.glb" --range 0-3 -o "$TEMP_DIR/legacy.glb"

for model in "$TEMP_DIR/canonical.glb" "$TEMP_DIR/legacy.glb"; do
  if [ "$(LC_ALL=C head -c 4 "$model")" != "glTF" ]; then
    echo "중단: GLB 헤더 검증에 실패했습니다: $model"
    exit 1
  fi
done

echo "NET30_RELEASE_OK"
echo "commit=$COMMIT_SHA"
echo "storefront=$PUBLIC_URL/"
echo "model=$PUBLIC_URL/model"
echo "model-3d=$PUBLIC_URL/3d/models/showcase-vial.glb"
