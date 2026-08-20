import { executeBlenderModeling } from "./blender-mcp.mjs";
import { buildMission } from "./mission.mjs";

function env(name, fallback = "") {
  return process.env[name] && process.env[name].trim().length ? process.env[name] : fallback;
}

export async function runModelingJob(payload, { jobId } = {}) {
  const assetRoot = env("NET30_3D_ASSET_ROOT");
  if (!assetRoot) throw new Error("필수 환경변수가 없습니다: NET30_3D_ASSET_ROOT");
  const result = await executeBlenderModeling(payload, { assetRoot, jobId });
  return {
    ...result,
    mission: buildMission({ ...payload, paths: result.exportPaths }),
  };
}
