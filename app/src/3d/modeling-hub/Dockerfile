FROM node:22-bookworm-slim

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends blender ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . ./

ENV NODE_ENV=production \
    BLENDER_BIN=/usr/bin/blender \
    NET30_3D_ASSET_ROOT=/data \
    HOST=0.0.0.0

EXPOSE 8788
CMD ["npm", "start"]
