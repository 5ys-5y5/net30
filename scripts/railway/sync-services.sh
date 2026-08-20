#!/usr/bin/env bash
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
PROJECT_ID="${RAILWAY_PROJECT_ID:-f9fd5482-8475-4178-b271-f7aa2007bd1d}"
ENVIRONMENT_ID="${RAILWAY_ENVIRONMENT_ID:-ede92c75-b65d-4c56-8496-0e51220d8c8f}"
WEB_SERVICE="${RAILWAY_WEB_SERVICE:-}"
HUB_SERVICE="${RAILWAY_MODELING_HUB_SERVICE:-net30-modeling-hub}"
PUBLIC_URL="${NET30_PUBLIC_URL:-https://net30-production.up.railway.app}"
ENV_FILE="$REPO/app/src/3d/modeling-hub/.env"
REPO_SLUG="5ys-5y5/net30"

export GIT_PAGER=cat
export PAGER=cat
export LESS=FRX

if ! command -v railway >/dev/null 2>&1; then
  echo "Railway CLI 설치"
  npm install -g @railway/cli
fi

if ! railway whoami >/dev/null 2>&1; then
  echo "Railway 로그인이 필요합니다. 브라우저 인증을 완료하세요."
  railway login
fi

railway link --project "$PROJECT_ID" --environment "$ENVIRONMENT_ID" --json >/dev/null

if [ -z "$WEB_SERVICE" ]; then
  echo
  railway status || true
  printf 'Railway 웹 서비스 이름 [net30]: ' >/dev/tty
  IFS= read -r WEB_SERVICE </dev/tty
  WEB_SERVICE="${WEB_SERVICE:-net30}"
fi

if ! railway variable list --service "$WEB_SERVICE" --environment "$ENVIRONMENT_ID" --json >/dev/null 2>&1; then
  echo "중단: Railway 웹 서비스를 찾지 못했습니다: $WEB_SERVICE"
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "중단: modeling-hub .env가 없습니다."
  echo "$ENV_FILE"
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [ -z "${NET30_MODELING_HUB_TOKEN:-}" ]; then
  NET30_MODELING_HUB_TOKEN="$(openssl rand -hex 32)"
  printf '\nNET30_MODELING_HUB_TOKEN=%s\n' "$NET30_MODELING_HUB_TOKEN" >> "$ENV_FILE"
fi

printf '%s' "$NET30_MODELING_HUB_TOKEN" |
  railway variable set NET30_MODELING_HUB_TOKEN --stdin \
    --service "$WEB_SERVICE" --environment "$ENVIRONMENT_ID" --skip-deploys >/dev/null

railway variable set \
  VITE_NET30_3D_SERVICE_URL=/3d \
  VITE_NET30_MODELING_HUB_URL=/api/modeling \
  --service "$WEB_SERVICE" --environment "$ENVIRONMENT_ID" --skip-deploys >/dev/null

REMOTE_MCP_URL="${NET30_BLENDER_MCP_URL:-}"
HUB_PUBLIC_URL=""

is_remote_mcp() {
  case "$REMOTE_MCP_URL" in
    https://127.0.0.1*|https://localhost*|http://127.0.0.1*|http://localhost*|"") return 1 ;;
    https://*|http://*) return 0 ;;
    *) return 1 ;;
  esac
}

extract_domain() {
  node -e '
    let input=""; process.stdin.on("data",c=>input+=c); process.stdin.on("end",()=>{
      let value; try { value=JSON.parse(input); } catch { process.exit(0); }
      const found=[];
      const walk=(item)=>{
        if(typeof item==="string" && /(?:https?:\/\/)?[a-z0-9-]+\.up\.railway\.app/i.test(item)) found.push(item);
        else if(Array.isArray(item)) item.forEach(walk);
        else if(item && typeof item==="object") Object.values(item).forEach(walk);
      };
      walk(value);
      if(found[0]) process.stdout.write(found[0].replace(/^https?:\/\//, ""));
    });
  '
}

if is_remote_mcp; then
  echo "원격 Blender MCP가 확인되어 Railway modeling-hub 서비스를 구성합니다."

  if ! railway variable list --service "$HUB_SERVICE" --environment "$ENVIRONMENT_ID" --json >/dev/null 2>&1; then
    railway add --service "$HUB_SERVICE" --json >/dev/null
  fi

  railway service source connect \
    --repo "$REPO_SLUG" --branch main \
    --service "$HUB_SERVICE" --environment "$ENVIRONMENT_ID" --project "$PROJECT_ID" >/dev/null

  railway environment edit --environment "$ENVIRONMENT_ID" \
    --service-config "$HUB_SERVICE" rootDirectory "app/src/3d/modeling-hub" \
    --message "Configure NET30 modeling hub root" >/dev/null

  printf '%s' "${OPENAI_API_KEY:-}" |
    railway variable set OPENAI_API_KEY --stdin \
      --service "$HUB_SERVICE" --environment "$ENVIRONMENT_ID" --skip-deploys >/dev/null
  printf '%s' "$NET30_MODELING_HUB_TOKEN" |
    railway variable set NET30_MODELING_HUB_TOKEN --stdin \
      --service "$HUB_SERVICE" --environment "$ENVIRONMENT_ID" --skip-deploys >/dev/null

  HUB_VARS=(
    "NET30_OPENAI_MODEL=${NET30_OPENAI_MODEL:-gpt-5}"
    "NET30_BLENDER_MCP_URL=$REMOTE_MCP_URL"
    "NET30_REPO=${NET30_REPO:-/workspace/net30}"
    "NET30_3D_ASSET_ROOT=${NET30_3D_ASSET_ROOT:-/workspace/net30-3d-assets}"
    "NET30_BLEND_FILE=${NET30_BLEND_FILE:-/workspace/net30-3d-assets/blender/vitamin-bottle/source/vitamin-bottle.blend}"
    "NET30_REFERENCE_IMAGE=${NET30_REFERENCE_IMAGE:-/workspace/net30-3d-assets/reference/vitamin-bottle/front.jpg}"
    "NET30_RENDER_GLB=${NET30_RENDER_GLB:-/workspace/net30-3d-assets/exports/render/vitamin-bottle-render.glb}"
    "NET30_PHYSICS_GLB=${NET30_PHYSICS_GLB:-/workspace/net30-3d-assets/exports/physics/vitamin-bottle-collider.glb}"
    "NET30_VITAMIN_GLB=${NET30_VITAMIN_GLB:-/workspace/net30-3d-assets/exports/render/vitamin-shapes.glb}"
    "NET30_QA_DIR=${NET30_QA_DIR:-/workspace/net30-3d-assets/qa/renders}"
    "NET30_MODELING_ALLOWED_ORIGINS=$PUBLIC_URL"
    "HOST=0.0.0.0"
  )
  railway variable set "${HUB_VARS[@]}" \
    --service "$HUB_SERVICE" --environment "$ENVIRONMENT_ID" --skip-deploys >/dev/null

  DOMAIN_JSON="$(railway domain list --service "$HUB_SERVICE" --environment "$ENVIRONMENT_ID" --project "$PROJECT_ID" --json 2>/dev/null || true)"
  HUB_DOMAIN="$(printf '%s' "$DOMAIN_JSON" | extract_domain)"
  if [ -z "$HUB_DOMAIN" ]; then
    DOMAIN_JSON="$(railway domain --service "$HUB_SERVICE" --environment "$ENVIRONMENT_ID" --project "$PROJECT_ID" --json)"
    HUB_DOMAIN="$(printf '%s' "$DOMAIN_JSON" | extract_domain)"
  fi
  if [ -z "$HUB_DOMAIN" ]; then
    echo "중단: Railway modeling-hub 도메인을 확인하지 못했습니다."
    exit 1
  fi
  HUB_PUBLIC_URL="https://$HUB_DOMAIN"
  railway variable set "NET30_MODELING_HUB_URL=$HUB_PUBLIC_URL" \
    --service "$WEB_SERVICE" --environment "$ENVIRONMENT_ID" --skip-deploys >/dev/null
else
  echo "원격 Blender MCP URL이 없어 Railway에서는 저장된 GLB만 제공합니다."
  railway variable delete NET30_MODELING_HUB_URL \
    --service "$WEB_SERVICE" --environment "$ENVIRONMENT_ID" --project "$PROJECT_ID" >/dev/null 2>&1 || true
fi

cat > "$REPO/.net30-railway.env" <<STATE
RAILWAY_PROJECT_ID=$PROJECT_ID
RAILWAY_ENVIRONMENT_ID=$ENVIRONMENT_ID
RAILWAY_WEB_SERVICE=$WEB_SERVICE
RAILWAY_MODELING_HUB_SERVICE=$HUB_SERVICE
NET30_PUBLIC_URL=$PUBLIC_URL
NET30_MODELING_HUB_URL=$HUB_PUBLIC_URL
STATE

grep -qxF '.net30-railway.env' "$REPO/.gitignore" || printf '%s\n' '.net30-railway.env' >> "$REPO/.gitignore"

echo "RAILWAY_VARIABLES_SYNCED"
echo "WEB_SERVICE=$WEB_SERVICE"
echo "MODELING_HUB_URL=${HUB_PUBLIC_URL:-local-only}"
