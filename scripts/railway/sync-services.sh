#!/usr/bin/env bash
set -euo pipefail

# Configures the in-project headless Blender MCP service.  It intentionally
# uses Railway private networking: only the web service exposes generated GLBs.
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
PROJECT_ID="${RAILWAY_PROJECT_ID:-f9fd5482-8475-4178-b271-f7aa2007bd1d}"
ENVIRONMENT_ID="${RAILWAY_ENVIRONMENT_ID:-ede92c75-b65d-4c56-8496-0e51220d8c8f}"
WEB_SERVICE="${RAILWAY_WEB_SERVICE:-net30}"
HUB_SERVICE="${RAILWAY_MODELING_HUB_SERVICE:-net30-modeling-hub}"
PUBLIC_URL="${NET30_PUBLIC_URL:-https://net30-production.up.railway.app}"
ENV_FILE="$REPO/app/src/3d/modeling-hub/.env"
REPO_SLUG="5ys-5y5/net30"

export GIT_PAGER=cat PAGER=cat LESS=FRX

if ! command -v railway >/dev/null 2>&1; then
  npm install -g @railway/cli
fi
if ! railway whoami >/dev/null 2>&1; then
  railway login
fi
railway link --project "$PROJECT_ID" --environment "$ENVIRONMENT_ID" --json >/dev/null

if ! railway variable list --service "$WEB_SERVICE" --environment "$ENVIRONMENT_ID" --json >/dev/null 2>&1; then
  echo "중단: Railway 웹 서비스를 찾지 못했습니다: $WEB_SERVICE"
  exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "중단: modeling-hub .env가 없습니다: $ENV_FILE"
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

if ! railway variable list --service "$HUB_SERVICE" --environment "$ENVIRONMENT_ID" --json >/dev/null 2>&1; then
  railway add --service "$HUB_SERVICE" --json >/dev/null
fi
railway service source connect --repo "$REPO_SLUG" --branch main \
  --service "$HUB_SERVICE" --environment "$ENVIRONMENT_ID" --project "$PROJECT_ID" >/dev/null

# A volume is required because Railway deployments have ephemeral filesystems.
railway service link "$HUB_SERVICE" >/dev/null
if ! railway volume list --json | \
  node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{const x=JSON.parse(s);process.exit(JSON.stringify(x).includes("/data")?0:1)}catch{process.exit(1)}})'; then
  railway volume add --mount-path /data --json >/dev/null
fi

printf '%s' "$NET30_MODELING_HUB_TOKEN" | railway variable set NET30_MODELING_HUB_TOKEN --stdin \
  --service "$HUB_SERVICE" --environment "$ENVIRONMENT_ID" --skip-deploys >/dev/null
railway variable set \
  HOST=0.0.0.0 \
  PORT=8788 \
  RAILWAY_DOCKERFILE_PATH=app/src/3d/modeling-hub/Dockerfile \
  NET30_REPO=/app \
  NET30_3D_ASSET_ROOT=/data \
  "NET30_MODELING_ALLOWED_ORIGINS=$PUBLIC_URL" \
  --service "$HUB_SERVICE" --environment "$ENVIRONMENT_ID" --skip-deploys >/dev/null
railway environment edit \
  --project "$PROJECT_ID" \
  --environment "$ENVIRONMENT_ID" \
  --service-config "$HUB_SERVICE" deploy.startCommand "node src/server.mjs" \
  --service-config "$HUB_SERVICE" deploy.drainingSeconds 30 \
  --message "Configure direct Node startup and graceful draining for the modeling hub" \
  --json >/dev/null

printf '%s' "$NET30_MODELING_HUB_TOKEN" | railway variable set NET30_MODELING_HUB_TOKEN --stdin \
  --service "$WEB_SERVICE" --environment "$ENVIRONMENT_ID" --skip-deploys >/dev/null
railway variable set \
  VITE_NET30_3D_SERVICE_URL=/3d \
  VITE_NET30_MODELING_HUB_URL=/api/modeling \
  "NET30_MODELING_HUB_URL=http://${HUB_SERVICE}.railway.internal:8788" \
  --service "$WEB_SERVICE" --environment "$ENVIRONMENT_ID" --skip-deploys >/dev/null

cat > "$REPO/.net30-railway.env" <<STATE
RAILWAY_PROJECT_ID=$PROJECT_ID
RAILWAY_ENVIRONMENT_ID=$ENVIRONMENT_ID
RAILWAY_WEB_SERVICE=$WEB_SERVICE
RAILWAY_MODELING_HUB_SERVICE=$HUB_SERVICE
NET30_PUBLIC_URL=$PUBLIC_URL
NET30_MODELING_HUB_URL=http://${HUB_SERVICE}.railway.internal:8788
STATE

grep -qxF '.net30-railway.env' "$REPO/.gitignore" || printf '%s\n' '.net30-railway.env' >> "$REPO/.gitignore"
echo "RAILWAY_BLENDER_MCP_SYNCED"
