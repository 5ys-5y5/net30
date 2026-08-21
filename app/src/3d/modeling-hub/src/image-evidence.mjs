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

/** Align an image-backed surface artwork crop with the artwork's approved
 * physical Z placement.  Vision is useful for choosing the artwork and its
 * horizontal crop, but a photograph crop must not independently choose a
 * different vertical region from the one that the graph places on the part.
 *
 * This is deliberately geometry/evidence based: it uses the selected image's
 * measured product bounds and the graph's own mm datum.  It does not inspect a
 * component name, product name, or a hard-coded product layout.  If either
 * datum is missing, the original reviewed crop is left unchanged.
 */
export function alignArtworkCropToPhysicalPlacement(graph, evidence, product, primaryImageId = null) {
  const next = structuredClone(graph);
  const productHeightMm = Number(product?.heightMm ?? product?.dimensionsMm?.heightMm);
  if (!(productHeightMm > 0) || !primaryImageId) return { graph: next, applied: false, adjustments: [], reason: "physical_or_primary_image_missing" };
  const measurement = evidence?.images?.find((item) => item.ok && item.measurement?.imageId === primaryImageId)?.measurement;
  const bounds = measurement?.bounds;
  const imageHeightPx = Number(measurement?.heightPx);
  const imageSpanPx = Number(bounds?.bottomY) - Number(bounds?.topY);
  if (!(imageHeightPx > 0) || !(imageSpanPx > 0)) return { graph: next, applied: false, adjustments: [], reason: "image_bounds_missing" };

  const adjustments = [];
  for (const node of next.nodes) {
    if (!['surface_decal', 'surface_artwork'].includes(node.operation)) continue;
    const params = node.parameters ?? {};
    // Only the primary product image has an agreed product datum.  A secondary
    // image can still supply an approved artwork crop, but it must not inherit
    // a different product silhouette's coordinate system.
    if (params.artworkImageId !== primaryImageId || !params.artworkCrop || !params.dimensionsMm) continue;
    const artworkHeightMm = Number(params.dimensionsMm.y);
    const localZ = Number(params.transform?.translationMm?.z ?? 0);
    const componentZ = Number(next.components.find((item) => item.id === node.componentId)?.transform?.translationMm?.z ?? 0);
    if (!(artworkHeightMm > 0) || !Number.isFinite(localZ) || !Number.isFinite(componentZ)) continue;
    const centreZ = componentZ + localZ;
    const topZ = Math.min(productHeightMm, Math.max(0, centreZ + artworkHeightMm / 2));
    const bottomZ = Math.min(productHeightMm, Math.max(0, centreZ - artworkHeightMm / 2));
    if (topZ - bottomZ <= 1e-6) continue;
    const topPx = Number(bounds.topY) + (1 - topZ / productHeightMm) * imageSpanPx;
    const bottomPx = Number(bounds.topY) + (1 - bottomZ / productHeightMm) * imageSpanPx;
    const y = Math.max(0, Math.min(1, topPx / imageHeightPx));
    const height = Math.max(0, Math.min(1 - y, (bottomPx - topPx) / imageHeightPx));
    if (!(height > 1e-6)) continue;
    const previous = params.artworkCrop;
    if (Math.abs(previous.y - y) <= 1e-6 && Math.abs(previous.height - height) <= 1e-6) continue;
    node.parameters = {
      ...params,
      artworkCrop: { ...previous, y: Number(y.toFixed(7)), height: Number(height.toFixed(7)) },
    };
    adjustments.push({
      nodeId: node.id,
      imageId: primaryImageId,
      previousCrop: previous,
      crop: node.parameters.artworkCrop,
      physicalPlacementMm: { centreZ: Number(centreZ.toFixed(6)), height: Number(artworkHeightMm.toFixed(6)) },
      source: "approved_artwork_placement+measured_image_bounds",
    });
  }
  return { graph: next, applied: adjustments.length > 0, adjustments, reason: adjustments.length ? null : "no_primary_artwork_to_align" };
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

/** A clamped rational B-spline declaration whose multiplicities are valid in
 * OCCT.  This is intentionally shared by evidence fitting and v3 adaptation:
 * a graph must never claim a NURBS while emitting a knot vector that cannot
 * define one. */
export function clampedNurbs(points, degree = 3) {
  const poles = points.map(({ xMm, zMm }) => ({ xMm: Number(xMm), zMm: Number(zMm) }));
  const resolvedDegree = Math.max(1, Math.min(Math.floor(degree), poles.length - 1));
  const uniqueKnotCount = poles.length - resolvedDegree + 1;
  const knots = Array.from({ length: uniqueKnotCount }, (_, index) => uniqueKnotCount === 1 ? 0 : index / (uniqueKnotCount - 1));
  const multiplicities = knots.map((_, index) => index === 0 || index === knots.length - 1 ? resolvedDegree + 1 : 1);
  return { kind: "nurbs", poles, degree: resolvedDegree, weights: poles.map(() => 1), knots, multiplicities, periodic: false };
}

/** Build C1 monotone Bézier pieces through a measured radial contour.
 *
 * Directly treating measured contour samples as B-spline *control* poles does
 * not interpolate them and can overshoot the approved width/height.  This
 * Fritsch–Carlson-style derivative limiter retains the samples as curve end
 * points, prevents a new radial extremum between them, and produces ordinary
 * OCCT Bézier edges rather than a display polyline or mesh approximation.
 */
export function monotoneBezierSegments(points) {
  if (points.length < 2) return [];
  const slopes = points.slice(1).map((point, index) => {
    const previous = points[index]; const dz = Number(point.zMm) - Number(previous.zMm);
    if (!(dz > 1e-8)) throw new Error("graph_invalid: measured contour must be strictly ordered by z");
    return (Number(point.xMm) - Number(previous.xMm)) / dz;
  });
  const derivatives = points.map((point, index) => {
    if (index === 0) return slopes[0];
    if (index === points.length - 1) return slopes.at(-1);
    const left = slopes[index - 1], right = slopes[index];
    if (left * right <= 0) return 0;
    const hLeft = Number(points[index].zMm) - Number(points[index - 1].zMm);
    const hRight = Number(points[index + 1].zMm) - Number(points[index].zMm);
    return ((2 * hRight + hLeft) + (hRight + 2 * hLeft)) /
      (((2 * hRight + hLeft) / left) + ((hRight + 2 * hLeft) / right));
  });
  return points.slice(1).map((end, index) => {
    const start = points[index]; const dz = Number(end.zMm) - Number(start.zMm);
    const minX = Math.min(Number(start.xMm), Number(end.xMm)); const maxX = Math.max(Number(start.xMm), Number(end.xMm));
    // A cubic Bézier is confined to its control hull, not merely its two end
    // points. Clamp both tangent handles to the measured interval so a noisy
    // local slope cannot create an unmeasured shoulder bulge in the B-Rep.
    const handleStartX = Math.min(maxX, Math.max(minX, Number(start.xMm) + derivatives[index] * dz / 3));
    const handleEndX = Math.min(maxX, Math.max(minX, Number(end.xMm) - derivatives[index + 1] * dz / 3));
    return {
      kind: "bezier",
      points: [
        { xMm: Number(start.xMm), zMm: Number(start.zMm) },
        { xMm: Number(handleStartX.toFixed(6)), zMm: Number((Number(start.zMm) + dz / 3).toFixed(6)) },
        { xMm: Number(handleEndX.toFixed(6)), zMm: Number((Number(end.zMm) - dz / 3).toFixed(6)) },
        { xMm: Number(end.xMm), zMm: Number(end.zMm) },
      ],
      periodic: false,
    };
  });
}

const BREP_GENERATORS = new Set(["revolve", "extrude", "loft", "sweep", "primitive"]);

/**
 * Continuous silhouette fitting is only safe when the target's exterior is
 * the component's sole independent generating source.  A separate zero-input
 * sweep/rib/cutter can be joined to that exterior at an old radius or height;
 * moving only the exterior would turn an otherwise valid B-Rep into multiple
 * solids.  Do not silently bridge it or apply a name-based placement rule:
 * retain the approved graph and expose a topology/review requirement.
 */
function hasUnanchoredExteriorFeature(graph, componentId, primaryNodeId = null) {
  const nodes = graph.nodes.filter((node) => node.componentId === componentId);
  for (const generator of nodes) {
    if (generator.id === primaryNodeId || !BREP_GENERATORS.has(generator.operation) || (generator.inputNodeIds?.length ?? 0) !== 0) continue;
    const consumers = nodes.filter((node) => node.inputNodeIds?.includes(generator.id));
    // A standalone sweep that is unioned into a fitted exterior has no
    // parametric surface attachment. Moving the exterior would detach it.
    if (generator.operation === "sweep" && consumers.some((node) => node.operation === "boolean" && node.parameters?.operation === "union")) return true;
    // A direct primitive/extrude pattern seed has no transform node that can
    // be re-anchored to the measured exterior. A transform-wrapped seed is
    // handled deterministically by fitClosureOutline instead.
    if (consumers.some((node) => node.operation === "pattern" && node.inputNodeIds?.at(-1) === generator.id)) return true;
  }
  return false;
}

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
  // OCCT treats the declared curve segments as the manufacturing source when
  // they are present.  Scaling only the legacy/profile points leaves a second,
  // stale set of NURBS control ordinates behind: review JSON says one diameter
  // while the B-Rep compiles another.  Keep every radial curve representation
  // in lockstep so an approved envelope is one physical datum.
  if (Array.isArray(next.curveSegments)) next.curveSegments = next.curveSegments.map((segment) => {
    const scalePoints = (points) => Array.isArray(points)
      ? points.map((point) => ({ ...point, xMm: Number((Number(point.xMm) * scale).toFixed(6)) }))
      : points;
    const scaled = { ...segment };
    if (Array.isArray(segment.points)) scaled.points = scalePoints(segment.points);
    if (Array.isArray(segment.poles)) scaled.poles = scalePoints(segment.poles);
    return scaled;
  });
  if (next.transform?.translationMm) {
    next.transform.translationMm.x = Number((next.transform.translationMm.x * scale).toFixed(6));
    next.transform.translationMm.y = Number((next.transform.translationMm.y * scale).toFixed(6));
  }
  return next;
}

function componentNodes(graph, componentId) {
  return graph.nodes.filter((node) => node.componentId === componentId);
}

/** A patterned radial feature is a geometric signal, not a display-name
 * convention.  It is the smallest safe way to associate the measured cap
 * colour band with the intended closure in an otherwise arbitrary product
 * graph. */
function patternedRadialComponent(graph, nodes = new Map(graph.nodes.map((node) => [node.id, node]))) {
  const candidates = graph.components
    .filter((component) => component.representation === "brep_solid")
    .map((component) => {
      const hasPattern = componentNodes(graph, component.id).some((node) =>
        (node.operation === "pattern" && node.inputNodeIds.length >= 1)
        // v1/v2 revisions persisted this same radial topology as a translated
        // primitive with a declared repeat count and an explicit host union.
        // It is a feature-graph signal, not a component-name heuristic.
        || (node.operation === "primitive" && node.inputNodeIds.length >= 1 && node.parameters?.operation === "union" && Number(node.parameters?.count) >= 2),
      );
      const envelope = Math.max(...component.rootNodeIds.map((id) => radialEnvelopeForNode(nodes, id, new Map())).filter(Number.isFinite));
      return { component, hasPattern, envelope };
    })
    .filter((item) => item.hasPattern && Number.isFinite(item.envelope));
  return candidates.sort((left, right) => right.envelope - left.envelope)[0] ?? null;
}

/** Place a declared radial closure on the approved assembly top when an older
 * graph has no image-fit record. This is a deterministic datum migration for
 * a topology that already states its repeated closure feature; it neither
 * invents a cap from a name nor changes arbitrary unpatterned components. */
export function fitPatternedClosureToAssemblyTop(graph, approvedDimensions = null) {
  const targetHeight = Number(approvedDimensions?.heightMm);
  if (!Number.isFinite(targetHeight) || targetHeight <= 0) return { graph, applied: false, adjustments: [], reason: "assembly_height_missing" };
  const candidate = patternedRadialComponent(graph);
  if (!candidate) return { graph, applied: false, adjustments: [], reason: "patterned_closure_not_found" };
  const range = localAxialRange(graph, candidate.component);
  if (!range || !(range.max > range.min) || range.max - range.min > targetHeight + 1e-6) return { graph, applied: false, adjustments: [], reason: "closure_height_unmeasurable" };
  const targetZ = targetHeight - range.max;
  const currentZ = Number(candidate.component.transform?.translationMm?.z ?? 0);
  if (Math.abs(currentZ - targetZ) <= 1e-6) return { graph, applied: false, adjustments: [], reason: "already_aligned" };
  const next = structuredClone(graph); const component = next.components.find((item) => item.id === candidate.component.id);
  const transform = component.transform ?? {}; const translation = transform.translationMm ?? {};
  component.transform = { ...transform, translationMm: { ...translation, z: Number(targetZ.toFixed(6)) } };
  return { graph: next, applied: true, adjustments: [{ componentId: component.id, source: "patterned_closure_assembly_top_datum", previousZMm: currentZ, targetZMm: Number(targetZ.toFixed(6)), localMaxZMm: range.max, assemblyTopMm: targetHeight }] };
}

function scaleAxialParameters(parameters, scale, originZ) {
  const next = structuredClone(parameters);
  const mapZ = (value) => Number((originZ + (Number(value) - originZ) * scale).toFixed(6));
  if (next.profile) next.profile = next.profile.map((point) => ({ ...point, zMm: mapZ(point.zMm) }));
  if (next.curveSegments) next.curveSegments = next.curveSegments.map((segment) => {
    const adjusted = { ...segment };
    // Strict graph schemas reject even an undefined unknown key. Preserve
    // only the declared curve representation rather than manufacturing a
    // `poles: undefined` property for ordinary Bézier segments.
    if (Array.isArray(segment.points)) adjusted.points = segment.points.map((point) => ({ ...point, zMm: mapZ(point.zMm) }));
    if (Array.isArray(segment.poles)) adjusted.poles = segment.poles.map((point) => ({ ...point, zMm: mapZ(point.zMm) }));
    return adjusted;
  });
  for (const key of ["heightMm", "zMm"]) if (Number.isFinite(next[key])) next[key] = key === "zMm" ? mapZ(next[key]) : Number((next[key] * scale).toFixed(6));
  if (next.dimensionsMm && Number.isFinite(next.dimensionsMm.z)) next.dimensionsMm.z = Number((next.dimensionsMm.z * scale).toFixed(6));
  if (next.transform?.translationMm && Number.isFinite(next.transform.translationMm.z)) next.transform.translationMm.z = mapZ(next.transform.translationMm.z);
  return next;
}

function localAxialRange(graph, component) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const ranges = component.rootNodeIds.map((id) => axialEnvelopeForNode(nodes, id, new Map())).filter(Boolean);
  if (!ranges.length) return null;
  return { min: Math.min(...ranges.map((range) => range.min)), max: Math.max(...ranges.map((range) => range.max)) };
}

function outerRevolveNode(graph, componentId) {
  return componentNodes(graph, componentId)
    .filter((node) => node.operation === "revolve" && Array.isArray(node.parameters?.profile) && node.parameters.profile.length >= 4)
    .map((node) => ({ node, radius: Math.max(...node.parameters.profile.map((point) => Math.abs(Number(point.xMm ?? 0)))) }))
    .sort((left, right) => right.radius - left.radius)[0]?.node ?? null;
}

function fitClosureOutline(graph, componentId, capMeasurement, approvedDimensions) {
  const samples = Array.isArray(capMeasurement?.silhouette) ? capMeasurement.silhouette
    .filter((sample) => Number.isFinite(Number(sample.zNorm)) && Number.isFinite(Number(sample.radiusNorm)))
    .sort((left, right) => Number(left.zNorm) - Number(right.zNorm)) : [];
  const component = graph.components.find((item) => item.id === componentId);
  const target = component ? outerRevolveNode(graph, componentId) : null;
  const targetRadius = Math.min(Number(approvedDimensions?.widthMm), Number(approvedDimensions?.depthMm)) / 2;
  const range = component ? localAxialRange(graph, component) : null;
  if (!target || !range || samples.length < 12 || !Number.isFinite(targetRadius) || targetRadius <= 0 || range.max - range.min <= 1e-6) {
    return null;
  }
  // A cap band has a comparatively simple axial outline, while every fitted
  // sample becomes a native OCCT Bézier edge and then participates in shell
  // and rib Boolean work. Preserve the measured curve through deterministic
  // fitting knots, but bound that representation to 24 segments so a high
  // resolution photograph cannot turn one closure into a multi-minute CAD
  // operation. This is curve compression, not a mesh simplification.
  const compact = samples.length <= 24 ? samples : Array.from({ length: 24 }, (_, index) => samples[Math.round(index * (samples.length - 1) / 23)]);
  const outer = compact.map((sample) => ({
    xMm: Number((Math.max(.01, Number(sample.radiusNorm) * targetRadius)).toFixed(6)),
    yMm: 0,
    zMm: Number((range.min + Number(sample.zNorm) * (range.max - range.min)).toFixed(6)),
  }));
  // The raw profile keeps the explicit axial closing edges required for a
  // revolved face. The exact observed outer curve is separately declared as
  // bounded C1 Bézier segments, so OCCT never substitutes a mesh approximation
  // or an LLM-guessed control net.
  target.parameters.profile = [
    { xMm: 0, yMm: 0, zMm: range.min },
    ...outer,
    { xMm: 0, yMm: 0, zMm: range.max },
  ];
  target.parameters.curveSegments = monotoneBezierSegments(outer.map(({ xMm, zMm }) => ({ xMm, zMm })));
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const anchors = [];
  const visible = outer.map((point) => ({ xMm: point.xMm, zMm: point.zMm }));
  const radiusAt = (zMm) => interpolate(visible.map((point) => ({ zNorm: (point.zMm - range.min) / Math.max(1e-9, range.max - range.min), radiusNorm: point.xMm / targetRadius })), (zMm - range.min) / Math.max(1e-9, range.max - range.min)) * targetRadius;
  for (const pattern of componentNodes(graph, componentId).filter((node) => node.operation === "pattern" && node.inputNodeIds.length >= 1)) {
    const seed = byId.get(pattern.inputNodeIds.at(-1));
    if (seed?.operation !== "transform" || !seed.inputNodeIds.length) continue;
    const primitive = byId.get(seed.inputNodeIds[0]); const width = Number(primitive?.parameters?.dimensionsMm?.x);
    const translation = seed.parameters?.transform?.translationMm ?? {};
    const zMm = Number(translation.z ?? 0);
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(zMm)) continue;
    // The colour silhouette measures the *outermost* repeated rib, not the
    // un-ribbed host cylinder. Move the centred seed inward from the historic
    // outer-host placement while retaining a bounded material overlap. Exact
    // tangency/embedding can make OCCT's multi-rib Boolean ill-conditioned,
    // so this is a stable geometric fit rather than a fake mesh offset.
    const surfaceRadius = radiusAt(zMm);
    seed.parameters.transform = { ...seed.parameters.transform, translationMm: { ...translation, x: Number((Math.max(.01, surfaceRadius - width * .15)).toFixed(6)) } };
    // Legacy planners can express a rib seed as a transformed box. It is a
    // valid feature representation, but its vertical extent must not run
    // beyond the measured closure outline and flatten a rounded cap apex.
    // Clip only an explicit radial-pattern seed, in the same component and
    // only against observed cap coverage; unrelated boxes are untouched.
    const seedHeight = Number(primitive?.parameters?.dimensionsMm?.z);
    const measuredTop = outer.at(-1)?.zMm;
    let clippedHeightMm = null;
    if (primitive?.operation === "primitive" && Number.isFinite(seedHeight) && seedHeight > 0 && Number.isFinite(measuredTop) && zMm + seedHeight > measuredTop + 1e-6) {
      // A rigid patterned box cannot follow a tapering/receding host surface.
      // Stop it at the last measured ordinate whose radial change remains
      // inside its declared penetration overlap. A planner that needs ribs on
      // a continuously tapering surface must choose a sweep/rib feature;
      // silently leaving a rectangular pattern floating outside the B-Rep is
      // less faithful and can invalidate a manufacturing Boolean.
      const maximumDeviation = width * .35;
      const supportedTop = outer.filter((point) => point.zMm >= zMm - 1e-6 && Math.abs(point.xMm - surfaceRadius) <= maximumDeviation + 1e-6).at(-1)?.zMm ?? measuredTop;
      const nextHeight = Math.min(measuredTop, supportedTop) - zMm;
      if (nextHeight > .05) {
        primitive.parameters.dimensionsMm = { ...primitive.parameters.dimensionsMm, z: Number(nextHeight.toFixed(6)) };
        clippedHeightMm = Number(nextHeight.toFixed(6));
      }
    }
    anchors.push({ patternNodeId: pattern.id, seedNodeId: seed.id, zMm, surfaceRadiusMm: surfaceRadius, outerDatumMm: surfaceRadius, overlapMm: width * .65, clippedHeightMm });
  }
  return { nodeId: target.id, samples: outer.length, source: "primary_cap_silhouette_measurement", patternSeedAnchors: anchors };
}

function radiusFromProfile(profile, zMm) {
  const visible = (profile ?? []).filter((point) => Math.abs(Number(point.xMm)) > 1e-8)
    .map((point) => ({ zNorm: Number(point.zMm), radiusNorm: Math.abs(Number(point.xMm)) }));
  return interpolate(visible, zMm);
}

/** A Boolean union must result in one physical solid, not a visually nearby
 * detached ring. When an annular revolve is explicitly unioned with a shell,
 * anchor its outer wall into the shell's inner wall with a bounded overlap.
 * Separate components remain separate; this acts only on the graph's own
 * declared Boolean topology. */
function anchorUnionAnnularFeatures(graph, componentId) {
  const byId = new Map(graph.nodes.map((node) => [node.id, node])); const adjustments = [];
  for (const boolean of componentNodes(graph, componentId).filter((node) => node.operation === "boolean" && node.parameters?.operation === "union")) {
    const shell = boolean.inputNodeIds.map((id) => byId.get(id)).find((node) => node?.operation === "shell");
    if (!shell?.inputNodeIds?.length) continue;
    const outer = byId.get(shell.inputNodeIds[0]); const thickness = Number(shell.parameters?.thicknessMm);
    if (outer?.operation !== "revolve" || !Number.isFinite(thickness) || thickness <= 0) continue;
    for (const node of boolean.inputNodeIds.map((id) => byId.get(id)).filter((node) => node?.operation === "revolve" && node.id !== outer.id)) {
      const profile = node.parameters?.profile; const visible = (profile ?? []).filter((point) => Number(point.xMm) > 1e-8);
      if (visible.length < 3) continue;
      const ringMax = Math.max(...visible.map((point) => Number(point.xMm))); const ringMin = Math.min(...visible.map((point) => Number(point.xMm)));
      const zMid = (Math.min(...visible.map((point) => Number(point.zMm))) + Math.max(...visible.map((point) => Number(point.zMm)))) / 2;
      const innerRadius = radiusFromProfile(outer.parameters?.profile, zMid) - thickness;
      if (!Number.isFinite(innerRadius) || innerRadius <= 0 || ringMax >= innerRadius - 1e-5) continue;
      const overlap = Math.min((ringMax - ringMin) * .35, thickness * .35);
      const delta = innerRadius + overlap - ringMax;
      node.parameters.profile = profile.map((point) => ({ ...point, xMm: Number(point.xMm) > 1e-8 ? Number((Number(point.xMm) + delta).toFixed(6)) : point.xMm }));
      adjustments.push({ booleanNodeId: boolean.id, nodeId: node.id, source: "declared_boolean_union_inner_wall_anchor", innerRadiusMm: innerRadius, radialOverlapMm: overlap, shiftMm: delta });
    }
  }
  return adjustments;
}

/**
 * Convert a measured, coloured closure band into component-local B-Rep
 * dimensions and one parent-owned assembly placement.  The decision uses a
 * pattern feature and evidence metadata only: it deliberately has no Korean
 * or English component-name branch.  It is visual/dimensional evidence, not
 * a substitute for an approved thread or sealing tolerance.
 */
export function fitMeasuredClosureAssembly(graph, approvedDimensions = null, primaryMeasurement = null, bodyComponentId = null) {
  const overallHeight = Number(approvedDimensions?.heightMm);
  const cap = primaryMeasurement?.cap;
  const capRatio = Number(cap?.heightNorm);
  if (!Number.isFinite(overallHeight) || overallHeight <= 0 || !Number.isFinite(capRatio) || capRatio <= .04 || capRatio >= .6) {
    return { graph, applied: false, adjustments: [], reason: "cap_band_evidence_missing" };
  }
  const original = structuredClone(graph);
  const candidate = patternedRadialComponent(original);
  if (!candidate) return { graph, applied: false, adjustments: [], reason: "patterned_closure_not_found" };
  const closure = original.components.find((component) => component.id === candidate.component.id);
  if (hasUnanchoredExteriorFeature(original, closure.id)) {
    return { graph, applied: false, adjustments: [], reason: "closure_topology_requires_anchor_review" };
  }
  const closureRange = localAxialRange(original, closure);
  if (!closureRange || closureRange.max - closureRange.min <= 1e-6) return { graph, applied: false, adjustments: [], reason: "closure_height_unmeasurable" };
  const next = structuredClone(original);
  const nextClosure = next.components.find((component) => component.id === closure.id);
  const outline = fitClosureOutline(next, closure.id, cap, approvedDimensions);
  const annularAnchors = anchorUnionAnnularFeatures(next, closure.id);
  const targetClosureHeight = overallHeight * capRatio;
  const scale = targetClosureHeight / (closureRange.max - closureRange.min);
  for (const node of componentNodes(next, closure.id)) node.parameters = scaleAxialParameters(node.parameters, scale, closureRange.min);
  const scaledClosureRange = localAxialRange(next, nextClosure);
  const targetClosureZ = overallHeight - scaledClosureRange.max;
  const closureTransform = nextClosure.transform ?? {};
  nextClosure.transform = {
    ...closureTransform,
    translationMm: { ...(closureTransform.translationMm ?? {}), z: Number(targetClosureZ.toFixed(6)) },
  };

  const closureBottomZ = overallHeight - targetClosureHeight;
  const adjustments = [{
    componentId: closure.id, role: "patterned_closure", source: "primary_cap_band_measurement",
    sourceHeightMm: closureRange.max - closureRange.min, targetHeightMm: targetClosureHeight,
    assemblyZMm: targetClosureZ, scale,
  }];
  if (outline) adjustments.unshift({ componentId: closure.id, role: "patterned_closure_outline", ...outline });
  if (annularAnchors.length) adjustments.push(...annularAnchors.map((item) => ({ componentId: closure.id, role: "declared_union_annular_feature", ...item })));
  // A centred annular child which is neither the primary body nor the
  // patterned closure is a candidate insert/ring.  Preserve its local B-Rep
  // and place it at the measured closure-bottom datum. Small liners and
  // off-axis parts are intentionally left untouched.
  const targetRadius = Math.min(Number(approvedDimensions?.widthMm), Number(approvedDimensions?.depthMm)) / 2;
  const primarySilhouette = Array.isArray(primaryMeasurement?.silhouette) ? primaryMeasurement.silhouette : [];
  const nodes = new Map(next.nodes.map((node) => [node.id, node]));
  for (const component of next.components) {
    if (component.id === closure.id || component.id === bodyComponentId || component.representation !== "brep_solid") continue;
    const current = component.transform?.translationMm ?? {};
    if (Math.abs(Number(current.x ?? 0)) > 1e-6 || Math.abs(Number(current.y ?? 0)) > 1e-6) continue;
    const range = localAxialRange(next, component);
    const radius = Math.max(...component.rootNodeIds.map((id) => radialEnvelopeForNode(nodes, id, new Map())).filter(Number.isFinite));
    const currentZ = Number(current.z ?? 0);
    const globalMin = currentZ + (range?.min ?? 0), globalMax = currentZ + (range?.max ?? 0);
    const overlapsClosureBand = globalMax >= closureBottomZ - 1e-6 && globalMin <= overallHeight + 1e-6;
    if (!range || !Number.isFinite(radius) || !(radius >= targetRadius * .7 && radius <= targetRadius * 1.05) || range.max - range.min > targetClosureHeight || !overlapsClosureBand) continue;
    // A zero Z placement is an unplaced local insert; otherwise preserve the
    // user/graph-approved datum and only fit its measured exterior.
    const assemblyZMm = Math.abs(currentZ) <= 1e-6 ? closureBottomZ - range.min : currentZ;
    component.transform = { ...(component.transform ?? {}), translationMm: { ...current, z: Number(assemblyZMm.toFixed(6)) } };
    // A separate centred annular part (ring/liner/insert) belongs to the
    // closure datum, not automatically to the product's widest body
    // diameter. Its actual exterior is observable at that assembly ordinate.
    // This is intentionally topology- and placement-based: display names do
    // not decide whether a part is fitted.
    const zNorm = (assemblyZMm + (range.min + range.max) / 2) / overallHeight;
    const measuredRadius = primarySilhouette.length >= 12 ? interpolate(primarySilhouette, zNorm) * targetRadius : null;
    let radialScale = null;
    if (Number.isFinite(measuredRadius) && measuredRadius > targetRadius * .4 && Math.abs(measuredRadius - radius) > .05) {
      radialScale = measuredRadius / radius;
      for (const node of componentNodes(next, component.id)) node.parameters = scaleRadialParameters(node.parameters, radialScale);
    }
    adjustments.push({ componentId: component.id, role: "centred_annular_insert", source: "primary_cap_band_datum", assemblyZMm, measuredRadiusMm: measuredRadius, radialScale });
  }
  return { graph: next, applied: true, closureBottomZMm: closureBottomZ, closureHeightMm: targetClosureHeight, adjustments };
}

/** Align a patterned closure to the approved assembly top from the B-Rep that
 * OCCT actually compiled. Curve segments, shelling, and Boolean topology can
 * make its exact local extent differ slightly from the graph's conservative
 * feature envelope. The XDE placement must follow the compiled child rather
 * than pretending that the graph estimate is the physical datum. */
export function fitCompiledClosureDatum(graph, preflight, approvedDimensions = null) {
  const targetHeight = Number(approvedDimensions?.heightMm);
  const candidate = patternedRadialComponent(graph);
  if (!candidate || !Number.isFinite(targetHeight) || targetHeight <= 0) return { graph, applied: false, adjustments: [] };
  const diagnostic = (preflight?.diagnostics ?? []).find((item) => item.componentId === candidate.component.id && item.code === "ok");
  const compiledHeight = Number(diagnostic?.boundsMm?.z);
  if (!Number.isFinite(compiledHeight) || compiledHeight <= 0 || compiledHeight > targetHeight + 1e-6) return { graph, applied: false, adjustments: [] };
  const current = Number(candidate.component.transform?.translationMm?.z ?? 0);
  const targetZ = targetHeight - compiledHeight;
  if (Math.abs(current - targetZ) <= 1e-5) return { graph, applied: false, adjustments: [] };
  const next = structuredClone(graph); const closure = next.components.find((component) => component.id === candidate.component.id);
  const transform = closure.transform ?? {}; const translation = transform.translationMm ?? {};
  closure.transform = { ...transform, translationMm: { ...translation, z: Number(targetZ.toFixed(6)) } };
  return {
    graph: next, applied: true,
    adjustments: [{ componentId: closure.id, source: "compiled_brep_top_datum", previousZMm: current, targetZMm: targetZ, compiledHeightMm: compiledHeight, assemblyTopMm: targetHeight }],
  };
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
    // Some graphs encode the rib seed explicitly while others use a
    // primitive+transform seed. The radial pattern is the stable feature
    // contract in both cases; tying this to a display name or an optional rib
    // node silently discarded valid image evidence.
    const patternedRadialFeature = componentNodes.some((node) => node.operation === "pattern" && node.inputNodeIds.length >= 1);
    const measuredTargetRadius = patternedRadialFeature && Number.isFinite(measuredCapRatio) && measuredCapRatio > .25
      ? Math.min(targetRadius, targetRadius * measuredCapRatio)
      : targetRadius;
    const outsideMaximum = envelope > targetRadius + 1e-6;
    const measuredMismatch = patternedRadialFeature && Math.abs(envelope - measuredTargetRadius) > .25;
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
  if (hasUnanchoredExteriorFeature(graph, target.componentId, target.id)) {
    return { graph, applied: false, reason: "component_topology_requires_anchor_review" };
  }
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
  // The measured body contour begins below a separately measured opaque
  // closure band. Fitting that visible contour across the *whole* approved
  // assembly height stretches shoulders and heels into the hidden neck, which
  // produces a smooth but visibly wrong product. Fit only the visible span.
  // The existing approved tail is retained as explicitly inferred, hidden
  // geometry so the child B-Rep remains full-height and its physical neck is
  // not silently discarded. This rule relies on measured closure evidence and
  // radial pattern topology, never on a component name.
  const closure = patternedRadialComponent(graph);
  const capRatio = Number(measured.cap?.heightNorm);
  const canReserveClosure = Boolean(closure) && Number.isFinite(capRatio) && capRatio > .04 && capRatio < .6 && Number.isFinite(targetHeightMm) && targetHeightMm > 0;
  const bodyTargetHeight = canReserveClosure ? targetHeightMm * (1 - capRatio) : targetHeightMm;
  const zMin = Number.isFinite(bodyTargetHeight) && bodyTargetHeight > 0 ? 0 : sourceZMin;
  const zMax = Number.isFinite(bodyTargetHeight) && bodyTargetHeight > 0 ? bodyTargetHeight : sourceZMax;
  const maxRadius = Number.isFinite(targetWidthMm) && targetWidthMm > 0 ? targetWidthMm / 2 : sourceMaxRadius;
  const rows = measured.bodySilhouette.filter((item) => item.zNorm >= 0 && item.zNorm <= 1).sort((left, right) => left.zNorm - right.zNorm);
  // Keep the measured rows.  OCCT receives a smooth spline through these
  // samples; reducing them to a handful of points was the source of visible
  // shoulder/heel flattening and exceeded the 0.35 mm contour gate.
  // The graph accepts up to 64 curve segments, so retain every measured row
  // from the worker's 64-sample contour. Earlier downsampling to 40 discarded
  // precisely the bottle heel/neck landmarks that carry the strongest visual
  // evidence, inflating the calibrated RMS despite having the measurements.
  const compact = rows.length <= 64 ? rows : Array.from({ length: 64 }, (_, index) => rows[Math.round(index * (rows.length - 1) / 63)]);
  const observedOuter = compact.map((item) => ({ xMm: Number((Math.max(0.01, item.radiusNorm * maxRadius)).toFixed(5)), yMm: 0, zMm: Number((zMin + item.zNorm * (zMax - zMin)).toFixed(5)) }));
  const inferredTail = [];
  if (canReserveClosure && targetHeightMm > zMax + 1e-6 && sourceZMax > sourceZMin + 1e-6) {
    const sourceVisibleZ = sourceZMin + (sourceZMax - sourceZMin) * (zMax - zMin) / targetHeightMm;
    const sourceVisibleRadius = radiusFromProfile(source, sourceVisibleZ);
    const boundaryRadius = observedOuter.at(-1)?.xMm ?? maxRadius;
    const tailScale = Number.isFinite(sourceVisibleRadius) && sourceVisibleRadius > 1e-8 ? boundaryRadius / sourceVisibleRadius : 1;
    for (const point of source.filter((item) => Number(item.xMm) > 1e-8 && Number(item.zMm) > sourceVisibleZ + 1e-6).sort((left, right) => Number(left.zMm) - Number(right.zMm))) {
      const ratio = (Number(point.zMm) - sourceVisibleZ) / Math.max(1e-9, sourceZMax - sourceVisibleZ);
      inferredTail.push({
        xMm: Number((Math.max(.01, Number(point.xMm) * tailScale)).toFixed(5)), yMm: 0,
        zMm: Number((zMax + ratio * (targetHeightMm - zMax)).toFixed(5)),
      });
    }
  }
  const outer = [...observedOuter, ...inferredTail];
  const outerMaxZ = canReserveClosure ? targetHeightMm : zMax;
  const fitted = [{ xMm: 0, yMm: 0, zMm: zMin }, ...outer, { xMm: 0, yMm: 0, zMm: outerMaxZ }];
  const next = structuredClone(graph); const node = next.nodes.find((item) => item.id === target.id);
  node.parameters.profile = fitted;
  // Keep the axis-closing edges explicit in ``profile`` and declare only the
  // observed outer contour as a NURBS. The OCCT compiler joins those approved
  // straight edges to this curve, so no polygon mesh or LLM-invented control
  // point becomes the manufacturing source.
  // ``curveSegments`` is the exact curve the OCCT worker consumes and its
  // strict graph contract permits 64 segments (65 poles).  The visible
  // silhouette and the inferred neck tail can together exceed that count.
  // Allocate knots to both regions deterministically instead of serialising
  // an unbuildable 79-segment curve or dropping the hidden connection.
  const curvePoles = outer.length <= 65 ? outer : (() => {
    const visibleSlots = Math.max(2, Math.min(observedOuter.length, 56));
    const tailSlots = Math.max(1, 65 - visibleSlots);
    const sample = (points, count) => points.length <= count ? points : Array.from({ length: count }, (_, index) => points[Math.round(index * (points.length - 1) / Math.max(1, count - 1))]);
    return [...sample(observedOuter, visibleSlots), ...sample(inferredTail, tailSlots)];
  })();
  const poles = curvePoles.map(({ xMm, zMm }) => ({ xMm, zMm }));
  // The static OCCT compiler preserves this declared exterior curve, then
  // derives an explicit inner revolve and Boolean cavity from the approved
  // wall thickness. This keeps the visible C1 Bézier exterior and the
  // base/mouth datum while avoiding a polygon or primitive substitute.
  node.parameters.curveSegments = monotoneBezierSegments(poles);
  return {
    graph: next,
    applied: true,
    nodeId: target.id,
    measurement: measured,
    calibration: {
      sourceHeightMm: sourceZMax - sourceZMin,
      sourceDiameterMm: sourceMaxRadius * 2,
      targetHeightMm: outerMaxZ - zMin,
      visibleBodyHeightMm: zMax - zMin,
      hiddenNeckHeightMm: canReserveClosure ? outerMaxZ - zMax : 0,
      hiddenNeckSource: canReserveClosure ? "existing_approved_graph_tail" : null,
      assemblyHeightMm: Number.isFinite(targetHeightMm) && targetHeightMm > 0 ? targetHeightMm : null,
      capBandReservedMm: closure && Number.isFinite(capRatio) ? targetHeightMm * capRatio : null,
      targetDiameterMm: maxRadius * 2,
      source: Number.isFinite(targetHeightMm) && targetHeightMm > 0 && Number.isFinite(targetWidthMm) && targetWidthMm > 0 ? "approved_dimensions" : "graph_extent",
    },
    curveCompilation: "monotone_bezier_with_occt_native_shell_offset",
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
  return { iou: union > 0 ? intersection / union : 0, rmsMm, hausdorff95Mm, sampleCount: diffs.length, imageId: measured.imageId, source: "graph_profile" };
}

/** Compare the *compiled OCCT B-Rep* exterior against the same calibrated
 * primary-image evidence. This is deliberately separate from the graph
 * profile metric: booleans, shells, and compiler changes may alter a solid
 * after fitting, and only a persisted B-Rep tessellation can expose that.
 */
export function compareBrepAxisymmetricContour(preflight, evidence, primaryImageId = null) {
  const measured = evidence?.images?.find((item) => item.ok && item.measurement?.imageId === primaryImageId && item.measurement?.bodySilhouette?.length >= 12)?.measurement;
  const candidates = (preflight?.diagnostics ?? []).filter((item) => Array.isArray(item.silhouette) && item.silhouette.length >= 12 && Number(item.boundsMm?.z ?? 0) > 0);
  if (!measured || !candidates.length) return null;
  // The tallest component is selected by geometry, rather than by its Korean
  // or English name. For an axisymmetric product this is the only component
  // whose outer silhouette can be calibrated against the vessel body image.
  const candidate = [...candidates].sort((left, right) => Number(right.boundsMm?.z ?? 0) - Number(left.boundsMm?.z ?? 0))[0];
  const samples = candidate.silhouette; const diffs = measured.bodySilhouette.map((item) => Math.abs(interpolate(samples, item.zNorm) - item.radiusNorm));
  const radiusMm = Number(candidate.boundsMm?.x ?? 0) / 2;
  const rmsMm = Math.sqrt(diffs.reduce((sum, item) => sum + item ** 2, 0) / diffs.length) * radiusMm;
  const sorted = [...diffs].sort((left, right) => left - right); const hausdorff95Mm = sorted[Math.floor((sorted.length - 1) * .95)] * radiusMm;
  const graphArea = measured.bodySilhouette.reduce((sum, item) => sum + interpolate(samples, item.zNorm), 0); const targetArea = measured.bodySilhouette.reduce((sum, item) => sum + item.radiusNorm, 0); const intersection = measured.bodySilhouette.reduce((sum, item) => sum + Math.min(interpolate(samples, item.zNorm), item.radiusNorm), 0); const union = graphArea + targetArea - intersection;
  return { iou: union > 0 ? intersection / union : 0, rmsMm, hausdorff95Mm, sampleCount: diffs.length, imageId: measured.imageId, source: "occt_brep_tessellation", componentId: candidate.componentId };
}

/** Compare the full B-Rep assembly envelope, including graph-approved child
 * transforms, against the primary product silhouette.  This catches the
 * historical failure where a valid cap existed but was assembled at z=0.
 */
export function compareBrepAssemblyContour(preflight, evidence, primaryImageId = null) {
  const measured = evidence?.images?.find((item) => item.ok && item.measurement?.imageId === primaryImageId && item.measurement?.silhouette?.length >= 12)?.measurement;
  const components = (preflight?.diagnostics ?? []).filter((item) => Array.isArray(item.silhouette) && item.silhouette.length >= 4 && Number(item.boundsMm?.z ?? 0) > 0);
  if (!measured || !components.length) return null;
  const placed = components.map((component) => {
    const z = Number(component.transform?.translationMm?.z ?? 0); const height = Number(component.boundsMm.z); const radius = Number(component.boundsMm.x ?? 0) / 2;
    return { ...component, zMin: z, zMax: z + height, radius };
  });
  const zMin = Math.min(...placed.map((item) => item.zMin)); const zMax = Math.max(...placed.map((item) => item.zMax)); const maxRadius = Math.max(...placed.map((item) => item.radius));
  if (!(zMax > zMin) || !(maxRadius > 0)) return null;
  const assemblySamples = Array.from({ length: 128 }, (_, index) => {
    const z = zMin + (zMax - zMin) * index / 127;
    const occupying = placed.filter((component) => z >= component.zMin - 1e-6 && z <= component.zMax + 1e-6);
    // In a photograph, an opaque closure masks a transparent vessel neck in
    // the same depth interval. A raw Boolean-union envelope would expose the
    // hidden neck as a false exterior error. This is a material-aware front
    // orthographic visibility approximation; a full renderer remains the
    // final visual-review path, while manufacturing B-Reps stay unchanged.
    const opaque = occupying.filter((component) => Number(component.material?.transmission ?? 0) < .5 && Number(component.material?.opacity ?? 1) > .05);
    const visible = opaque.length ? opaque : occupying;
    const radius = Math.max(0, ...visible.map((component) => interpolate(component.silhouette, (z - component.zMin) / Math.max(1e-9, component.zMax - component.zMin)) * component.radius));
    return { zNorm: index / 127, radiusNorm: radius / maxRadius };
  });
  const diffs = measured.silhouette.map((item) => Math.abs(interpolate(assemblySamples, item.zNorm) - item.radiusNorm));
  const rmsMm = Math.sqrt(diffs.reduce((sum, item) => sum + item ** 2, 0) / diffs.length) * maxRadius;
  const sorted = [...diffs].sort((left, right) => left - right); const hausdorff95Mm = sorted[Math.floor((sorted.length - 1) * .95)] * maxRadius;
  const modelArea = measured.silhouette.reduce((sum, item) => sum + interpolate(assemblySamples, item.zNorm), 0); const targetArea = measured.silhouette.reduce((sum, item) => sum + item.radiusNorm, 0); const intersection = measured.silhouette.reduce((sum, item) => sum + Math.min(interpolate(assemblySamples, item.zNorm), item.radiusNorm), 0); const union = modelArea + targetArea - intersection;
  // Keep the individual, calibrated residuals with the gate result.  The
  // optimiser and the product dossier need to identify an actual region of
  // the compiled B-Rep to improve; an aggregate score alone encourages
  // opaque, product-specific nudges.  These values are derived only from the
  // same normalized target contour and OCCT tessellation used above.
  const worstSamples = measured.silhouette.map((target, index) => {
    const modelRadiusNorm = interpolate(assemblySamples, target.zNorm);
    return {
      zNorm: Number(target.zNorm.toFixed(6)),
      targetRadiusNorm: Number(target.radiusNorm.toFixed(6)),
      modelRadiusNorm: Number(modelRadiusNorm.toFixed(6)),
      residualMm: Number(((modelRadiusNorm - target.radiusNorm) * maxRadius).toFixed(6)),
    };
  }).sort((left, right) => Math.abs(right.residualMm) - Math.abs(left.residualMm)).slice(0, 12);
  return { iou: union > 0 ? intersection / union : 0, rmsMm, hausdorff95Mm, sampleCount: diffs.length, imageId: measured.imageId, source: "occt_brep_assembly_tessellation", componentIds: placed.map((item) => item.componentId), worstSamples };
}

/**
 * Feed the compiled OCCT exterior back into an axisymmetric graph without
 * inventing topology.  This is deliberately a small, bounded correction:
 * only an existing outer revolve may move, only where that component is the
 * front-most material at a measured section, and each control ordinate moves
 * by at most six percent per iteration.  The caller must recompile OCCT and
 * may reject the result; this function never treats its graph edit as proof.
 */
export function fitCompiledAssemblyContour(graph, preflight, evidence, primaryImageId = null, { gain = .5, maxScaleStep = .06, minimumResidualMm = .12 } = {}) {
  const measured = evidence?.images?.find((item) => item.ok && item.measurement?.imageId === primaryImageId && item.measurement?.silhouette?.length >= 12)?.measurement;
  const diagnostics = (preflight?.diagnostics ?? []).filter((item) => item.code === "ok" && Array.isArray(item.silhouette) && item.silhouette.length >= 12 && Number(item.boundsMm?.z ?? 0) > 0 && Number(item.boundsMm?.x ?? 0) > 0);
  if (!measured || !diagnostics.length) return { graph, applied: false, adjustments: [], reason: "compiled_contour_unavailable" };
  const placed = diagnostics.map((diagnostic) => {
    const z = Number(diagnostic.transform?.translationMm?.z ?? 0); const height = Number(diagnostic.boundsMm.z); const radius = Number(diagnostic.boundsMm.x) / 2;
    return { ...diagnostic, zMin: z, zMax: z + height, radius };
  });
  const zMin = Math.min(...placed.map((item) => item.zMin)); const zMax = Math.max(...placed.map((item) => item.zMax)); const maxRadius = Math.max(...placed.map((item) => item.radius));
  if (!(zMax > zMin) || !(maxRadius > 0)) return { graph, applied: false, adjustments: [], reason: "compiled_contour_degenerate" };
  const targetRadiusAt = (globalZ) => interpolate(measured.silhouette, (globalZ - zMin) / Math.max(1e-9, zMax - zMin)) * maxRadius;
  const visibleAt = (globalZ) => {
    const active = placed.filter((item) => globalZ >= item.zMin - 1e-6 && globalZ <= item.zMax + 1e-6);
    const opaque = active.filter((item) => Number(item.material?.transmission ?? 0) < .5 && Number(item.material?.opacity ?? 1) > .05);
    return (opaque.length ? opaque : active).sort((left, right) => {
      const leftRadius = interpolate(left.silhouette, (globalZ - left.zMin) / Math.max(1e-9, left.zMax - left.zMin)) * left.radius;
      const rightRadius = interpolate(right.silhouette, (globalZ - right.zMin) / Math.max(1e-9, right.zMax - right.zMin)) * right.radius;
      return rightRadius - leftRadius;
    })[0] ?? null;
  };
  // The primary full-product silhouette supplies one exterior envelope; it
  // cannot safely attribute a hidden liner or a narrow annular ring to a
  // specific contour row. Those parts have their own measured feature/crop
  // fits. Use this global residual only for the largest eligible B-Rep body,
  // rather than distorting every overlapping component to chase the same
  // pixel. This is a geometry/evidence rule, not a product-name heuristic.
  const primaryBodyId = [...placed].sort((left, right) => (right.zMax - right.zMin) - (left.zMax - left.zMin))[0]?.componentId ?? null;
  const next = structuredClone(graph); const diagnosticsById = new Map(placed.map((item) => [item.componentId, item])); const adjustments = [];
  for (const component of next.components.filter((item) => item.representation === "brep_solid" && item.id === primaryBodyId)) {
    const diagnostic = diagnosticsById.get(component.id); const node = outerRevolveNode(next, component.id);
    if (!diagnostic || !node) continue;
    const profile = node.parameters?.profile ?? []; const localHeight = Number(diagnostic.boundsMm.z);
    const placementZ = Number(component.transform?.translationMm?.z ?? 0);
    const nextProfile = profile.map((point) => {
      const radius = Math.abs(Number(point.xMm)); if (!(radius > 1e-7)) return point;
      const globalZ = placementZ + Number(point.zMm);
      if (visibleAt(globalZ)?.componentId !== component.id) return point;
      const localNorm = (Number(point.zMm) - Math.min(...profile.map((item) => Number(item.zMm)))) / Math.max(1e-9, localHeight);
      const compiledRadius = interpolate(diagnostic.silhouette, Math.max(0, Math.min(1, localNorm))) * diagnostic.radius;
      const targetRadius = targetRadiusAt(globalZ); const residual = targetRadius - compiledRadius;
      if (!Number.isFinite(targetRadius) || !(compiledRadius > 1e-6) || Math.abs(residual) < minimumResidualMm) return point;
      const scale = Math.max(1 - maxScaleStep, Math.min(1 + maxScaleStep, 1 + gain * residual / compiledRadius));
      return { ...point, xMm: Number((Number(point.xMm) * scale).toFixed(6)) };
    });
    if (!nextProfile.some((point, index) => Math.abs(Number(point.xMm) - Number(profile[index].xMm)) > 1e-8)) continue;
    node.parameters.profile = nextProfile;
    // A Boolean helper profile can have two radial points on the same axial
    // datum. It remains a valid closed revolve wire, but cannot be presented
    // as a monotonic exterior Bézier chain. Keep that approved profile and
    // only regenerate curve metadata when a strictly ordered exterior exists.
    const exterior = nextProfile.filter((point) => Math.abs(Number(point.xMm)) > 1e-7).map(({ xMm, zMm }) => ({ xMm, zMm }))
      .sort((left, right) => Number(left.zMm) - Number(right.zMm)).filter((point, index, all) => index === 0 || Number(point.zMm) > Number(all[index - 1].zMm) + 1e-8);
    const radialScaleAt = (zMm) => {
      const previousRadius = radiusFromProfile(profile, zMm);
      const nextRadius = radiusFromProfile(nextProfile, zMm);
      return previousRadius > 1e-8 && Number.isFinite(nextRadius) ? nextRadius / previousRadius : 1;
    };
    const declaredCurves = Array.isArray(node.parameters.curveSegments) ? node.parameters.curveSegments : [];
    const canPreserveDeclaredCurves = declaredCurves.length > 0 && declaredCurves.every((segment) => Array.isArray(segment.poles) || Array.isArray(segment.points));
    if (canPreserveDeclaredCurves) {
      // A graph may declare rational NURBS with non-uniform knots and weights.
      // Replacing it with an interpolated Bézier chain after every residual
      // adjustment changes the CAD topology and can amplify a small correction
      // into a shoulder/heel defect.  Retain the exact declared curve family
      // and modify only its radial control ordinates by the measured profile
      // ratio. The compiler therefore receives the same curve representation
      // that the approval graph and previous B-Rep used.
      node.parameters.curveSegments = declaredCurves.map((segment) => {
        const key = Array.isArray(segment.poles) ? "poles" : "points";
        return { ...segment, [key]: segment[key].map((point) => ({ ...point, xMm: Number((Number(point.xMm) * radialScaleAt(Number(point.zMm))).toFixed(6)) })) };
      });
    } else {
      // A legacy profile without an explicit curve remains convertible, but
      // the bounded conversion is a one-time compatibility path—not a
      // replacement for an approved rational curve.
      const curveInput = exterior.length <= 65 ? exterior : Array.from({ length: 65 }, (_, index) => exterior[Math.round(index * (exterior.length - 1) / 64)]);
      if (curveInput.length >= 2) node.parameters.curveSegments = monotoneBezierSegments(curveInput);
    }
    const changed = nextProfile.reduce((count, point, index) => count + (Math.abs(Number(point.xMm) - Number(profile[index].xMm)) > 1e-8 ? 1 : 0), 0);
    adjustments.push({ componentId: component.id, nodeId: node.id, source: "compiled_occt_assembly_contour", changedControlPoints: changed, gain, maxScaleStep, minimumResidualMm });
  }
  return { graph: next, applied: adjustments.length > 0, adjustments, source: "occt_brep_assembly_tessellation" };
}
