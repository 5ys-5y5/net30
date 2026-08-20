import path from "node:path";
import fs from "node:fs/promises";
import { Agent, MCPServerStdio, MCPServerStreamableHttp, run } from "@openai/agents";
import { buildMission } from "./mission.mjs";

function env(name, fallback = "") {
  return process.env[name] && process.env[name].trim().length ? process.env[name] : fallback;
}

function requireEnv(name) {
  const value = env(name);
  if (!value) throw new Error(`필수 환경변수가 없습니다: ${name}`);
  return value;
}

function createMcpServer(repoRoot) {
  const remoteUrl = env("NET30_BLENDER_MCP_URL");
  if (remoteUrl) {
    if (!/^https?:\/\//i.test(remoteUrl)) {
      throw new Error("NET30_BLENDER_MCP_URL은 http 또는 https URL이어야 합니다.");
    }
    return new MCPServerStreamableHttp({
      name: "Remote Blender MCP",
      url: remoteUrl,
    });
  }
  const mcpCommand = env("NET30_BLENDER_MCP_COMMAND", "bash");
  const mcpArgs = env("NET30_BLENDER_MCP_ARGS", path.join(repoRoot, "scripts/3d/start-blender-mcp.sh"));
  return new MCPServerStdio({
    name: "Local Blender MCP",
    fullCommand: `${mcpCommand} ${mcpArgs}`,
  });
}

export async function runModelingJob(payload) {
  requireEnv("OPENAI_API_KEY");

  const repoRoot = requireEnv("NET30_REPO");
  const assetRoot = requireEnv("NET30_3D_ASSET_ROOT");
  const model = env("NET30_OPENAI_MODEL", "gpt-5");

  const paths = {
    referenceImage: env("NET30_REFERENCE_IMAGE", path.join(assetRoot, "reference/vitamin-bottle/front.jpg")),
    blendFile: env("NET30_BLEND_FILE", path.join(assetRoot, "blender/vitamin-bottle/source/vitamin-bottle.blend")),
    renderGlb: env("NET30_RENDER_GLB", path.join(assetRoot, "exports/render/vitamin-bottle-render.glb")),
    physicsGlb: env("NET30_PHYSICS_GLB", path.join(assetRoot, "exports/physics/vitamin-bottle-collider.glb")),
    vitaminGlb: env("NET30_VITAMIN_GLB", path.join(assetRoot, "exports/render/vitamin-shapes.glb")),
    qaDir: env("NET30_QA_DIR", path.join(assetRoot, "qa/renders")),
  };

  await Promise.all([
    fs.mkdir(path.dirname(paths.blendFile), { recursive: true }),
    fs.mkdir(path.dirname(paths.renderGlb), { recursive: true }),
    fs.mkdir(path.dirname(paths.physicsGlb), { recursive: true }),
    fs.mkdir(path.dirname(paths.vitaminGlb), { recursive: true }),
    fs.mkdir(paths.qaDir, { recursive: true }),
  ]);

  const mission = buildMission({ ...payload, paths });
  const mcpServer = createMcpServer(repoRoot);
  await mcpServer.connect();

  try {
    const agent = new Agent({
      name: "NET30 Blender Modeler",
      model,
      instructions: [
        "You are a production 3D modeling agent for a vitamin bottle web configurator.",
        "Use Blender MCP tools to inspect and modify the .blend scene, then export runtime assets.",
        "Do not answer with abstract advice only; perform the scene updates and exports.",
        "When finished, provide a concise summary with output paths and any residual uncertainty.",
      ].join(" "),
      mcpServers: [mcpServer],
    });

    const result = await run(agent, mission);
    return {
      summary: String(result.finalOutput ?? ""),
      exportPaths: {
        renderGlb: paths.renderGlb,
        physicsGlb: paths.physicsGlb,
        vitaminGlb: paths.vitaminGlb,
      },
      mission,
    };
  } finally {
    await mcpServer.close();
  }
}
