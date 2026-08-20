import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { modelingSpecSchema } from "./modeling-spec.mjs";

const componentSchema = z.enum(["bottle", "cap", "labelFront", "labelBack", "vitamin", "physicsCollider"]);
const settingsSchema = z.object({
  sizeXmm: z.coerce.number().positive().max(500).optional(),
  sizeYmm: z.coerce.number().positive().max(500).optional(),
  sizeZmm: z.coerce.number().positive().max(800).optional(),
  shellThicknessMm: z.coerce.number().positive().max(30).optional(),
  widthMm: z.coerce.number().positive().max(500).optional(),
  depthMm: z.coerce.number().positive().max(500).optional(),
  heightMm: z.coerce.number().positive().max(800).optional(),
  thicknessMm: z.coerce.number().positive().max(30).optional(),
  material: z.string().max(80).optional(),
  shape: z.string().max(80).optional(),
  tone: z.string().max(80).optional(),
  color: z.string().max(80).optional(),
  finish: z.string().max(80).optional(),
  distortion: z.coerce.number().min(0).max(1).optional(),
}).passthrough();

export const modelingPayloadSchema = z.object({
  component: componentSchema,
  prompt: z.string().trim().min(1).max(4000),
  settings: settingsSchema,
  model: z.string().trim().max(160).optional(),
  imageIds: z.array(z.string().uuid()).max(4).default([]),
});

function env(name, fallback = "") {
  const value = process.env[name];
  return value && value.trim().length ? value.trim() : fallback;
}

function pathsFor(assetRoot) {
  const root = path.resolve(assetRoot);
  return {
    assetRoot: root,
    jobsRoot: path.join(root, "jobs"),
    blendFile: env("NET30_BLEND_FILE", path.join(root, "blender", "vitamin-bottle.blend")),
    renderGlb: env("NET30_RENDER_GLB", path.join(root, "exports", "render", "vitamin-bottle-render.glb")),
    physicsGlb: env("NET30_PHYSICS_GLB", path.join(root, "exports", "physics", "vitamin-bottle-collider.glb")),
    vitaminGlb: env("NET30_VITAMIN_GLB", path.join(root, "exports", "render", "vitamin-shapes.glb")),
    publishedGlb: path.join(root, "published", "showcase-vial.glb"),
  };
}

async function run(command, args, { timeoutMs = 12 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const capture = (chunk) => { output = `${output}${chunk}`.slice(-12000); };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0 && !/Traceback \(most recent call last\)|Error: Python|RuntimeError:/i.test(output)) return resolve(output);
      reject(new Error(`Blender 작업이 실패했습니다 (code=${code ?? "unknown"}, signal=${signal ?? "none"}). ${output}`));
    });
  });
}

export async function executeBlenderModeling(rawPayload, { assetRoot, jobId = `job-${Date.now()}`, spec } = {}) {
  const payload = modelingPayloadSchema.parse(rawPayload);
  const modelingSpec = modelingSpecSchema.parse(spec);
  const paths = pathsFor(assetRoot ?? env("NET30_3D_ASSET_ROOT", path.resolve(process.cwd(), "../../../../net30-3d-assets")));
  const jobDir = path.join(paths.jobsRoot, jobId);
  const requestPath = path.join(jobDir, "request.json");
  const resultPath = path.join(jobDir, "result.json");
  const workerPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "blender-worker.py");
  // Blender 5.2 currently crashes during Metal probing on this Apple Silicon
  // workstation. Keep an explicit BLENDER_BIN override, then prefer the
  // separately-installed, verified 4.5 LTS bundle for local headless jobs.
  // Linux/Railway continues to use its Docker-provided `blender` binary.
  const macBlenderCandidates = [
    "/Applications/Blender 4.5 LTS.app/Contents/MacOS/Blender",
    "/Applications/Blender.app/Contents/MacOS/Blender",
  ];
  const macBlender = macBlenderCandidates.find((candidate) => existsSync(candidate));
  const blenderBin = env("BLENDER_BIN", macBlender ?? "blender");

  await Promise.all([
    fs.mkdir(jobDir, { recursive: true }),
    fs.mkdir(path.dirname(paths.blendFile), { recursive: true }),
    fs.mkdir(path.dirname(paths.renderGlb), { recursive: true }),
    fs.mkdir(path.dirname(paths.physicsGlb), { recursive: true }),
    fs.mkdir(path.dirname(paths.vitaminGlb), { recursive: true }),
    fs.mkdir(path.dirname(paths.publishedGlb), { recursive: true }),
  ]);

  const request = { payload, spec: modelingSpec, paths, jobId };
  await fs.writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`, "utf8");
  const log = await run(blenderBin, ["--background", "--factory-startup", "--python", workerPath, "--", requestPath]);
  const outputStat = await fs.stat(paths.publishedGlb);
  const glbHeader = await fs.readFile(paths.publishedGlb, { encoding: null, flag: "r" });
  if (outputStat.size < 20 || glbHeader.subarray(0, 4).toString("ascii") !== "glTF") {
    throw new Error("Blender가 유효한 GLB 파일을 생성하지 못했습니다.");
  }

  const result = {
    summary: `Blender가 ${payload.component} ModelingSpec을 반영하고 런타임 GLB를 갱신했습니다.`,
    jobId,
    assetPath: "/assets/showcase-vial.glb",
    exportPaths: {
      renderGlb: paths.renderGlb,
      physicsGlb: paths.physicsGlb,
      vitaminGlb: paths.vitaminGlb,
      publishedGlb: paths.publishedGlb,
    },
    log: log.trim().slice(-4000),
  };
  await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

export function createBlenderMcpServer({ assetRoot }) {
  const server = new McpServer({ name: "net30-blender-mcp", version: "1.0.0" });
  server.registerTool("model_vitamin_bottle", {
    title: "Model and export vitamin bottle",
    description: "Runs headless Blender to apply a prompt and configuration, then exports the current runtime GLB.",
    inputSchema: modelingPayloadSchema,
  }, async (payload) => {
    const fallbackSpec = {
      version: "net30.modeling-spec.v1", summary: "MCP 기본 명세", silhouette: "cylindrical",
      dimensionsMm: { width: payload.settings.sizeXmm ?? 54, height: payload.settings.sizeZmm ?? 116, depth: payload.settings.sizeYmm ?? 54, wall: payload.settings.shellThicknessMm ?? 2.4 },
      materials: { body: "glass", cap: "opaque-plastic", bodyColor: "#d7e8f6", capColor: payload.settings.tone ?? "#2d5fc4", labelColor: "#f6f1df", finish: payload.settings.finish ?? "satin" },
      parts: { neckRatio: 0.66, capRatio: 0.16, labelRatio: 0.38, ribbedCap: payload.settings.shape === "ribbed", shoulder: "rounded", labelText: "NET30" }, camera: { yawDegrees: 0, elevationDegrees: 8 },
    };
    const result = await executeBlenderModeling(payload, { assetRoot, spec: fallbackSpec });
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
  });
  return server;
}
