FROM node:22-bookworm-slim

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends blender ca-certificates python3-numpy python3-pip \
  && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir --break-system-packages cadquery==2.6.1

WORKDIR /app
COPY app/src/3d/modeling-hub/package.json app/src/3d/modeling-hub/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY app/src/3d/modeling-hub/ ./
COPY app/src/modeling-studio/sku-registry.json ./sku-registry.json
COPY app/src/3d/vitamin-bottle-service/public/models/showcase-vial.glb /opt/net30/showcase-vial.glb

ENV NODE_ENV=production \
    BLENDER_BIN=/usr/bin/blender \
    NET30_SHOWCASE_GLB=/opt/net30/showcase-vial.glb \
    NET30_3D_ASSET_ROOT=/data \
    HOST=0.0.0.0

EXPOSE 8788
CMD ["npm", "start"]
