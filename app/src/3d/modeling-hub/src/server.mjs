import "dotenv/config";
import { createReadStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import cors from "cors";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { createBlenderMcpServer, modelingPayloadSchema } from "./blender-mcp.mjs";
import { runModelingJob } from "./modeling-agent.mjs";
import { createAssetStorage, IMAGE_TYPES, MAX_IMAGE_BYTES } from "./storage.mjs";
import { defaultOpenAiModel, openAiModels } from "./modeling-spec.mjs";

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
const publishedGlb = path.join(assetRoot, "published", "showcase-vial.glb");
const fallbackGlb = env("NET30_SHOWCASE_GLB", path.join(repoRoot, "app", "src", "3d", "vitamin-bottle-service", "public", "models", "showcase-vial.glb"));
const storage = createAssetStorage(assetRoot);
await fs.mkdir(jobsRoot, { recursive: true });
await storage.initialise();
await storage.cleanupExpired();
setInterval(() => { void storage.cleanupExpired(); }, 60 * 60 * 1000).unref();

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
    openAiModels: openAiModels(),
    storage: process.env.AWS_S3_BUCKET_NAME ? "railway-bucket" : "local-volume",
    authRequired: Boolean(token),
  });
});

app.get("/assets/showcase-vial.glb", (req, res) => {
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
    shapes: ["cylindrical", "short-wide", "tall-slim", "ribbed", "custom"],
    models: openAiModels(),
    defaultModel: defaultOpenAiModel(),
    upload: { maxFiles: 4, maxBytes: MAX_IMAGE_BYTES, types: [...IMAGE_TYPES] },
  });
});

app.post("/api/modeling/uploads", async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "인증되지 않은 modeling-hub 요청입니다." });
  try {
    const { filename, contentType, size } = req.body ?? {};
    if (typeof filename !== "string" || typeof contentType !== "string") throw new Error("업로드 파일 정보가 올바르지 않습니다.");
    const upload = await storage.createUpload({ filename, contentType, size: Number(size) });
    return res.status(201).json({ ok: true, upload });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.put("/api/modeling/uploads/:id", express.raw({ type: () => true, limit: "10mb" }), async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "인증되지 않은 modeling-hub 요청입니다." });
  try {
    if (!IMAGE_TYPES.has(req.headers["content-type"] ?? "")) throw new Error("지원하지 않는 이미지 형식입니다.");
    const upload = await storage.putLocal(req.params.id, req.body, req.headers["content-type"]);
    return res.json({ ok: true, upload: { id: upload.id } });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/modeling/uploads/:id/complete", async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "인증되지 않은 modeling-hub 요청입니다." });
  try {
    const upload = await storage.markUploaded(req.params.id);
    return res.json({ ok: true, upload: { id: upload.id } });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

let activeJob = Promise.resolve();
app.post("/api/modeling/jobs", async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "인증되지 않은 modeling-hub 요청입니다." });
  const jobId = `job-${Date.now()}`;
  try {
    const payload = modelingPayloadSchema.parse(req.body ?? {});
    const imageInputs = await storage.imageInputs(payload.imageIds);
    const job = activeJob.then(() => runModelingJob(payload, { jobId, imageInputs }));
    activeJob = job.catch(() => undefined);
    const result = await job;
    const storageKey = await storage.publishResult(result.exportPaths.publishedGlb, jobId);
    return res.json({ ok: true, ...result, artifact: { assetPath: result.assetPath, storageKey } });
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
