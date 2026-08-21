import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, "../../../../../");
const workerPath = path.join(here, "cad-worker.py");

function cadqueryBin() {
  return process.env.NET30_CADQUERY_BIN || path.join(repositoryRoot, ".cadquery-venv/bin/python");
}

function run(command, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, status: null, stderr: error.message, timedOut });
    });
    child.once("close", (status) => {
      clearTimeout(timer);
      resolve({ ok: status === 0, status, stderr: stderr.trim(), timedOut });
    });
  });
}

function diagnostic(component, report, execution) {
  if (!report) {
    return {
      componentId: component.id,
      code: execution.timedOut ? "cad_preflight_timeout" : "cad_preflight_failed",
      message: execution.stderr || "CadQuery 사전검사가 보고서를 생성하지 못했습니다.",
    };
  }
  const failures = [];
  if (!report.valid) failures.push("invalid_brep");
  if (!report.closed) failures.push("open_shell");
  if (report.solidCount !== 1) failures.push("multiple_or_missing_solids");
  return {
    componentId: component.id,
    code: failures[0] ?? (execution.ok ? "ok" : "cad_preflight_failed"),
    message: failures.length
      ? `B-Rep 사전검사: ${failures.join(", ")} (solidCount=${report.solidCount}, shellCount=${report.shellCount}).`
      : "B-Rep 사전검사를 통과했습니다.",
    valid: Boolean(report.valid),
    closed: Boolean(report.closed),
    solidCount: Number(report.solidCount),
    shellCount: Number(report.shellCount),
    boundsMm: report.boundsMm,
  };
}

/**
 * Compiles each B-Rep component in a disposable directory before it reaches
 * the approval UI. This is deliberately the same static CadQuery/OCP worker
 * used by the final export, so JSON topology cannot be treated as a proxy for
 * a closed, connected manufacturing solid.
 */
export async function preflightBrepGraph(graph, { timeoutMs = 45000, concurrency = 3 } = {}) {
  const components = graph.components.filter((component) => component.representation === "brep_solid");
  if (!components.length) return { ok: true, diagnostics: [] };
  const temporary = await mkdtemp(path.join(os.tmpdir(), "net30-brep-preflight-"));
  try {
    const diagnostics = new Array(components.length);
    let nextIndex = 0;
    const inspect = async (index) => {
      const component = components[index];
      const stem = path.join(temporary, component.id);
      const requestPath = `${stem}.request.json`;
      const reportPath = `${stem}.validation.json`;
      await writeFile(requestPath, JSON.stringify({
        graphComponent: component,
        graphNodes: graph.nodes,
        paths: { step: `${stem}.step`, brep: `${stem}.brep`, stl: `${stem}.stl`, report: reportPath },
        tessellation: { chordMm: .2, angularDeg: 15 },
      }));
      const execution = await run(cadqueryBin(), ["-u", workerPath, requestPath], timeoutMs);
      let report = null;
      try { report = JSON.parse(await readFile(reportPath, "utf8")); } catch { /* execution diagnostic below */ }
      diagnostics[index] = diagnostic(component, report, execution);
    };
    const workers = Array.from({ length: Math.min(Math.max(1, concurrency), components.length) }, async () => {
      while (nextIndex < components.length) {
        const index = nextIndex;
        nextIndex += 1;
        await inspect(index);
      }
    });
    await Promise.all(workers);
    return { ok: diagnostics.every((item) => item.code === "ok"), diagnostics };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
