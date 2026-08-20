import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import cors from "cors";
import { runModelingJob } from "./modeling-agent.mjs";

const app = express();
const token = (process.env.NET30_MODELING_HUB_TOKEN ?? "").trim();
const allowedOrigins = (process.env.NET30_MODELING_ALLOWED_ORIGINS ?? "http://127.0.0.1:5173")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`허용되지 않은 origin: ${origin}`));
  },
}));
app.use(express.json({ limit: "1mb" }));

function env(name, fallback = "") {
  return process.env[name] && process.env[name].trim().length ? process.env[name] : fallback;
}

function authorized(req) {
  if (!token) return true;
  const remoteAddress = req.socket.remoteAddress ?? "";
  const origin = req.headers.origin ?? "";
  const trustedLocal = (remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1")
    && (origin === "http://127.0.0.1:5173" || origin === "http://localhost:5173");
  return trustedLocal || req.headers.authorization === `Bearer ${token}`;
}

const repoRoot = env("NET30_REPO", path.resolve(process.cwd(), "../../../.."));
const assetRoot = env("NET30_3D_ASSET_ROOT", path.resolve(repoRoot, "../net30-3d-assets"));
const jobsRoot = path.join(assetRoot, "jobs");
await fs.mkdir(jobsRoot, { recursive: true });

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    mode: env("NET30_BLENDER_MCP_URL") ? "remote-mcp" : "local-stdio",
    repoRoot,
    assetRoot,
    hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
    authRequired: Boolean(token),
  });
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

app.post("/api/modeling/jobs", async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "인증되지 않은 modeling-hub 요청입니다." });
  try {
    const payload = req.body ?? {};
    if (!payload.component) throw new Error("component가 필요합니다.");
    if (!payload.prompt) throw new Error("prompt가 필요합니다.");
    if (!payload.settings) throw new Error("settings가 필요합니다.");

    const jobId = `job-${Date.now()}`;
    const jobDir = path.join(jobsRoot, jobId);
    await fs.mkdir(jobDir, { recursive: true });
    await fs.writeFile(path.join(jobDir, "request.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");

    const result = await runModelingJob(payload);
    await fs.writeFile(path.join(jobDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    return res.json({ ok: true, jobId, ...result });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

const port = Number(process.env.PORT ?? process.env.NET30_MODELING_HUB_PORT ?? 8788);
const host = process.env.HOST ?? "127.0.0.1";
app.listen(port, host, () => {
  console.log(`NET30 modeling hub listening on http://${host}:${port}`);
});
