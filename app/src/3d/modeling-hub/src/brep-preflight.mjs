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
    const startedAt = Date.now();
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    let timedOut = false;
    let forceTimer = null;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // OCCT can be inside a native operation when the soft signal arrives.
      // A bounded preflight must still settle; otherwise one malformed graph
      // keeps the draft in "analyzing" forever and hides the real cause.
      forceTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", (error) => {
      clearTimeout(timer); if (forceTimer) clearTimeout(forceTimer);
      resolve({ ok: false, status: null, signal: null, stdout, stderr: error.message, timedOut, timeoutMs, elapsedMs: Date.now() - startedAt });
    });
    child.once("close", (status, signal) => {
      clearTimeout(timer); if (forceTimer) clearTimeout(forceTimer);
      resolve({ ok: status === 0, status, signal, stdout: stdout.trim(), stderr: stderr.trim(), timedOut, timeoutMs, elapsedMs: Date.now() - startedAt });
    });
  });
}

function diagnostic(component, report, execution) {
  if (!report) {
    return {
      componentId: component.id,
      code: execution.timedOut ? "cad_preflight_timeout" : "cad_preflight_failed",
      message: execution.timedOut
        ? `CadQuery 사전검사가 ${Math.round(execution.timeoutMs / 1000)}초 제한을 넘었습니다 (signal=${execution.signal ?? "none"}, elapsed=${execution.elapsedMs}ms).`
        : execution.stderr || execution.stdout || "CadQuery 사전검사가 보고서를 생성하지 못했습니다.",
      execution: { timedOut: execution.timedOut, timeoutMs: execution.timeoutMs, elapsedMs: execution.elapsedMs, status: execution.status, signal: execution.signal, stdout: execution.stdout.slice(-2_000), stderr: execution.stderr.slice(-2_000) },
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
    execution: { timedOut: execution.timedOut, timeoutMs: execution.timeoutMs, elapsedMs: execution.elapsedMs, status: execution.status, signal: execution.signal, stdout: execution.stdout.slice(-2_000), stderr: execution.stderr.slice(-2_000) },
  };
}

function rotate(point, degrees = {}) {
  let { x, y, z } = point;
  const radians = (value) => Number(value ?? 0) * Math.PI / 180;
  const rx = radians(degrees.x); const ry = radians(degrees.y); const rz = radians(degrees.z);
  let nextY = y * Math.cos(rx) - z * Math.sin(rx); let nextZ = y * Math.sin(rx) + z * Math.cos(rx); y = nextY; z = nextZ;
  let nextX = x * Math.cos(ry) + z * Math.sin(ry); nextZ = -x * Math.sin(ry) + z * Math.cos(ry); x = nextX; z = nextZ;
  nextX = x * Math.cos(rz) - y * Math.sin(rz); nextY = x * Math.sin(rz) + y * Math.cos(rz); return { x: nextX, y: nextY, z };
}

function assemblyPoint(point, transform = {}) {
  const rotated = rotate(point, transform.rotationDeg);
  const translation = transform.translationMm ?? {};
  return { x: rotated.x + Number(translation.x ?? 0), y: rotated.y + Number(translation.y ?? 0), z: rotated.z + Number(translation.z ?? 0) };
}

function binaryStlTriangles(bytes, maxTriangles = 700) {
  // OCCT writes binary STL. This sampled display mesh is only a review
  // projection; no manufacturing geometry is reconstructed from it.
  if (bytes.length < 84) return [];
  const count = bytes.readUInt32LE(80);
  if (84 + count * 50 > bytes.length) return [];
  const stride = Math.max(1, Math.ceil(count / maxTriangles)); const triangles = [];
  for (let index = 0; index < count; index += stride) {
    const offset = 84 + index * 50 + 12;
    triangles.push([0, 12, 24].map((delta) => ({ x: bytes.readFloatLE(offset + delta), y: bytes.readFloatLE(offset + delta + 4), z: bytes.readFloatLE(offset + delta + 8) })));
  }
  return triangles;
}

function binaryStlAxisymmetricContour(bytes, bins = 64) {
  if (bytes.length < 84) return null;
  const count = bytes.readUInt32LE(80);
  if (84 + count * 50 > bytes.length) return null;
  let zMin = Infinity; let zMax = -Infinity; const triangles = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 84 + index * 50 + 12;
    const triangle = [0, 12, 24].map((delta) => {
      const x = bytes.readFloatLE(offset + delta); const y = bytes.readFloatLE(offset + delta + 4); const z = bytes.readFloatLE(offset + delta + 8);
      zMin = Math.min(zMin, z); zMax = Math.max(zMax, z); return { x, y, z };
    });
    triangles.push(triangle);
  }
  if (!triangles.length || !(zMax > zMin)) return null;
  // Bucketed STL vertices under-measure sloped walls when a section contains
  // no vertex. Intersect every tessellation triangle with each axial section
  // instead, so the gate measures the compiled B-Rep exterior rather than
  // an accidental vertex distribution.
  const maxima = Array.from({ length: bins }, (_, index) => {
    const z = zMin + (zMax - zMin) * index / Math.max(1, bins - 1); let radius = 0;
    for (const triangle of triangles) {
      for (const [start, end] of [[triangle[0], triangle[1]], [triangle[1], triangle[2]], [triangle[2], triangle[0]]]) {
        const low = Math.min(start.z, end.z), high = Math.max(start.z, end.z);
        if (z < low - 1e-7 || z > high + 1e-7) continue;
        const dz = end.z - start.z;
        if (Math.abs(dz) <= 1e-9) {
          if (Math.abs(z - start.z) <= 1e-7) radius = Math.max(radius, Math.hypot(start.x, start.y), Math.hypot(end.x, end.y));
          continue;
        }
        const ratio = (z - start.z) / dz;
        if (ratio < -1e-7 || ratio > 1 + 1e-7) continue;
        const x = start.x + (end.x - start.x) * ratio; const y = start.y + (end.y - start.y) * ratio;
        radius = Math.max(radius, Math.hypot(x, y));
      }
    }
    return radius;
  });
  const maxRadius = Math.max(...maxima); if (!(maxRadius > 1e-8)) return null;
  return maxima.map((radius, index) => ({ zNorm: index / Math.max(1, bins - 1), radiusNorm: radius / maxRadius }));
}

function projected(point, view, explodedOffset = 0) {
  if (view === "side") return { x: point.y, y: point.z };
  if (view === "isometric") return { x: point.x + point.y * .62, y: point.z - (point.x + point.y) * .22 };
  if (view === "exploded") return { x: point.x + explodedOffset, y: point.z };
  return { x: point.x, y: point.z };
}

function normaliseProjectedMeshes(entries, view, width, height) {
  const source = entries.flatMap((entry) => entry.triangles.flatMap((triangle) => triangle.map((point) => projected(point, view, entry.explodedOffset))));
  if (!source.length) return entries.map((entry) => ({ ...entry, triangles: [] }));
  const minX = Math.min(...source.map((point) => point.x)); const maxX = Math.max(...source.map((point) => point.x)); const minY = Math.min(...source.map((point) => point.y)); const maxY = Math.max(...source.map((point) => point.y));
  const scale = Math.min((width - 120) / Math.max(.001, maxX - minX), (height - 140) / Math.max(.001, maxY - minY));
  const toCanvas = (point) => ({ x: 60 + (point.x - minX) * scale, y: height - 64 - (point.y - minY) * scale });
  return entries.map((entry) => ({ ...entry, triangles: entry.triangles.map((triangle) => triangle.map((point) => toCanvas(projected(point, view, entry.explodedOffset)))) }));
}

function brepSketchPlan(graph, meshSources, { width = 1000, height = 680, title = "OCCT B-Rep 검토" } = {}) {
  const views = [{ id: "front", label: "정면" }, { id: "side", label: "측면" }, { id: "isometric", label: "등각" }, { id: "exploded", label: "분해" }];
  const solids = graph.components.filter((component) => component.representation === "brep_solid");
  const entries = solids.map((component, index) => ({
    id: component.id, label: component.requestedName, color: component.material.baseColor, note: "동일 OCCT B-Rep의 저해상도 검토 테셀레이션", nodeIds: graph.nodes.filter((node) => node.componentId === component.id).map((node) => node.id),
    triangles: (meshSources.get(component.id) ?? []).map((triangle) => triangle.map((point) => assemblyPoint(point, component.transform))), explodedOffset: (index - (solids.length - 1) / 2) * 38,
  }));
  const perView = Object.fromEntries(views.map((view) => [view.id, normaliseProjectedMeshes(entries, view.id, width, height)]));
  return { version: "net30.brep-sketch.v1", width, height, title, views, components: entries.map((entry, index) => {
    const meshViews = Object.fromEntries(views.map((view) => [view.id, perView[view.id][index].triangles])); const points = meshViews.front?.[0] ?? [];
    return { id: entry.id, label: entry.label, color: entry.color, note: entry.note, nodeIds: entry.nodeIds, points, views: {}, meshViews };
  }), annotations: [{ label: "OCCT B-Rep 정본의 저해상도 검토 투영입니다. 단면은 승인된 절단 평면이 생길 때까지 표시하지 않습니다.", x: 36, y: 42 }] };
}

/**
 * Compiles each B-Rep component in a disposable directory before it reaches
 * the approval UI. This is deliberately the same static CadQuery/OCP worker
 * used by the final export, so JSON topology cannot be treated as a proxy for
 * a closed, connected manufacturing solid.
 */
export async function preflightBrepGraph(graph, { timeoutMs = 45000, concurrency = 3, preview = null } = {}) {
  const components = graph.components.filter((component) => component.representation === "brep_solid");
  if (!components.length) return { ok: true, diagnostics: [] };
  const temporary = await mkdtemp(path.join(os.tmpdir(), "net30-brep-preflight-"));
  try {
    const diagnostics = new Array(components.length); const meshSources = new Map();
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
      diagnostics[index].transform = component.transform ?? { translationMm: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } };
      diagnostics[index].material = component.material ?? null;
      let stl = null;
      if (execution.ok && diagnostics[index].code === "ok") {
        try { stl = await readFile(`${stem}.stl`); diagnostics[index].silhouette = binaryStlAxisymmetricContour(stl); } catch { /* the B-Rep diagnostic stays authoritative */ }
      }
      if (preview && execution.ok && diagnostics[index].code === "ok") {
        try { meshSources.set(component.id, binaryStlTriangles(stl ?? await readFile(`${stem}.stl`), preview.maxTriangles ?? 700)); } catch { /* the diagnostic is the authoritative failure result */ }
      }
    };
    const workers = Array.from({ length: Math.min(Math.max(1, concurrency), components.length) }, async () => {
      while (nextIndex < components.length) {
        const index = nextIndex;
        nextIndex += 1;
        await inspect(index);
      }
    });
    await Promise.all(workers);
    return { ok: diagnostics.every((item) => item.code === "ok"), diagnostics, sketchPlan: preview ? brepSketchPlan(graph, meshSources, preview) : null };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
