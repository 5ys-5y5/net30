import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { COMPONENTS, fallbackComponent, fallbackContract, modelingSpecSchema } from "./modeling-spec.mjs";

const componentSchema = z.enum(COMPONENTS);
const settingsSchema = z.object({ sizeXmm: z.coerce.number().positive().max(500).optional(), sizeYmm: z.coerce.number().positive().max(800).optional(), sizeZmm: z.coerce.number().positive().max(500).optional(), shellThicknessMm: z.coerce.number().positive().max(30).optional(), widthMm: z.coerce.number().positive().max(500).optional(), heightMm: z.coerce.number().positive().max(800).optional(), depthMm: z.coerce.number().positive().max(500).optional(), wallMm: z.coerce.number().positive().max(30).optional() }).passthrough();
export const modelingPayloadSchema = z.object({ version: z.literal("net30.modeling-job.v2").optional(), component: componentSchema.optional(), components: z.array(componentSchema).min(1).max(COMPONENTS.length).optional(), componentPrompts: z.record(z.string(), z.string().trim().max(2000)).default({}), parentVersionId: z.record(z.string(), z.string().min(1).max(160)).default({}), prompt: z.string().trim().min(1).max(4000), settings: settingsSchema.default({}), dimensionOverrides: settingsSchema.default({}), model: z.string().trim().max(160).optional(), imageIds: z.array(z.string().uuid()).max(4).default([]), specFileIds: z.array(z.string().uuid()).max(8).default([]), approvedDraft: z.unknown().optional(), quality: z.enum(["standard", "high"]).default("high") }).transform((value) => ({ ...value, version: "net30.modeling-job.v2", components: [...new Set(value.components ?? (value.component ? [value.component] : ["bottle"]))] }));

function env(name, fallback = "") { const value = process.env[name]; return value && value.trim().length ? value.trim() : fallback; }
function run(command, args, timeoutMs = 12 * 60 * 1000) { return new Promise((resolve, reject) => { const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] }); let output = ""; const capture = (chunk) => { output = `${output}${chunk}`.slice(-16000); }; child.stdout.on("data", capture); child.stderr.on("data", capture); const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs); child.once("error", (error) => { clearTimeout(timer); reject(error); }); child.once("close", (code, signal) => { clearTimeout(timer); if (code === 0 && !/Traceback|RuntimeError:/i.test(output)) resolve(output); else reject(new Error(`Blender 작업이 실패했습니다 (code=${code ?? "unknown"}, signal=${signal ?? "none"}). ${output}`)); }); }); }
function blenderBin() { const candidates = [env("BLENDER_BIN"), "/Applications/Blender 4.5 LTS.app/Contents/MacOS/Blender", "/Applications/Blender.app/Contents/MacOS/Blender", "blender"].filter(Boolean); return candidates.find((candidate) => candidate === "blender" || existsSync(candidate)); }

export async function composeSelectedComponentGlbs(componentFiles, { assetRoot } = {}) {
  if (!Array.isArray(componentFiles) || componentFiles.length === 0) throw new Error("조립할 컴포넌트 버전을 선택하세요.");
  const items = [...componentFiles]
    .map(({ component, versionId, sourcePath }) => ({ component: String(component), versionId: String(versionId), sourcePath: path.resolve(String(sourcePath)) }))
    .sort((left, right) => left.component.localeCompare(right.component));
  if (new Set(items.map((item) => item.component)).size !== items.length) throw new Error("컴포넌트별로 하나의 버전만 조립할 수 있습니다.");
  for (const item of items) if (!existsSync(item.sourcePath)) throw new Error(`${item.component} 버전 GLB를 찾을 수 없습니다.`);

  const root = path.resolve(assetRoot ?? env("NET30_3D_ASSET_ROOT", path.resolve(process.cwd(), "../../../../net30-3d-assets")));
  const signature = createHash("sha256").update(items.map((item) => `${item.component}:${item.versionId}`).join("\n")).digest("hex").slice(0, 24);
  const assemblyId = `assembly-${signature}`;
  const outputPath = path.join(root, "component-library", "assemblies", `${assemblyId}.glb`);
  if (!existsSync(outputPath)) {
    const requestPath = path.join(root, "component-library", "assemblies", `${assemblyId}.request.json`);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(requestPath, `${JSON.stringify({ mode: "assemble-library", components: items, paths: { assemblyGlb: outputPath } }, null, 2)}\n`);
    const workerPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "blender-worker.py");
    await run(blenderBin(), ["--background", "--factory-startup", "--python", workerPath, "--", requestPath], 4 * 60 * 1000);
  }
  const header = await fs.readFile(outputPath);
  if (header.length < 20 || header.subarray(0, 4).toString("ascii") !== "glTF") throw new Error("선택한 컴포넌트의 조립 GLB를 만들지 못했습니다.");
  return { id: assemblyId, sourcePath: outputPath, components: items.map(({ component, versionId }) => ({ component, versionId })) };
}
async function cadExports(spec, requestPath, cadDir) {
  const worker = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "cad-worker.py"); const python = env("NET30_CADQUERY_BIN", "python3"); const manufacturable = spec.contract.unresolved.length === 0;
  if (!manufacturable) return { available: false, reason: "critical interface evidence is unresolved" };
  const cadComponents = spec.components.filter((item) => ["bottle", "cap", "pouringRing", "liner"].includes(item.component));
  const failures = [];
  for (let index = 0; index < cadComponents.length; index += 2) {
    await Promise.all(cadComponents.slice(index, index + 2).map(async (component) => {
      const file = path.join(cadDir, `${component.component}.request.json`); const output = path.join(cadDir, `${component.component}.step`);
      await fs.writeFile(file, JSON.stringify({ component, contract: spec.contract, output }));
      try { await run(python, [worker, file], 4 * 60 * 1000); } catch (error) { failures.push(`${component.component}: ${error.message}`); }
    }));
  }
  return failures.length ? { available: false, reason: failures.join("\n") } : { available: true };
}

export async function executeBlenderModeling(rawPayload, { assetRoot, jobId = `job-${Date.now()}`, spec, onProgress = () => undefined } = {}) {
  const payload = modelingPayloadSchema.parse(rawPayload); const modelingSpec = modelingSpecSchema.parse(spec);
  const root = path.resolve(assetRoot ?? env("NET30_3D_ASSET_ROOT", path.resolve(process.cwd(), "../../../../net30-3d-assets"))); const jobDir = path.join(root, "jobs", jobId);
  const renderDir = path.join(jobDir, "render"); const componentDir = path.join(jobDir, "components"); const cadDir = path.join(jobDir, "cad"); const requestPath = path.join(jobDir, "request.json"); const resultPath = path.join(jobDir, "result.json"); const assemblyGlb = path.join(renderDir, "assembly.glb");
  await Promise.all([fs.mkdir(renderDir, { recursive: true }), fs.mkdir(componentDir, { recursive: true }), fs.mkdir(cadDir, { recursive: true })]);
  await fs.writeFile(requestPath, `${JSON.stringify({ payload, spec: modelingSpec, paths: { jobDir, assemblyGlb, componentDir, cadDir }, jobId }, null, 2)}\n`);
  onProgress("validating", "CadQuery/OpenCascade가 선택한 제조 컴포넌트를 검사하고 있습니다."); const cad = await cadExports(modelingSpec, requestPath, cadDir);
  onProgress("assembling", "Blender가 조립 GLB와 컴포넌트 자산을 내보내고 있습니다.");
  const workerPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "blender-worker.py"); const log = await run(blenderBin(), ["--background", "--factory-startup", "--python", workerPath, "--", requestPath]);
  const header = await fs.readFile(assemblyGlb); if (header.length < 20 || header.subarray(0, 4).toString("ascii") !== "glTF") throw new Error("Blender가 유효한 assembly GLB를 생성하지 못했습니다.");
  const components = Object.fromEntries(await Promise.all(payload.components.map(async (component) => { const file = path.join(componentDir, `${component}.glb`); return [component, existsSync(file) ? `/api/modeling/jobs/${jobId}/artifacts/components/${component}.glb` : null]; })));
  const result = { summary: `${payload.components.join(", ")} 컴포넌트를 공통 조립 계약으로 생성했습니다.`, jobId, assetPath: `/api/modeling/jobs/${jobId}/artifacts/render/assembly.glb`, artifact: { assemblyGlb: `/api/modeling/jobs/${jobId}/artifacts/render/assembly.glb`, components, report: `/api/modeling/jobs/${jobId}/artifacts/reports/verification.json` }, exportPaths: { assemblyGlb, componentDir, cadDir }, cad, log: log.trim().slice(-4000) };
  await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`); return result;
}

export function createBlenderMcpServer({ assetRoot }) {
  const server = new McpServer({ name: "net30-manufacturing-modeling-mcp", version: "2.0.0" });
  server.registerTool("model_container_assembly", { title: "Model selected container components", description: "Compiles a validated declarative assembly spec into component and assembly GLB assets.", inputSchema: modelingPayloadSchema }, async (payload) => {
    if (!payload.approvedDraft || typeof payload.approvedDraft !== "object" || !("approvalHash" in payload.approvedDraft)) throw new Error("approval_required: MCP도 승인된 초안의 approvalHash 없이는 Blender를 실행할 수 없습니다.");
    const contract = fallbackContract(payload); const spec = { version: "net30.modeling-spec.v2", summary: contract.product.name, contract, components: payload.components.map((component) => ({ ...fallbackComponent(contract, component), contractHash: "0".repeat(64) })) };
    const result = await executeBlenderModeling(payload, { assetRoot, spec }); return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
  });
  return server;
}
