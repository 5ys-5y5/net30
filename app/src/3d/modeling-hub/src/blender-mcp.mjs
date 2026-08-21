import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { COMPONENTS, fallbackComponent, fallbackContract, modelingSpecSchema } from "./modeling-spec.mjs";
import { ModelingDossier } from "./modeling-dossier.mjs";
import { qualityGates } from "./modeling-graph-v3.mjs";
import { compareAxisymmetricContour } from "./image-evidence.mjs";

const componentSchema = z.string().trim().min(1).max(100);
const settingsSchema = z.object({ sizeXmm: z.coerce.number().positive().max(500).optional(), sizeYmm: z.coerce.number().positive().max(800).optional(), sizeZmm: z.coerce.number().positive().max(500).optional(), shellThicknessMm: z.coerce.number().positive().max(30).optional(), widthMm: z.coerce.number().positive().max(500).optional(), heightMm: z.coerce.number().positive().max(800).optional(), depthMm: z.coerce.number().positive().max(500).optional(), wallMm: z.coerce.number().positive().max(30).optional() }).passthrough();
export const modelingPayloadSchema = z.object({ version: z.union([z.literal("net30.modeling-job.v2"),z.literal("net30.modeling-job.v3")]).optional(), component: componentSchema.optional(), components: z.array(componentSchema).min(1).max(30).optional(), componentPrompts: z.record(z.string(), z.string().trim().max(2000)).default({}), parentVersionId: z.record(z.string(), z.string().min(1).max(160)).default({}), prompt: z.string().trim().min(1).max(4000), settings: settingsSchema.default({}), dimensionOverrides: settingsSchema.default({}), model: z.string().trim().max(160).optional(), imageIds: z.array(z.string().uuid()).max(4).default([]), specFileIds: z.array(z.string().uuid()).max(8).default([]), compiledSpec: z.unknown().optional(), graphHash: z.string().nullable().optional(), approvedDraft: z.unknown().optional(), quality: z.enum(["speed", "balanced", "quality", "standard", "high"]).default("balanced") }).transform((value) => ({ ...value, quality: value.quality === "standard" ? "speed" : value.quality === "high" ? "quality" : value.quality, version: value.version??"net30.modeling-job.v3", components: [...new Set(value.components ?? (value.component ? [value.component] : []))] }));

function env(name, fallback = "") { const value = process.env[name]; return value && value.trim().length ? value.trim() : fallback; }
function run(command, args, timeoutMs = 12 * 60 * 1000) { return new Promise((resolve, reject) => { const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] }); let output = ""; const capture = (chunk) => { output = `${output}${chunk}`.slice(-16000); }; child.stdout.on("data", capture); child.stderr.on("data", capture); const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs); child.once("error", (error) => { clearTimeout(timer); reject(error); }); child.once("close", (code, signal) => { clearTimeout(timer); if (code === 0 && !/Traceback|RuntimeError:/i.test(output)) resolve(output); else reject(new Error(`Blender 작업이 실패했습니다 (code=${code ?? "unknown"}, signal=${signal ?? "none"}). ${output}`)); }); }); }
function blenderBin() { const candidates = [env("BLENDER_BIN"), "/Applications/Blender 4.5 LTS.app/Contents/MacOS/Blender", "/Applications/Blender.app/Contents/MacOS/Blender", "blender"].filter(Boolean); return candidates.find((candidate) => candidate === "blender" || existsSync(candidate)); }
function cadqueryBin() { const bundled = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../.cadquery-venv/bin/python"); return env("NET30_CADQUERY_BIN", existsSync(bundled) ? bundled : "python3"); }
export async function cadRuntimeHealth() { try { const output = await run(cadqueryBin(), ["-c", "import cadquery; print(cadquery.__version__)"], 15000); return { ok: true, version: output.trim().split(/\s+/).at(-1), python: path.basename(cadqueryBin()) }; } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; } }

export async function composeSelectedComponentGlbs(componentFiles, { assetRoot } = {}) {
  if (!Array.isArray(componentFiles) || componentFiles.length === 0) throw new Error("조립할 컴포넌트 버전을 선택하세요.");
  const items = [...componentFiles]
    .map(({ component, versionId, sourcePath, transform = null }) => ({ component: String(component), versionId: String(versionId), sourcePath: path.resolve(String(sourcePath)), transform }))
    .sort((left, right) => left.component.localeCompare(right.component));
  if (new Set(items.map((item) => item.component)).size !== items.length) throw new Error("컴포넌트별로 하나의 버전만 조립할 수 있습니다.");
  for (const item of items) if (!existsSync(item.sourcePath)) throw new Error(`${item.component} 버전 GLB를 찾을 수 없습니다.`);

  const root = path.resolve(assetRoot ?? env("NET30_3D_ASSET_ROOT", path.resolve(process.cwd(), "../../../../net30-3d-assets")));
  const signature = createHash("sha256").update(items.map((item) => `${item.component}:${item.versionId}:${JSON.stringify(item.transform)}`).join("\n")).digest("hex").slice(0, 24);
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
  return { id: assemblyId, sourcePath: outputPath, components: items.map(({ component, versionId, transform }) => ({ component, versionId, transform })) };
}
async function cadExports(spec, cadDir, quality) {
  const worker = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "cad-worker.py"); const python = cadqueryBin();
  const profile = quality === "speed" ? { chordMm: .2, angularDeg: 15 } : quality === "quality" ? { chordMm: .02, angularDeg: 5 } : { chordMm: .05, angularDeg: 7 };
  const cadComponents = spec.components.filter((item) => spec.modelingGraph?.components.find((component) => component.id === item.componentInstanceId)?.representation === "brep_solid");
  if (!cadComponents.length) throw new Error("cad_required: 승인된 graph에 B-Rep 구성요소가 없습니다.");
  const failures = []; const sources = {};
  for (let index = 0; index < cadComponents.length; index += 2) {
    await Promise.all(cadComponents.slice(index, index + 2).map(async (component) => {
      const file = path.join(cadDir, `${component.componentInstanceId}.request.json`); const stem = path.join(cadDir, component.componentInstanceId);
      const graphComponent=spec.modelingGraph?.components.find((item)=>item.id===component.componentInstanceId)??null; const graphNodes=spec.modelingGraph?.nodes.filter((item)=>item.componentId===component.componentInstanceId)??[];
      const paths = { step: `${stem}.step`, brep: `${stem}.brep`, stl: `${stem}.stl`, report: `${stem}.validation.json` };
      await fs.writeFile(file, JSON.stringify({ component, graphComponent, graphNodes, contract: spec.contract, paths, tessellation: profile }));
      try { await run(python, [worker, file], 4 * 60 * 1000); sources[component.componentInstanceId] = paths; } catch (error) { failures.push(`${component.displayName}: ${error.message}`); }
    }));
  }
  if (failures.length) throw new Error(`cad_compile_failed:\n${failures.join("\n")}`);
  const validation = Object.fromEntries(await Promise.all(Object.entries(sources).map(async ([id, paths]) => [id, JSON.parse(await fs.readFile(paths.report, "utf8"))])));
  const assemblyDir = path.join(path.dirname(cadDir), "assembly"); await fs.mkdir(assemblyDir, { recursive: true });
  const assemblyPaths = { xbf: path.join(assemblyDir, "assembly.xbf"), step: path.join(assemblyDir, "assembly.step"), report: path.join(assemblyDir, "assembly.validation.json") };
  const assemblyRequest = path.join(assemblyDir, "assembly.request.json");
  await fs.writeFile(assemblyRequest, JSON.stringify({ name: spec.contract.product.name, components: Object.entries(sources).map(([id, item]) => ({ id, brep: item.brep, transform: spec.modelingGraph?.components.find((component) => component.id === id)?.transform ?? null })), paths: assemblyPaths, toleranceMm: .01 }));
  await run(python, [path.resolve(path.dirname(fileURLToPath(import.meta.url)), "cad-assembly-worker.py"), assemblyRequest], 4 * 60 * 1000);
  const assemblyValidation = JSON.parse(await fs.readFile(assemblyPaths.report, "utf8"));
  const geometryBlockers = Object.entries(validation).flatMap(([id, report]) => [report.valid ? null : `${id}: B-Rep validity failure`, report.closed ? null : `${id}: open shell/free edge review required`, report.solidCount === 1 ? null : `${id}: expected one connected manufacturing solid, found ${report.solidCount}`].filter(Boolean));
  const blockers = [...spec.contract.unresolved, ...geometryBlockers];
  return { available: true, sources, validation, assembly: { ...assemblyPaths, validation: assemblyValidation }, tessellation: profile, manufacturingStatus: blockers.length ? "manufacturing_review_required" : "dimensional_candidate", blockers };
}

export async function executeBlenderModeling(rawPayload, { assetRoot, jobId = `job-${Date.now()}`, spec, imageInputs = [], onProgress = () => undefined } = {}) {
  const payload = modelingPayloadSchema.parse(rawPayload); const modelingSpec = modelingSpecSchema.parse(spec);
  const root = path.resolve(assetRoot ?? env("NET30_3D_ASSET_ROOT", path.resolve(process.cwd(), "../../../../net30-3d-assets"))); const jobDir = path.join(root, "jobs", jobId);
  const renderDir = path.join(jobDir, "render"); const componentDir = path.join(jobDir, "components"); const cadDir = path.join(jobDir, "cad"); const requestPath = path.join(jobDir, "request.json"); const resultPath = path.join(jobDir, "result.json"); const assemblyGlb = path.join(renderDir, "assembly.glb");
  await Promise.all([fs.mkdir(renderDir, { recursive: true }), fs.mkdir(componentDir, { recursive: true }), fs.mkdir(cadDir, { recursive: true })]);
  const dossier = new ModelingDossier(jobDir, jobId); dossier.record("job.started", { jobId, quality: payload.quality, graphHash: payload.graphHash, components: payload.components, imageIds: payload.imageIds });
  dossier.record("graph.approved", { graphHash: payload.graphHash, graph: modelingSpec.modelingGraph });
  dossier.record("decisions.approved", { draftId: payload.approvedDraft?.id, revision: payload.approvedDraft?.revision, approvalHash: payload.approvedDraft?.approvalHash, questions: payload.approvedDraft?.questions ?? [], iterations: payload.approvedDraft?.iterations ?? [] });
  for (const response of payload.approvedDraft?.inference ?? []) dossier.record("inference.completed", response);
  await dossier.writeSnapshot("graph/modeling-graph.json", modelingSpec.modelingGraph);
  if (payload.approvedDraft?.modelingGraphV3) await dossier.writeSnapshot("graph/modeling-graph-v3.json", payload.approvedDraft.modelingGraphV3);
  if (payload.approvedDraft?.evidenceManifest) await dossier.writeSnapshot("evidence/manifest.json", payload.approvedDraft.evidenceManifest);
  if (payload.approvedDraft?.imageEvidence) await dossier.writeSnapshot("evidence/image-measurements.json", payload.approvedDraft.imageEvidence);
  if (payload.approvedDraft?.fit) await dossier.writeSnapshot("validation/curve-fit.json", payload.approvedDraft.fit);
  await dossier.writeSnapshot("reports/assembly-contract.json", modelingSpec.contract);
  await dossier.writeSnapshot("inference/analysis.request.json", { model: payload.model, prompt: payload.prompt, imageIds: payload.imageIds, componentIds: payload.components, qualityProfile: payload.quality, graphHash: payload.graphHash });
  for (const [index, response] of (payload.approvedDraft?.inference ?? []).entries()) await dossier.writeSnapshot(`inference/${String(index + 1).padStart(2, "0")}.response.json`, response);
  await dossier.writeSnapshot("decisions/approved-decisions.json", { draftId: payload.approvedDraft?.id, revision: payload.approvedDraft?.revision, approvalHash: payload.approvedDraft?.approvalHash, questions: payload.approvedDraft?.questions ?? [], iterations: payload.approvedDraft?.iterations ?? [] });
  await dossier.writeSnapshot("performance/spans.json", { analysisAndApproval: payload.approvedDraft?.progress ?? [], buildStartedAt: new Date().toISOString() });
  onProgress("validating", "OpenCascade가 승인 graph를 B-Rep 정본으로 컴파일하고 있습니다.");
  let cad;
  try { cad = await cadExports(modelingSpec, cadDir, payload.quality); dossier.record("cad.compiled", cad); if (cad.blockers.length) dossier.record("manufacturing.blocked", { blockers: cad.blockers }); }
  catch (error) { dossier.record("cad.failed", { message: error instanceof Error ? error.message : String(error) }); await dossier.finalize({ status: "failed", graphHash: payload.graphHash }); throw error; }
  await fs.writeFile(requestPath, `${JSON.stringify({ payload, spec: modelingSpec, imageInputs, cadSources: cad.sources, paths: { jobDir, assemblyGlb, componentDir, cadDir }, jobId }, null, 2)}\n`);
  onProgress("assembling", "Blender가 조립 GLB와 컴포넌트 자산을 내보내고 있습니다.");
  const workerPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "blender-worker.py"); const log = await run(blenderBin(), ["--background", "--factory-startup", "--python", workerPath, "--", requestPath]);
  const header = await fs.readFile(assemblyGlb); if (header.length < 20 || header.subarray(0, 4).toString("ascii") !== "glTF") throw new Error("Blender가 유효한 assembly GLB를 생성하지 못했습니다.");
  const components = Object.fromEntries(await Promise.all(payload.components.map(async (component) => { const file = path.join(componentDir, `${component}.glb`); return [component, existsSync(file) ? `/api/modeling/jobs/${jobId}/artifacts/components/${component}.glb` : null]; })));
  dossier.record("glb.exported", { assemblyGlb: path.relative(jobDir, assemblyGlb), bytes: header.length });
  // Do not turn a value the compiler did not measure into a manufacturing
  // pass.  OCCT's validity/closed-shell facts and STEP round-trip dimensions
  // are known; interference needs a dedicated contact analysis and stays
  // explicitly not-measured until that analyser is available.
  const primaryImageId = payload.approvedDraft?.evidenceManifest?.items?.find((item) => item.role === "primary_product")?.imageId ?? null;
  const contour = modelingSpec.modelingGraph ? compareAxisymmetricContour(modelingSpec.modelingGraph, payload.approvedDraft?.imageEvidence, primaryImageId) : null;
  const expectedDimensions = modelingSpec.contract.dimensionsMm;
  const actualBounds = cad.assembly.validation.sourceBoundsMm;
  const dimensions = { toleranceMm: .5, maxDeltaMm: Math.max(Math.abs(actualBounds.x - expectedDimensions.widthMm), Math.abs(actualBounds.y - expectedDimensions.depthMm), Math.abs(actualBounds.z - expectedDimensions.heightMm)) };
  const qualityReport = qualityGates({ graphHash: payload.graphHash ?? "0".repeat(64), contour, dimensions, brep: { valid: Object.values(cad.validation).every((item) => item.valid), closed: Object.values(cad.validation).every((item) => item.closed), solidCount: Math.max(...Object.values(cad.validation).map((item) => item.solidCount ?? Infinity)) }, step: { boundsDeltaMm: Math.max(...Object.values(cad.assembly.validation.boundsDeltaMm ?? { x: Infinity, y: Infinity, z: Infinity })), volumeDeltaRatio: cad.assembly.validation.volumeDeltaRatio ?? Infinity }, evidenceComplete: !cad.blockers.length });
  await dossier.writeSnapshot("validation/quality-gates.json", qualityReport);
  dossier.record("quality.gates", qualityReport);
  const dossierManifest = await dossier.finalize({ status: cad.manufacturingStatus, graphHash: payload.graphHash, manufacturingBlockers: cad.blockers, qualityReport });
  const result = { summary: `${payload.components.join(", ")} 컴포넌트를 동일 B-Rep 정본에서 생성했습니다.`, status: cad.manufacturingStatus === "manufacturing_review_required" ? "review_required" : "complete", manufacturingStatus: cad.manufacturingStatus, jobId, assetPath: `/api/modeling/jobs/${jobId}/artifacts/render/assembly.glb`, artifact: { assemblyGlb: `/api/modeling/jobs/${jobId}/artifacts/render/assembly.glb`, components, dossier: `/api/modeling/jobs/${jobId}/artifacts/MODELING-DOSSIER.md`, report: `/api/modeling/jobs/${jobId}/artifacts/manifest.json` }, exportPaths: { assemblyGlb, componentDir, cadDir }, cad, dossier: dossierManifest, log: log.trim().slice(-4000) };
  await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`); return result;
}

export function createBlenderMcpServer({ assetRoot }) {
  const server = new McpServer({ name: "net30-manufacturing-modeling-mcp", version: "2.0.0" });
  server.registerTool("model_container_assembly", { title: "Model selected container components", description: "Compiles a validated declarative assembly spec into component and assembly GLB assets.", inputSchema: modelingPayloadSchema }, async (payload) => {
    if (!payload.approvedDraft || typeof payload.approvedDraft !== "object" || !("approvalHash" in payload.approvedDraft)) throw new Error("approval_required: MCP도 승인된 초안의 approvalHash 없이는 Blender를 실행할 수 없습니다.");
    throw new Error("approval_required: MCP 실행은 서버에 저장된 draftId·revision·approvalHash를 검증하는 API를 통해서만 허용됩니다.");
  });
  return server;
}
