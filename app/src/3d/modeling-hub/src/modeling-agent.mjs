import { executeBlenderModeling } from "./blender-mcp.mjs";
import { createModelingSpec } from "./modeling-spec.mjs";

function env(name, fallback = "") {
  return process.env[name] && process.env[name].trim().length ? process.env[name] : fallback;
}

export async function runModelingJob(payload, { jobId, imageInputs = [] } = {}) {
  const assetRoot = env("NET30_3D_ASSET_ROOT");
  if (!assetRoot) throw new Error("필수 환경변수가 없습니다: NET30_3D_ASSET_ROOT");
  const analysis = await createModelingSpec(payload, imageInputs);
  const result = await executeBlenderModeling(payload, { assetRoot, jobId, spec: analysis.spec });
  return {
    ...result,
    status: "completed",
    analysis: { source: analysis.source, model: analysis.model, imageCount: imageInputs.length, summary: analysis.spec.summary },
    modelingSpec: analysis.spec,
  };
}
