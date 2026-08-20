import "dotenv/config";
import { createReadStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import cors from "cors";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { createBlenderMcpServer, modelingPayloadSchema } from "./blender-mcp.mjs";
import { runModelingJob } from "./modeling-agent.mjs";

const app = express();
const token = (process.env.NET30_MODELING_HUB_TOKEN ?? "").trim();
const allowedOrigins = (process.env.NET30_MODELING_ALLOWED_ORIGINS ?? "http://127.0.0.1:5173")
  .split(",").map((value) => value.trim()).filter(Boolean);

function env(name, fallback = "") {
  const value = process.env[name];
  return value && value.trim().length ? value.trim() : fallback;
}

function authorized(req) {
  if (!token) return true;
  const remoteAddress = req.socket.remoteAddress ?? "";
  const origin = req.headers.origin ?? "";
  const trustedLocal = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remoteAddress)
    && ["http://127.0.0.1:5173", "http://localhost:5173"].includes(origin);
  return trustedLocal || req.headers.authorization === `Bearer ${token}`;
}

const repoRoot = env("NET30_REPO", path.resolve(process.cwd(), "../../../.."));
const assetRoot = env("NET30_3D_ASSET_ROOT", path.resolve(repoRoot, "../net30-3d-assets"));
const jobsRoot = path.join(assetRoot, "jobs");
const publishedGlb = path.join(assetRoot, "published", "reference-vial.glb");
const fallbackGlb = env("NET30_REFERENCE_GLB", path.join(repoRoot, "app", "src", "3d", "vitamin-bottle-service", "public", "models", "reference-vial.glb"));
await fs.mkdir(jobsRoot, { recursive: true });

async function ensurePublishedGlb() {
  if (existsSync(publishedGlb)) return;
  if (!existsSync(fallbackGlb)) {
    throw new Error(`초기 GLB를 찾을 수 없습니다: ${fallbackGlb}`);
  }
  await fs.mkdir(path.dirname(publishedGlb), { recursive: true });
  await fs.copyFile(fallbackGlb, publishedGlb);
}

await ensurePublishedGlb();

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`허용되지 않은 origin: ${origin}`));
  },
}));
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    mode: "headless-blender-streamable-http-mcp",
    transport: "POST /mcp",
    repoRoot,
    assetRoot,
    fallbackGlb,
    hasPublishedModel: existsSync(publishedGlb),
    authRequired: Boolean(token),
  });
});

app.get("/assets/reference-vial.glb", (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "인증되지 않은 asset 요청입니다." });
  if (!existsSync(publishedGlb)) return res.status(404).json({ ok: false, error: "아직 생성된 GLB가 없습니다." });
  res.set({ "content-type": "model/gltf-binary", "cache-control": "no-store", "cross-origin-resource-policy": "cross-origin" });
  return createReadStream(publishedGlb).pipe(res);
});

app.get("/api/modeling/schema", (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "인증되지 않은 modeling-hub 요청입니다." });
  return res.json({
    ok: true,
    components: ["bottle", "cap", "labelFront", "labelBack", "vitamin", "physicsCollider"],
    materials: ["glass", "opaque-plastic", "paper", "capsule", "tablet", "softgel", "custom"],
    shapes: ["reference-match", "cylindrical", "short-wide", "tall-slim", "ribbed", "custom"],
  });
});

let activeJob = Promise.resolve();
app.post("/api/modeling/jobs", async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "인증되지 않은 modeling-hub 요청입니다." });
  const jobId = `job-${Date.now()}`;
  try {
    const payload = modelingPayloadSchema.parse(req.body ?? {});
    const job = activeJob.then(() => runModelingJob(payload, { jobId }));
    activeJob = job.catch(() => undefined);
    const result = await job;
    return res.json({ ok: true, ...result });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/mcp", async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "MCP bearer token이 필요합니다." });
  try {
    // Railway's recommended Streamable HTTP pattern: a stateless transport per request.
    const server = createBlenderMcpServer({ assetRoot });
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    if (!res.headersSent) res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

const port = Number(process.env.PORT ?? process.env.NET30_MODELING_HUB_PORT ?? 8788);
const host = process.env.HOST ?? "127.0.0.1";
app.listen(port, host, () => console.log(`NET30 Blender MCP listening on http://${host}:${port}/mcp`));
