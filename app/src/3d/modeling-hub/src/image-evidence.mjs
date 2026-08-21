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

const BREP_GENERATORS = new Set(["revolve", "extrude", "primitive"]);

function radialTranslation(parameters = {}) {
  const value = parameters.transform?.translationMm ?? { x: 0, y: 0 };
  return Math.hypot(Number(value.x ?? 0), Number(value.y ?? 0));
}

/** Return a conservative radial envelope for the subset of the graph that
 * the static OCCT compiler currently supports.  This is deliberately based on
 * feature semantics rather than component display names: a cap, ring, or any
 * other axisymmetric component is treated identically. */
function radialEnvelopeForNode(nodes, nodeId, cache = new Map()) {
  if (cache.has(nodeId)) return cache.get(nodeId);
  const node = nodes.get(nodeId);
  if (!node) return null;
  const params = node.parameters ?? {};
  const inputs = node.inputNodeIds.map((input) => radialEnvelopeForNode(nodes, input, cache));
  const finite = inputs.filter((value) => Number.isFinite(value));
  let envelope = null;
  if (node.operation === "revolve") {
    envelope = Math.max(0, ...(params.profile ?? []).map((point) => Math.abs(Number(point.xMm ?? 0))));
  } else if (node.operation === "primitive" || node.operation === "extrude") {
    const dimensions = params.dimensionsMm;
    envelope = params.radiusMm ?? (dimensions ? Math.max(Number(dimensions.x ?? 0), Number(dimensions.y ?? 0)) / 2 : null);
  } else if (node.operation === "rib") {
    const base = finite[0];
    if (Number.isFinite(base)) {
      // cad-worker.py places a rib centre at baseRadius + 0.15*depth and its
      // half depth remains outside; the actual radial envelope is +0.65 depth.
      const radialBase = Number.isFinite(params.radiusMm) ? Number(params.radiusMm) : base;
      envelope = radialBase + .65 * Number(params.depthMm ?? params.thicknessMm ?? 0);
    }
  } else if (node.operation === "boolean") {
    envelope = params.operation === "cut" ? finite[0] : finite.length ? Math.max(...finite) : null;
  } else if (["shell", "pattern", "transform", "mate"].includes(node.operation)) {
    envelope = finite.length ? Math.max(...finite) : null;
  }
  // A rib's local transform x is its radial placement datum in cad-worker.py,
  // not a second world-space translation.  Adding it here doubled the measured
  // cap radius and prevented the fitter from expanding undersized caps.
  if (Number.isFinite(envelope) && node.operation !== "rib") envelope += radialTranslation(params);
  cache.set(nodeId, envelope);
  return envelope;
}

function axialEnvelopeForNode(nodes, nodeId, cache = new Map()) {
  if (cache.has(nodeId)) return cache.get(nodeId);
  const node = nodes.get(nodeId);
  if (!node) return null;
  const params = node.parameters ?? {};
  const inputRanges = node.inputNodeIds.map((input) => axialEnvelopeForNode(nodes, input, cache)).filter(Boolean);
  let range = null;
  if (node.operation === "revolve") {
    const values = (params.profile ?? []).map((point) => Number(point.zMm));
    if (values.length) range = { min: Math.min(...values), max: Math.max(...values) };
  } else if (node.operation === "primitive" || node.operation === "extrude") {
    const height = Number(params.heightMm ?? params.dimensionsMm?.z);
    if (Number.isFinite(height)) range = { min: 0, max: height };
  } else if (node.operation === "rib") {
    const height = Number(params.heightMm);
    const z = Number(params.zMm ?? params.transform?.translationMm?.z ?? 0);
    if (Number.isFinite(height)) range = { min: z, max: z + height };
  } else if (node.operation === "boolean") {
    range = params.operation === "cut" ? inputRanges[0] : inputRanges.length ? { min: Math.min(...inputRanges.map((item) => item.min)), max: Math.max(...inputRanges.map((item) => item.max)) } : null;
  } else if (inputRanges.length) {
    range = { min: Math.min(...inputRanges.map((item) => item.min)), max: Math.max(...inputRanges.map((item) => item.max)) };
  }
  if (range && ["transform", "mate"].includes(node.operation)) {
    const z = Number(params.transform?.translationMm?.z ?? 0); range = { min: range.min + z, max: range.max + z };
  }
  cache.set(nodeId, range);
  return range;
}

function scaleRadialParameters(parameters, scale) {
  const next = structuredClone(parameters);
  for (const key of ["radiusMm", "innerRadiusMm", "depthMm", "spacingMm"]) {
    if (Number.isFinite(next[key])) next[key] = Number((next[key] * scale).toFixed(6));
  }
  if (next.dimensionsMm) {
    next.dimensionsMm.x = Number((next.dimensionsMm.x * scale).toFixed(6));
    next.dimensionsMm.y = Number((next.dimensionsMm.y * scale).toFixed(6));
  }
  if (next.profile) next.profile = next.profile.map((point) => ({ ...point, xMm: Number((point.xMm * scale).toFixed(6)) }));
  if (next.transform?.translationMm) {
    next.transform.translationMm.x = Number((next.transform.translationMm.x * scale).toFixed(6));
    next.transform.translationMm.y = Number((next.transform.translationMm.y * scale).toFixed(6));
  }
  return next;
}

/**
 * Bring a centred axisymmetric child inside the approved assembly envelope.
 *
 * This is a pre-review deterministic curve/feature fit, not an assembly-scale
 * shortcut: it rewrites the same graph parameters that OCCT, the review UI,
 * and the B-Rep preview consume.  We only change components that are centred
 * on the assembly axis and whose compiled operation graph has a calculable
 * radial extent.  Off-axis, non-radial, and arbitrary geometry remain a
 * reviewer question rather than being distorted automatically.
 */
export function fitRadialAssemblyEnvelope(graph, approvedDimensions = null, primaryMeasurement = null) {
  const targetDiameter = Math.min(Number(approvedDimensions?.widthMm), Number(approvedDimensions?.depthMm));
  if (!Number.isFinite(targetDiameter) || targetDiameter <= 0) return { graph, applied: false, adjustments: [] };
  const targetRadius = targetDiameter / 2;
  const next = structuredClone(graph); const nodes = new Map(next.nodes.map((node) => [node.id, node]));
  const adjustments = [];
  const measuredCapRatio = Number(primaryMeasurement?.cap?.outerDiameterRatio);
  for (const component of next.components) {
    if (component.representation !== "brep_solid") continue;
    const translation = component.transform?.translationMm ?? {};
    const rotation = component.transform?.rotationDeg ?? {};
    // The component-local convention makes radial fitting unambiguous only
    // for centred, z-axis components.  Preserve any other assembly placement.
    if (Math.hypot(Number(translation.x ?? 0), Number(translation.y ?? 0)) > 1e-6 || Math.abs(Number(rotation.x ?? 0)) > 1e-6 || Math.abs(Number(rotation.y ?? 0)) > 1e-6) continue;
    const cache = new Map();
    const envelope = Math.max(...component.rootNodeIds.map((id) => radialEnvelopeForNode(nodes, id, cache)).filter(Number.isFinite));
    const componentNodes = next.nodes.filter((item) => item.componentId === component.id);
    const ribbedRadialFeature = componentNodes.some((node) => node.operation === "pattern" && node.inputNodeIds.some((id) => nodes.get(id)?.operation === "rib"));
    const measuredTargetRadius = ribbedRadialFeature && Number.isFinite(measuredCapRatio) && measuredCapRatio > .25
      ? Math.min(targetRadius, targetRadius * measuredCapRatio)
      : targetRadius;
    const outsideMaximum = envelope > targetRadius + 1e-6;
    const measuredMismatch = ribbedRadialFeature && Math.abs(envelope - measuredTargetRadius) > .25;
    if (!Number.isFinite(envelope) || (!outsideMaximum && !measuredMismatch)) continue;
    const scale = (outsideMaximum ? targetRadius : measuredTargetRadius) / envelope;
    for (const node of componentNodes) node.parameters = scaleRadialParameters(node.parameters, scale);
    adjustments.push({ componentId: component.id, sourceRadiusMm: envelope, targetRadiusMm: outsideMaximum ? targetRadius : measuredTargetRadius, scale, source: outsideMaximum ? "approved_assembly_envelope" : "primary_cap_measurement" });
  }
  return { graph: next, applied: adjustments.length > 0, adjustments };
}

/** Fit centred component placement to the approved z-up overall-height datum.
 * It never rescales a solid vertically: a part taller than the approved
 * product is left for review.  This only corrects an otherwise valid local
 * component that a planner positioned outside the declared assembly bounds. */
export function fitAxialAssemblyEnvelope(graph, approvedDimensions = null) {
  const targetHeight = Number(approvedDimensions?.heightMm);
  if (!Number.isFinite(targetHeight) || targetHeight <= 0) return { graph, applied: false, adjustments: [] };
  const next = structuredClone(graph); const nodes = new Map(next.nodes.map((node) => [node.id, node]));
  const adjustments = [];
  for (const component of next.components) {
    if (component.representation !== "brep_solid") continue;
    const transform = component.transform ?? {}; const translation = transform.translationMm ?? { x: 0, y: 0, z: 0 };
    const ranges = component.rootNodeIds.map((id) => axialEnvelopeForNode(nodes, id, new Map())).filter(Boolean);
    if (!ranges.length) continue;
    const local = { min: Math.min(...ranges.map((item) => item.min)), max: Math.max(...ranges.map((item) => item.max)) };
    const height = local.max - local.min; const global = { min: local.min + Number(translation.z ?? 0), max: local.max + Number(translation.z ?? 0) };
    if (height > targetHeight + 1e-6 || global.max <= targetHeight + 1e-6 || Math.abs(Number(translation.z ?? 0)) < 1e-6) continue;
    const targetZ = targetHeight - local.max;
    if (targetZ + local.min < -1e-6) continue;
    component.transform = { ...transform, translationMm: { ...translation, z: Number(targetZ.toFixed(6)) } };
    adjustments.push({ componentId: component.id, sourceMinZMm: global.min, sourceMaxZMm: global.max, targetMinZMm: targetZ + local.min, targetMaxZMm: targetHeight, source: "approved_assembly_height" });
  }
  return { graph: next, applied: adjustments.length > 0, adjustments };
}

/** Keep every child B-Rep in component-local coordinates.  Some vision plans
 * place an entire ring/profile at an absolute assembly Z while leaving its
 * component transform at zero.  Rebase that unambiguous single-root case and
 * store the placement on the parent-owned component transform instead. */
export function normaliseComponentLocalCoordinates(graph) {
  const next = structuredClone(graph); const adjustments = [];
  for (const component of next.components) {
    if (component.representation !== "brep_solid") continue;
    const transform = component.transform ?? {};
    const translation = transform.translationMm ?? { x: 0, y: 0, z: 0 };
    if (Math.abs(Number(translation.z ?? 0)) > 1e-6 || component.rootNodeIds.length !== 1) continue;
    const root = next.nodes.find((node) => node.id === component.rootNodeIds[0]);
    const profile = root?.parameters?.profile;
    if (!BREP_GENERATORS.has(root?.operation) || !Array.isArray(profile) || profile.length < 4) continue;
    const minZ = Math.min(...profile.map((point) => Number(point.zMm)));
    if (!Number.isFinite(minZ) || minZ <= 1e-6) continue;
    root.parameters.profile = profile.map((point) => ({ ...point, zMm: Number((point.zMm - minZ).toFixed(6)) }));
    component.transform = { ...transform, translationMm: { ...translation, z: Number(minZ.toFixed(6)) } };
    adjustments.push({ componentId: component.id, sourceZMm: minZ, source: "component_local_coordinate_normalization" });
  }
  return { graph: next, applied: adjustments.length > 0, adjustments };
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
