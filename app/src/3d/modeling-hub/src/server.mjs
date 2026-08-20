import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import cors from "cors";
import { runModelingJob } from "./modeling-agent.mjs";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

function requireEnv(name, fallback = "") {
  const value = process.env[name] && process.env[name].trim().length ? process.env[name] : fallback;
  if (!value) throw new Error(`필수 환경변수가 없습니다: ${name}`);
  return value;
}

const repoRoot = requireEnv("NET30_REPO", path.resolve(process.cwd(), "../../../.."));
const assetRoot = requireEnv("NET30_3D_ASSET_ROOT", path.resolve(repoRoot, "../net30-3d-assets"));
const jobsRoot = path.join(assetRoot, "jobs");

await fs.mkdir(jobsRoot, { recursive: true });

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    repoRoot,
    assetRoot,
    hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
  });
});

app.get("/api/modeling/schema", (_req, res) => {
  res.json({
    ok: true,
    components: ["bottle", "cap", "labelFront", "labelBack", "vitamin", "physicsCollider"],
    materials: ["glass", "opaque-plastic", "paper", "capsule", "tablet", "softgel", "custom"],
    shapes: ["reference-match", "cylindrical", "short-wide", "tall-slim", "ribbed", "custom"],
  });
});

app.post("/api/modeling/jobs", async (req, res) => {
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

    res.json({ ok: true, jobId, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

const port = Number(process.env.PORT ?? process.env.NET30_MODELING_HUB_PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
app.listen(port, host, () => {
  console.log(`NET30 modeling hub listening on http://${host}:${port}`);
});
