import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const hostDist = resolve(root, "app/dist");
const threeDist = resolve(root, "app/src/3d/vitamin-bottle-service/dist");
const showcaseModel = resolve(threeDist, "models/showcase-vial.glb");
const port = Number(process.env.PORT ?? 3000);
const modelingHubUrl = (process.env.NET30_MODELING_HUB_URL ?? "").trim().replace(/\/$/, "");
const modelingHubToken = (process.env.NET30_MODELING_HUB_TOKEN ?? "").trim();
const commitSha = process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? "local";

const MIME = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"], [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"], [".svg", "image/svg+xml"],
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
  [".webp", "image/webp"], [".ico", "image/x-icon"], [".glb", "model/gltf-binary"],
  [".gltf", "model/gltf+json"], [".wasm", "application/wasm"], [".map", "application/json"],
]);

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
  });
  res.end(body);
}

function safePath(base, pathname) {
  const decoded = decodeURIComponent(pathname).replace(/^\/+/, "");
  const candidate = resolve(base, normalize(decoded));
  return candidate === base || candidate.startsWith(`${base}${sep}`) ? candidate : null;
}

function resolveStatic(base, pathname, allowSpaFallback) {
  const requested = safePath(base, pathname);
  if (requested && existsSync(requested)) {
    const info = statSync(requested);
    if (info.isFile()) return requested;
    if (info.isDirectory()) {
      const indexFile = join(requested, "index.html");
      if (existsSync(indexFile)) return indexFile;
    }
  }
  if (!allowSpaFallback || extname(pathname)) return null;
  const indexFile = resolve(base, "index.html");
  return existsSync(indexFile) ? indexFile : null;
}

function sendFile(req, res, filePath) {
  const info = statSync(filePath);
  const headers = {
    "content-type": MIME.get(extname(filePath).toLowerCase()) ?? "application/octet-stream",
    "accept-ranges": "bytes",
    "cache-control": filePath.endsWith("index.html")
      ? "no-cache"
      : filePath.includes(`${sep}assets${sep}`)
        ? "public, max-age=31536000, immutable"
        : "public, max-age=3600",
    "cross-origin-resource-policy": "cross-origin",
  };
  const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (match) {
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= info.size) {
      res.writeHead(416, { "content-range": `bytes */${info.size}` });
      return res.end();
    }
    res.writeHead(206, {
      ...headers,
      "content-length": end - start + 1,
      "content-range": `bytes ${start}-${end}/${info.size}`,
    });
    return createReadStream(filePath, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, "content-length": info.size });
  return createReadStream(filePath).pipe(res);
}

async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 11 * 1024 * 1024) throw new Error("Request body exceeds 10 MB");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function proxyModeling(req, res, url) {
  if (!modelingHubUrl) {
    return sendJson(res, 503, {
      ok: false,
      error: "원격 Blender MCP modeling backend가 설정되지 않았습니다.",
      localAction: "로컬에서는 npm --prefix app run dev를 실행하세요.",
      railwayAction: "NET30_BLENDER_MCP_URL을 제공한 뒤 별도 modeling-hub 서비스를 연결하세요.",
    });
  }
  const body = ["GET", "HEAD"].includes(req.method ?? "GET") ? undefined : await readBody(req);
  const headers = {
    "content-type": req.headers["content-type"] ?? "application/json",
    accept: req.headers.accept ?? "application/json",
  };
  if (modelingHubToken) headers.authorization = `Bearer ${modelingHubToken}`;
  const upstream = await fetch(`${modelingHubUrl}${url.pathname}${url.search}`, {
    method: req.method,
    headers,
    body,
    redirect: "manual",
  });
  res.statusCode = upstream.status;
  const type = upstream.headers.get("content-type");
  if (type) res.setHeader("content-type", type);
  res.setHeader("cache-control", "no-store");
  if (!upstream.body) return res.end();
  return Readable.fromWeb(upstream.body).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname === "/health") {
      return sendJson(res, 200, {
        ok: true,
        commitSha,
        hostBuild: existsSync(resolve(hostDist, "index.html")),
        threeBuild: existsSync(resolve(threeDist, "index.html")),
        showcaseModel: existsSync(showcaseModel),
        modelingProxyConfigured: Boolean(modelingHubUrl),
        uptimeSeconds: Math.round(process.uptime()),
      });
    }
    if (url.pathname.startsWith("/api/modeling")) return await proxyModeling(req, res, url);
    if (url.pathname === "/favicon.ico") {
      const icon = resolve(hostDist, "favicon.svg");
      return existsSync(icon) ? sendFile(req, res, icon) : sendJson(res, 404, { ok: false, error: "Favicon not found" });
    }
    if (url.pathname === "/3d") {
      res.writeHead(308, { location: `/3d/${url.search}` });
      return res.end();
    }
    if (url.pathname.startsWith("/3d/")) {
      const filePath = resolveStatic(threeDist, url.pathname.slice(4), true);
      return filePath ? sendFile(req, res, filePath) : sendJson(res, 404, { ok: false, error: "3D asset not found" });
    }
    for (const legacyPrefix of ["/models/"]) {
      if (url.pathname.startsWith(legacyPrefix)) {
        const filePath = resolveStatic(threeDist, url.pathname.slice(1), false);
        return filePath ? sendFile(req, res, filePath) : sendJson(res, 404, { ok: false, error: "Legacy 3D asset not found" });
      }
    }
    const filePath = resolveStatic(hostDist, url.pathname, true);
    return filePath ? sendFile(req, res, filePath) : sendJson(res, 404, { ok: false, error: "Host asset not found" });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, "0.0.0.0", () => console.log(`NET30 production server listening on 0.0.0.0:${port}`));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
