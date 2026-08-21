import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function pythonBin() {
  const bundled = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../.cadquery-venv/bin/python");
  return process.env.NET30_CADQUERY_BIN || bundled;
}

function run(command, args, timeoutMs = 45_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`image_measurement_failed: ${stderr || stdout}`.trim()));
    });
  });
}

function bufferFromDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,([\s\S]+)$/.exec(dataUrl ?? "");
  if (!match) throw new Error("image_measurement_failed: image is not a base64 data URL");
  return { extension: match[1] === "image/png" ? ".png" : match[1] === "image/webp" ? ".webp" : ".jpg", buffer: Buffer.from(match[2], "base64") };
}

/** Measure uploaded images without persisting their bytes in a draft or dossier.
 * The returned payload contains only normalized, non-sensitive geometry data. */
export async function measureImageEvidence(imageInputs = []) {
  if (!imageInputs.length) return { version: "net30.image-evidence.v1", images: [] };
  const root = await mkdtemp(path.join(os.tmpdir(), "net30-evidence-"));
  try {
    const images = await Promise.all(imageInputs.map(async (image, index) => {
      const { extension, buffer } = bufferFromDataUrl(image.dataUrl);
      const file = path.join(root, `${index + 1}${extension}`);
      await writeFile(file, buffer);
      return { id: image.id, filename: image.filename, path: file };
    }));
    const request = path.join(root, "request.json");
    await writeFile(request, JSON.stringify({ images }));
    const worker = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "image-evidence-worker.py");
    return JSON.parse(await run(pythonBin(), [worker, request]));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function interpolate(samples, zNorm) {
  const ordered = [...samples].sort((left, right) => left.zNorm - right.zNorm);
  if (!ordered.length) return 0;
  if (zNorm <= ordered[0].zNorm) return ordered[0].radiusNorm;
  if (zNorm >= ordered.at(-1).zNorm) return ordered.at(-1).radiusNorm;
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].zNorm < zNorm) continue;
    const before = ordered[index - 1], after = ordered[index]; const ratio = (zNorm - before.zNorm) / Math.max(1e-9, after.zNorm - before.zNorm);
    return before.radiusNorm + (after.radiusNorm - before.radiusNorm) * ratio;
  }
  return 0;
}

/** Apply the primary-image body contour only to the largest revolved solid.
 * This uses no component-name heuristic: the selected target is the largest
 * B-Rep profile in the graph. */
export function fitPrimaryAxisymmetricComponent(graph, evidence, primaryImageId = null, approvedDimensions = null) {
  const measured = evidence?.images?.find((item) => item.ok && item.measurement?.imageId === primaryImageId && item.measurement?.bodySilhouette?.length >= 12)?.measurement;
  if (!measured) return { graph, applied: false, reason: "evidence_missing" };
  const candidates = graph.nodes
    .filter((node) => node.operation === "revolve" && Array.isArray(node.parameters?.profile) && node.parameters.profile.length >= 4)
    .map((node) => ({ node, span: Math.max(...node.parameters.profile.map((point) => point.zMm)) - Math.min(...node.parameters.profile.map((point) => point.zMm)) }));
  const target = candidates.sort((left, right) => right.span - left.span)[0]?.node;
  if (!target) return { graph, applied: false, reason: "no_axisymmetric_brep" };
  const source = target.parameters.profile;
  const sourceZMin = Math.min(...source.map((point) => point.zMm)); const sourceZMax = Math.max(...source.map((point) => point.zMm));
  const sourceMaxRadius = Math.max(...source.map((point) => Math.abs(point.xMm)));
  // Image measurements determine the continuous contour, but cannot establish
  // scale by themselves.  When the product contract contains approved overall
  // dimensions, make that contract the datum rather than preserving an LLM
  // guessed profile extent.  This keeps the curve shape while producing a
  // component-local B-Rep with a reproducible, reviewable mm envelope.
  const targetHeightMm = Number(approvedDimensions?.heightMm);
  const targetWidthMm = Number(approvedDimensions?.widthMm);
  const zMin = Number.isFinite(targetHeightMm) && targetHeightMm > 0 ? 0 : sourceZMin;
  const zMax = Number.isFinite(targetHeightMm) && targetHeightMm > 0 ? targetHeightMm : sourceZMax;
  const maxRadius = Number.isFinite(targetWidthMm) && targetWidthMm > 0 ? targetWidthMm / 2 : sourceMaxRadius;
  const rows = measured.bodySilhouette.filter((item) => item.zNorm >= 0 && item.zNorm <= 1).sort((left, right) => left.zNorm - right.zNorm);
  // Keep the measured rows.  OCCT receives a smooth spline through these
  // samples; reducing them to a handful of points was the source of visible
  // shoulder/heel flattening and exceeded the 0.35 mm contour gate.
  const compact = rows.length <= 62 ? rows : Array.from({ length: 62 }, (_, index) => rows[Math.round(index * (rows.length - 1) / 61)]);
  const fitted = [{ xMm: 0, yMm: 0, zMm: zMin }, ...compact.map((item) => ({ xMm: Number((Math.max(0.01, item.radiusNorm * maxRadius)).toFixed(5)), yMm: 0, zMm: Number((zMin + item.zNorm * (zMax - zMin)).toFixed(5)) })), { xMm: 0, yMm: 0, zMm: zMax }];
  const next = structuredClone(graph); const node = next.nodes.find((item) => item.id === target.id);
  // V2 graphs remain readable during migration; their profile is the same
  // sampled curve.  The full NURBS declaration and provenance live in the
  // v3 envelope created from this graph, rather than weakening the existing
  // Strict Structured Outputs schema with an opaque optional field.
  node.parameters.profile = fitted;
  return {
    graph: next,
    applied: true,
    nodeId: target.id,
    measurement: measured,
    calibration: {
      sourceHeightMm: sourceZMax - sourceZMin,
      sourceDiameterMm: sourceMaxRadius * 2,
      targetHeightMm: zMax - zMin,
      targetDiameterMm: maxRadius * 2,
      source: Number.isFinite(targetHeightMm) && targetHeightMm > 0 && Number.isFinite(targetWidthMm) && targetWidthMm > 0 ? "approved_dimensions" : "graph_extent",
    },
  };
}

/** Compare the graph's outer revolved profile against the measured primary
 * contour. This is an explicit curve-fit metric, not a generative score. */
export function compareAxisymmetricContour(graph, evidence, primaryImageId = null) {
  const measured = evidence?.images?.find((item) => item.ok && item.measurement?.imageId === primaryImageId && item.measurement?.bodySilhouette?.length >= 12)?.measurement;
  const profile = graph.nodes.filter((node) => node.operation === "revolve" && node.parameters?.profile?.length >= 4).sort((left, right) => right.parameters.profile.length - left.parameters.profile.length)[0]?.parameters.profile;
  if (!measured || !profile) return null;
  const outer = profile.filter((point) => point.xMm > 0); const maxRadius = Math.max(...outer.map((point) => Math.abs(point.xMm))); const zMin = Math.min(...outer.map((point) => point.zMm)); const zMax = Math.max(...outer.map((point) => point.zMm));
  const graphSamples = outer.map((point) => ({ zNorm: (point.zMm - zMin) / Math.max(1e-9, zMax - zMin), radiusNorm: Math.abs(point.xMm) / maxRadius }));
  const diffs = measured.bodySilhouette.map((item) => Math.abs(interpolate(graphSamples, item.zNorm) - item.radiusNorm));
  const rmsMm = Math.sqrt(diffs.reduce((sum, item) => sum + item ** 2, 0) / diffs.length) * maxRadius;
  const sorted = [...diffs].sort((left, right) => left - right); const hausdorff95Mm = sorted[Math.floor((sorted.length - 1) * .95)] * maxRadius;
  const graphArea = measured.bodySilhouette.reduce((sum, item) => sum + interpolate(graphSamples, item.zNorm), 0); const targetArea = measured.bodySilhouette.reduce((sum, item) => sum + item.radiusNorm, 0); const intersection = measured.bodySilhouette.reduce((sum, item) => sum + Math.min(interpolate(graphSamples, item.zNorm), item.radiusNorm), 0); const union = graphArea + targetArea - intersection;
  return { iou: union > 0 ? intersection / union : 0, rmsMm, hausdorff95Mm, sampleCount: diffs.length, imageId: measured.imageId };
}
