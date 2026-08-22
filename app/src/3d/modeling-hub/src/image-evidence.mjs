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
    // A direct pattern seed is not an independent exterior: its local
    // parameters are rescaled with the same component and its generated
    // instances remain graph-connected to the terminal Boolean. Treating it
    // as detached incorrectly skipped curve fitting for ordinary ribbed caps.
    // Only a separately unioned sweep can remain physically unanchored after
    // the host profile moves.
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

function componentAssemblyZ(component) {
  return Number(component.transform?.translationMm?.z ?? 0);
}

function profileRadiusAt(profile, zMm) {
  const radial = (profile ?? []).filter((point) => Math.abs(Number(point.xMm)) > 1e-7)
    .map((point) => ({ zMm: Number(point.zMm), radiusMm: Math.abs(Number(point.xMm)) }))
    .filter((point) => Number.isFinite(point.zMm) && Number.isFinite(point.radiusMm))
    .sort((left, right) => left.zMm - right.zMm);
  if (radial.length < 2 || zMm < radial[0].zMm - 1e-6 || zMm > radial.at(-1).zMm + 1e-6) return null;
  for (let index = 1; index < radial.length; index += 1) {
    const before = radial[index - 1], after = radial[index];
    if (zMm > after.zMm + 1e-6) continue;
    const denominator = after.zMm - before.zMm;
    return denominator <= 1e-8 ? Math.max(before.radiusMm, after.radiusMm) : before.radiusMm + (after.radiusMm - before.radiusMm) * ((zMm - before.zMm) / denominator);
  }
  return radial.at(-1).radiusMm;
}

function radialProfileNode(graph, component) {
  return componentNodes(graph, component.id)
    .filter((node) => node.operation === "revolve" && Array.isArray(node.parameters?.profile) && node.parameters.profile.length >= 4)
    .map((node) => ({ node, radius: Math.max(...node.parameters.profile.map((point) => Math.abs(Number(point.xMm ?? 0)))) }))
    .sort((left, right) => right.radius - left.radius)[0]?.node ?? null;
}

/**
 * A helical/curved detail that is explicitly Boolean-unioned to a revolved
 * host is not an unrelated visual flourish: its radial path is authored
 * relative to that host's surface.  When a measured neck curve changes, keep
 * the detail's *measured offset* and polar angle, then place it on the new
 * OCCT host radius.  This preserves the same declarative sweep topology and
 * prevents the old failure where fitting the hidden neck had to be abandoned
 * because an already-unioned thread path would be left floating.
 *
 * The function intentionally declines arbitrary sweeps: only a direct
 * union with this component's target revolve/shell is attachable.  Other
 * topology still becomes an evidence/review requirement instead of an
 * invented bridge.
 */
function reanchorUnionSweepPaths(beforeGraph, nextGraph, componentId, targetNodeId) {
  const beforeNodes = new Map(beforeGraph.nodes.map((node) => [node.id, node]));
  const nextNodes = new Map(nextGraph.nodes.map((node) => [node.id, node]));
  const beforeTarget = beforeNodes.get(targetNodeId);
  const nextTarget = nextNodes.get(targetNodeId);
  const adjustments = []; const unresolved = [];
  if (!beforeTarget?.parameters?.profile || !nextTarget?.parameters?.profile) return { adjustments, unresolved };
  const hostIds = new Set([targetNodeId]);
  for (const node of beforeGraph.nodes.filter((node) => node.componentId === componentId && node.operation === "shell" && node.inputNodeIds.includes(targetNodeId))) hostIds.add(node.id);
  const unions = beforeGraph.nodes.filter((node) => node.componentId === componentId && node.operation === "boolean" && node.parameters?.operation === "union");
  const unionSweepIds = new Set();
  for (const union of unions) {
    const hasHost = union.inputNodeIds.some((id) => hostIds.has(id));
    if (!hasHost) continue;
    for (const id of union.inputNodeIds) if (beforeNodes.get(id)?.operation === "sweep") unionSweepIds.add(id);
  }
  for (const sweep of beforeGraph.nodes.filter((node) => node.componentId === componentId && node.operation === "sweep" && !node.inputNodeIds.length)) {
    const nextSweep = nextNodes.get(sweep.id);
    const path = sweep.parameters?.path;
    if (!unionSweepIds.has(sweep.id)) {
      unresolved.push({ nodeId: sweep.id, reason: "unanchored_sweep_not_directly_unioned_to_fitted_host" });
      continue;
    }
    if (!nextSweep || !Array.isArray(path) || path.length < 2) {
      unresolved.push({ nodeId: sweep.id, reason: "sweep_path_missing" });
      continue;
    }
    const nextPath = []; let valid = true;
    for (const point of path) {
      const x = Number(point.xMm), y = Number(point.yMm), z = Number(point.zMm);
      const radial = Math.hypot(x, y);
      const beforeRadius = profileRadiusAt(beforeTarget.parameters.profile, z);
      const nextRadius = profileRadiusAt(nextTarget.parameters.profile, z);
      if (!(radial > 1e-8) || !Number.isFinite(beforeRadius) || !Number.isFinite(nextRadius)) { valid = false; break; }
      // A sweep that is explicitly unioned to a host must cross its exterior
      // by a bounded amount.  A legacy path can be wholly *inside* the host
      // (negative offset), which only appears connected until a new curve is
      // fitted and then produces an invalid coincident Boolean.  Preserve an
      // already-outward measured offset; otherwise use the sweep's own
      // approved section radius with 35% overlap. This is the same
      // feature-level contact rule used for a surface-attached rib, not a
      // component-name special case or a visual-only translation.
      const declaredSectionRadius = Number(sweep.parameters?.radiusMm);
      const minimumOutwardOffset = Number.isFinite(declaredSectionRadius) && declaredSectionRadius > 0 ? declaredSectionRadius * .65 : 0;
      const adjustedRadius = Math.max(.01, nextRadius + Math.max(radial - beforeRadius, minimumOutwardOffset));
      nextPath.push({ ...point, xMm: Number((x * adjustedRadius / radial).toFixed(6)), yMm: Number((y * adjustedRadius / radial).toFixed(6)), zMm: z });
    }
    if (!valid) {
      unresolved.push({ nodeId: sweep.id, reason: "sweep_path_outside_fitted_profile_range" });
      continue;
    }
    nextSweep.parameters = { ...nextSweep.parameters, path: nextPath };
    adjustments.push({ nodeId: sweep.id, hostNodeId: targetNodeId, source: "fitted_host_surface_radial_offset", pointCount: nextPath.length });
  }
  return { adjustments, unresolved };
}

function containedCylindricalCutter(graph, component) {
  const nodes = new Map(componentNodes(graph, component.id).map((node) => [node.id, node]));
  for (const root of component.rootNodeIds.map((id) => nodes.get(id)).filter(Boolean)) {
    if (root.operation !== "boolean" || root.parameters?.operation !== "cut") continue;
    const cutter = nodes.get(root.inputNodeIds.at(-1));
    if (cutter?.operation !== "primitive" || cutter.parameters?.primitive !== "cylinder") continue;
    const radiusMm = Number(cutter.parameters?.radiusMm);
    const heightMm = Number(cutter.parameters?.heightMm);
    const localZ = Number(cutter.parameters?.transform?.translationMm?.z ?? 0);
    if (radiusMm > 0 && heightMm > 0 && Number.isFinite(localZ)) return { node: cutter, radiusMm, heightMm, localZ };
  }
  return null;
}

/**
 * Enforce continuous, graph-native clearance for centred axisymmetric
 * assemblies before OCCT compilation. This is deliberately feature/topology
 * based (profiles, cylindrical cutter, declared interface), never a Korean or
 * English component-name lookup. It solves two measurable failures:
 *
 * - a declared mating component cannot have a cavity smaller than the
 *   companion's measured exterior plus the approved clearance;
 * - a separate annular part is resized at its declared inner radial boundary
 *   to preserve its assembly datum; an impossible wall thickness becomes an
 *   explicit review requirement rather than an invented placement.
 *
 * Off-axis geometry, non-cylindrical cavities and ambiguous containment are
 * left unchanged for explicit reviewer evidence rather than approximated.
 */
export function fitAxisymmetricAssemblyClearances(graph) {
  const next = structuredClone(graph);
  const components = new Map(next.components.filter((component) => component.representation === "brep_solid").map((component) => [component.id, component]));
  const adjustments = [];
  const unresolved = [];
  let geometryChanged = false;
  const clearanceFor = (leftId, rightId) => next.interfaces
    .filter((item) => item.componentIds.includes(leftId) && item.componentIds.includes(rightId))
    .map((item) => Number(item.clearanceMm ?? 0)).filter((value) => Number.isFinite(value) && value >= 0)
    .reduce((maximum, value) => Math.max(maximum, value), 0);

  // First make declared mates physically possible by sizing the receiving
  // cylindrical cavity against the other component's actual profile range.
  for (const relation of next.interfaces) {
    for (const hostId of relation.componentIds) {
      const host = components.get(hostId); const cavity = host ? containedCylindricalCutter(next, host) : null;
      if (!host || !cavity) continue;
      for (const guestId of relation.componentIds.filter((id) => id !== hostId)) {
        const guest = components.get(guestId); const guestProfile = guest ? radialProfileNode(next, guest) : null;
        if (!guest || !guestProfile) continue;
        const hostZ = componentAssemblyZ(host); const guestZ = componentAssemblyZ(guest);
        const hostRange = localAxialRange(next, host);
        // A lower-datum closure cavity must begin at the mating datum. A
        // positive start offset leaves a thin but solid bottom disk that
        // intersects the incoming neck before the cylindrical clearance even
        // begins. Preserve the existing roof thickness by extending only the
        // lower end of the cutter; this is an axial parameter correction, not
        // a Boolean shortcut or a change to the exterior curve.
        const guestAtHostDatum = hostRange ? profileRadiusAt(guestProfile.parameters.profile, hostZ + hostRange.min - guestZ) : null;
        if (hostRange && Number.isFinite(guestAtHostDatum) && cavity.localZ > hostRange.min + 1e-6) {
          const delta = cavity.localZ - hostRange.min;
          cavity.node.parameters.transform = {
            ...cavity.node.parameters.transform,
            translationMm: { ...cavity.node.parameters.transform.translationMm, z: Number(hostRange.min.toFixed(6)) },
          };
          cavity.node.parameters.heightMm = Number((cavity.heightMm + delta).toFixed(6));
          geometryChanged = true;
          adjustments.push({ type: "cavity_open_datum", componentId: hostId, nodeId: cavity.node.id, counterpartComponentId: guestId, previousStartZMm: cavity.localZ, targetStartZMm: Number(hostRange.min.toFixed(6)), previousHeightMm: cavity.heightMm, targetHeightMm: cavity.node.parameters.heightMm, source: "declared_interface+lower_mating_datum" });
          cavity.localZ = hostRange.min; cavity.heightMm = cavity.node.parameters.heightMm;
        }
        const start = hostZ + cavity.localZ; const end = start + cavity.heightMm;
        const samples = Array.from({ length: 17 }, (_, index) => start + (end - start) * index / 16)
          .map((worldZ) => profileRadiusAt(guestProfile.parameters.profile, worldZ - guestZ)).filter(Number.isFinite);
        if (!samples.length) continue;
        const requiredRadius = Math.max(...samples) + clearanceFor(hostId, guestId);
        if (cavity.radiusMm + 1e-6 >= requiredRadius) continue;
        cavity.node.parameters.radiusMm = Number(requiredRadius.toFixed(6));
        geometryChanged = true;
        adjustments.push({ type: "cavity_clearance", componentId: hostId, nodeId: cavity.node.id, counterpartComponentId: guestId, previousRadiusMm: cavity.radiusMm, requiredRadiusMm: Number(requiredRadius.toFixed(6)), clearanceMm: clearanceFor(hostId, guestId), source: "declared_interface+axisymmetric_profile" });
      }
    }
  }

  // Then keep independent annular layers from occupying material of a full
  // radial neighbour. We adjust only an existing lower layer upward/downward
  // relationship; no new shape or interface is invented.
  const solidProfiles = [...components.values()].map((component) => {
    const node = radialProfileNode(next, component); const range = localAxialRange(next, component);
    const radial = node?.parameters?.profile?.filter((point) => Math.abs(Number(point.xMm)) > 1e-7).map((point) => Math.abs(Number(point.xMm))) ?? [];
    const axisBound = Boolean(node?.parameters?.profile?.some((point) => Math.abs(Number(point.xMm)) <= 1e-7));
    const rootEnvelope = Math.max(...component.rootNodeIds.map((id) => radialEnvelopeForNode(new Map(next.nodes.map((item) => [item.id, item])), id, new Map())).filter(Number.isFinite));
    return { component, node, range, axisBound, radialMin: radial.length ? Math.min(...radial) : null, radialMax: radial.length ? Math.max(...radial) : null, rootEnvelope };
  }).filter((item) => item.node && item.range && Number.isFinite(item.radialMin) && Number.isFinite(item.radialMax));
  for (const annulus of solidProfiles.filter((item) => !item.axisBound && item.radialMin > 1e-5)) {
    const annulusZ = componentAssemblyZ(annulus.component); const annulusGlobal = { min: annulus.range.min + annulusZ, max: annulus.range.max + annulusZ };
    const candidate = solidProfiles
      .filter((other) => other.component.id !== annulus.component.id && other.axisBound)
      .map((other) => ({ other, global: { min: other.range.min + componentAssemblyZ(other.component), max: other.range.max + componentAssemblyZ(other.component) } }))
      .filter(({ other, global }) => annulusGlobal.min < global.max - 1e-6 && annulusGlobal.max > global.min + 1e-6 && annulus.radialMin < other.radialMax - 1e-6)
      .sort((left, right) => Math.abs(annulusGlobal.min - left.global.min) - Math.abs(annulusGlobal.min - right.global.min))[0];
    if (!candidate) continue;
    const clearance = clearanceFor(annulus.component.id, candidate.other.component.id);
    // An annular gasket, collar, or pouring ring is primarily a radial mate.
    // Translating it beyond the product removes a Boolean overlap but destroys
    // the intended assembly. First enlarge only its declared inner boundary
    // against the host's measured profile across the shared axial interval.
    // Axial separation remains a conservative fallback when the requested
    // clearance would consume the entire annular wall.
    const overlap = { min: Math.max(annulusGlobal.min, candidate.global.min), max: Math.min(annulusGlobal.max, candidate.global.max) };
    const hostSamples = Array.from({ length: 9 }, (_, index) => overlap.min + (overlap.max - overlap.min) * index / 8)
      .map((worldZ) => profileRadiusAt(candidate.other.node.parameters.profile, worldZ - componentAssemblyZ(candidate.other.component)))
      .filter(Number.isFinite);
    const requiredInnerRadius = hostSamples.length ? Math.max(...hostSamples) + clearance : null;
    // The candidate list is intentionally broad (its profile may flare at a
    // different height), so decide actual radial overlap from samples taken
    // in the common axial interval. A ring that already clears those samples
    // is a valid contact/clearance relationship and must not become a false
    // "unresolved" manufacturing warning.
    if (Number.isFinite(requiredInnerRadius) && annulus.radialMin >= requiredInnerRadius - 1e-6) continue;
    if (Number.isFinite(requiredInnerRadius) && requiredInnerRadius < annulus.radialMax - 1e-4 && requiredInnerRadius > annulus.radialMin + 1e-6) {
      const previousInnerRadius = annulus.radialMin;
      const adjustProfile = (profile) => (profile ?? []).map((point) => {
        if (Math.abs(Math.abs(Number(point.xMm)) - previousInnerRadius) > 1e-5) return point;
        return { ...point, xMm: Math.sign(Number(point.xMm) || 1) * Number(requiredInnerRadius.toFixed(6)) };
      });
      annulus.node.parameters.profile = adjustProfile(annulus.node.parameters.profile);
      annulus.node.parameters.curveSegments = (annulus.node.parameters.curveSegments ?? []).map((segment) => ({ ...segment, points: adjustProfile(segment.points) }));
      annulus.radialMin = Number(requiredInnerRadius.toFixed(6));
      geometryChanged = true;
      adjustments.push({ type: "annular_radial_clearance", componentId: annulus.component.id, counterpartComponentId: candidate.other.component.id, previousInnerRadiusMm: previousInnerRadius, requiredInnerRadiusMm: annulus.radialMin, outerRadiusMm: annulus.radialMax, clearanceMm: clearance, source: "axisymmetric_annulus_host_profile" });
      continue;
    }
    // Do not "solve" an impossible seal by moving it outside the assembly.
    // That would make the collision report green while producing a product
    // unrelated to the evidence. Keep the approved placement, preserve the
    // B-Rep for review, and carry a precise engineering question forward.
    unresolved.push({ type: "annular_clearance_requires_review", componentId: annulus.component.id, counterpartComponentId: candidate.other.component.id, innerRadiusMm: annulus.radialMin, outerRadiusMm: annulus.radialMax, requiredInnerRadiusMm: requiredInnerRadius, clearanceMm: clearance, source: "axisymmetric_annulus_host_profile" });
  }

  // A separate annular insert may be declared against the bottle/seal while
  // physically occupying the patterned closure's solid material. That is not
  // a permitted mating contact: there is no declared cap/insert interface and
  // OCCT reports positive volume overlap. Keep the insert's local B-Rep and
  // its actual bottle relation, but move its *assembly transform* down to the
  // closure lower datum with a 0.01 mm engineering separation. This applies
  // only to centred annuli which already have another explicit interface;
  // arbitrary rings are never repositioned merely to make a report green.
  for (const annulus of solidProfiles.filter((item) => !item.axisBound && item.radialMin > 1e-5)) {
    const annulusZ = componentAssemblyZ(annulus.component);
    const annulusGlobal = { min: annulus.range.min + annulusZ, max: annulus.range.max + annulusZ };
    const hasOtherContract = next.interfaces.some((item) => item.componentIds.includes(annulus.component.id) && item.componentIds.some((id) => id !== annulus.component.id));
    if (!hasOtherContract) continue;
    const blocker = solidProfiles
      .filter((other) => other.component.id !== annulus.component.id && other.axisBound && Number.isFinite(other.rootEnvelope) && annulus.radialMin < other.rootEnvelope - 1e-5)
      .map((other) => ({ other, global: { min: other.range.min + componentAssemblyZ(other.component), max: other.range.max + componentAssemblyZ(other.component) } }))
      .filter(({ other, global }) => !next.interfaces.some((item) => item.componentIds.includes(annulus.component.id) && item.componentIds.includes(other.component.id)) && annulusGlobal.min < global.max - 1e-6 && annulusGlobal.max > global.min + 1e-6)
      .sort((left, right) => left.global.min - right.global.min)[0];
    if (!blocker) continue;
    const clearanceMm = .01;
    const targetZ = blocker.global.min - clearanceMm - annulus.range.max;
    if (targetZ >= annulusZ - 1e-6) continue;
    const transform = annulus.component.transform ?? {}; const translation = transform.translationMm ?? {};
    annulus.component.transform = { ...transform, translationMm: { ...translation, z: Number(targetZ.toFixed(6)) } };
    geometryChanged = true;
    // The earlier radial pass may have encountered this same non-mated
    // closure before it knew an axial separation was possible. Once the
    // annulus is physically outside the closure's Z range, that radial
    // warning is no longer a manufacturing requirement. Keep unresolved
    // warnings for its actual declared host unchanged.
    for (let index = unresolved.length - 1; index >= 0; index -= 1) {
      const item = unresolved[index];
      if (item.componentId === annulus.component.id && item.counterpartComponentId === blocker.other.component.id) unresolved.splice(index, 1);
    }
    adjustments.push({ type: "annular_axial_noninterference", componentId: annulus.component.id, counterpartComponentId: blocker.other.component.id, previousAssemblyZMm: annulusZ, targetAssemblyZMm: Number(targetZ.toFixed(6)), clearanceMm, source: "declared_insert_contract+undeclared_closure_overlap" });
  }
  return { graph: next, applied: geometryChanged, adjustments, unresolved };
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
  // Foreground segmentation deliberately rejects anti-aliased edge pixels.
  // That can leave the first/last usable scanline a few percent inside a
  // physically flat cap face.  Closing the revolve directly from that row to
  // the axis turns a missing image row into a false cone.  Extend only a
  // small, bounded gap using the adjacent *measured* radius; a larger gap is
  // evidence_missing and remains visible to the reviewer rather than being
  // extrapolated as product geometry.
  const boundaryExtensions = [];
  const boundaryGapLimit = .05;
  if (compact[0].zNorm > 1e-7 && compact[0].zNorm <= boundaryGapLimit) {
    boundaryExtensions.push({ boundary: "min", fromZNorm: compact[0].zNorm, toZNorm: 0, radiusNorm: compact[0].radiusNorm, source: "segmentation_edge_continuation" });
    compact.unshift({ ...compact[0], zNorm: 0 });
  }
  if (compact.at(-1).zNorm < 1 - 1e-7 && compact.at(-1).zNorm >= 1 - boundaryGapLimit) {
    const last = compact.at(-1);
    boundaryExtensions.push({ boundary: "max", fromZNorm: last.zNorm, toZNorm: 1, radiusNorm: last.radiusNorm, source: "segmentation_edge_continuation" });
    compact.push({ ...last, zNorm: 1 });
  }
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
  const cavityCutAnchors = [];
  const visible = outer.map((point) => ({ xMm: point.xMm, zMm: point.zMm }));
  const radiusAt = (zMm) => interpolate(visible.map((point) => ({ zNorm: (point.zMm - range.min) / Math.max(1e-9, range.max - range.min), radiusNorm: point.xMm / targetRadius })), (zMm - range.min) / Math.max(1e-9, range.max - range.min)) * targetRadius;
  for (const pattern of componentNodes(graph, componentId).filter((node) => node.operation === "pattern" && node.inputNodeIds.length >= 1)) {
    const seed = byId.get(pattern.inputNodeIds.at(-1));
    const hostNodeId = pattern.inputNodeIds[0] ?? null;
    /* A legacy planner can declare one rectangular ``extrude`` and repeat it
     * radially.  That is an explicit rib topology, but an extrusion has a
     * constant radial section and cannot follow a newly fitted taper.  Keep
     * the user's measured width, height and count while normalising this DAG
     * shape into the compiler's surface-attached rib feature.  This is not a
     * component-name rule and does not invent a substitute primitive: it
     * preserves the original base + seed + pattern relationship so OCCT can
     * fuse every repeated protrusion to the fitted host B-Rep.
     */
    if (seed?.operation === "extrude" && !seed.inputNodeIds.length && hostNodeId) {
      const profile = seed.parameters?.profile ?? [];
      const radial = profile.map((point) => Number(point.xMm)).filter(Number.isFinite);
      const tangential = profile.map((point) => Number(point.yMm)).filter(Number.isFinite);
      const ordinates = profile.map((point) => Number(point.zMm)).filter(Number.isFinite);
      const radialWidth = radial.length ? Math.max(...radial) - Math.min(...radial) : NaN;
      const tangentialWidth = tangential.length ? Math.max(...tangential) - Math.min(...tangential) : NaN;
      const baseZ = ordinates.length ? Math.min(...ordinates) : 0;
      const height = Number(seed.parameters?.heightMm);
      if (Number.isFinite(radialWidth) && radialWidth > .01 && Number.isFinite(tangentialWidth) && tangentialWidth > .01 && Number.isFinite(height) && height > .01 && Number.isFinite(baseZ)) {
        const surfaceRadius = radiusAt(baseZ);
        const inheritedTransform = seed.parameters?.transform ?? {};
        seed.operation = "rib";
        seed.inputNodeIds = [hostNodeId];
        seed.parameters = {
          ...seed.parameters,
          primitive: null,
          profile: null,
          path: null,
          curveSegments: null,
          profiles: null,
          dimensionsMm: null,
          radiusMm: Number(surfaceRadius.toFixed(6)),
          innerRadiusMm: null,
          heightMm: Number(height.toFixed(6)),
          thicknessMm: null,
          count: null,
          spacingMm: Number(tangentialWidth.toFixed(6)),
          depthMm: Number(radialWidth.toFixed(6)),
          cavityOpenAt: null,
          offsetMm: null,
          operation: null,
          axis: "z",
          transform: {
            ...inheritedTransform,
            translationMm: { ...(inheritedTransform.translationMm ?? {}), x: 0, y: 0, z: Number(baseZ.toFixed(6)) },
            rotationDeg: inheritedTransform.rotationDeg ?? { x: 0, y: 0, z: 0 },
            scale: inheritedTransform.scale ?? { x: 1, y: 1, z: 1 },
          },
        };
        seed.rationale = `${seed.rationale} (직접 압출 방사 패턴을 측정 외곽에 결합하는 rib feature로 정규화함)`;
        anchors.push({ patternNodeId: pattern.id, seedNodeId: seed.id, seedFeature: "direct_extrude", zMm: baseZ, surfaceRadiusMm: surfaceRadius, outerDatumMm: Number((surfaceRadius + radialWidth * .65).toFixed(6)), overlapMm: Number((radialWidth * .35).toFixed(6)), clippedHeightMm: null });
        continue;
      }
    }
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
  // The fitted cap top may taper to a narrower roof than the planner's
  // original straight cylinder. Limit a declared internal clearance cut to
  // the last measured ordinate that still retains a radial roof/web. Without
  // this, a valid cylinder can pierce a newly rounded closure apex and split
  // it into two solids. The cutter remains an explicit Boolean feature; only
  // its approved continuous height is constrained by the same observed curve.
  const roofMarginMm = Math.max(.25, Math.min(1, targetRadius * .02));
  for (const cut of componentNodes(graph, componentId).filter((node) => node.operation === "boolean" && node.parameters?.operation === "cut")) {
    for (const inputId of cut.inputNodeIds.slice(1)) {
      const cutter = byId.get(inputId);
      if (cutter?.operation !== "primitive" || cutter.parameters?.primitive !== "cylinder") continue;
      const cutterRadius = Number(cutter.parameters.radiusMm);
      const translation = cutter.parameters.transform?.translationMm ?? {};
      const zStart = Number(translation.z ?? 0);
      const height = Number(cutter.parameters.heightMm);
      if (!(cutterRadius > 0) || !Number.isFinite(zStart) || !(height > 0)) continue;
      const safeTop = outer.filter((point) => point.zMm >= zStart - 1e-6 && point.xMm >= cutterRadius + roofMarginMm).at(-1)?.zMm;
      if (!Number.isFinite(safeTop)) continue;
      const nextHeight = Math.min(height, Number(safeTop) - zStart);
      if (!(nextHeight > .05) || nextHeight >= height - 1e-6) continue;
      cutter.parameters.heightMm = Number(nextHeight.toFixed(6));
      cavityCutAnchors.push({ booleanNodeId: cut.id, cutterNodeId: cutter.id, source: "measured_closure_roof_margin", zStartMm: zStart, previousHeightMm: height, heightMm: cutter.parameters.heightMm, roofMarginMm });
    }
  }
  return { nodeId: target.id, samples: outer.length, source: "primary_cap_silhouette_measurement", boundaryExtensions, patternSeedAnchors: anchors, cavityCutAnchors };
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

/**
 * A thread sweep can only be a manufacturing cut when its pitch, section and
 * clearance are evidenced.  A photograph-derived, interface-labelled sweep
 * has none of those values.  Passing it to an OCCT Boolean anyway can split a
 * cap into disconnected solids while making the graph look more detailed than
 * the evidence warrants.  Remove only such *cut operands* from the visual
 * B-Rep graph and leave the thread interface itself for the manufacturing
 * evidence gate.  This is topology/evidence based (interface kind + graph
 * edge), never a product or component-name exception.
 */
export function suppressUnverifiedThreadCuts(graph) {
  const next = structuredClone(graph);
  const threadComponentIds = new Set(next.interfaces.filter((item) => item.kind === "thread").flatMap((item) => item.componentIds));
  const byId = new Map(next.nodes.map((node) => [node.id, node]));
  const suppressed = [];
  for (const node of next.nodes) {
    if (node.operation !== "boolean" || node.parameters?.operation !== "cut" || node.inputNodeIds.length < 2) continue;
    const retained = [node.inputNodeIds[0]];
    for (const inputId of node.inputNodeIds.slice(1)) {
      const input = byId.get(inputId);
      const hasThreadContract = input?.operation === "sweep" && Boolean(input.parameters?.interfaceKey) && threadComponentIds.has(node.componentId);
      if (!hasThreadContract) retained.push(inputId);
      else suppressed.push({ componentId: node.componentId, booleanNodeId: node.id, sweepNodeId: inputId, interfaceKey: input.parameters.interfaceKey, reason: "thread_profile_pitch_tolerance_evidence_missing" });
    }
    node.inputNodeIds = retained;
    // A cut that contained only a provisional thread is semantically an
    // identity node for the visual B-Rep. Preserve the terminal DAG node as
    // a no-op transform so the component still has exactly one explicit root;
    // leaving a one-input Boolean would violate the strict graph contract.
    if (retained.length === 1) {
      node.operation = "transform";
      node.parameters = { ...node.parameters, operation: null, transform: null };
    }
  }
  if (!suppressed.length) return { graph: next, applied: false, adjustments: [] };
  const stillReferenced = new Set(next.nodes.flatMap((node) => node.inputNodeIds));
  const removedIds = new Set(suppressed.map((item) => item.sweepNodeId).filter((id) => !stillReferenced.has(id)));
  next.nodes = next.nodes.filter((node) => !removedIds.has(node.id));
  for (const component of next.components) {
    if (Array.isArray(component.nodeIds)) component.nodeIds = component.nodeIds.filter((id) => !removedIds.has(id));
  }
  return { graph: next, applied: true, adjustments: suppressed.map((item) => ({ ...item, excludedFrom: "visual_brep_only", manufacturingStatus: "manufacturing_review_required" })) };
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

/**
 * Reassert an approved radial assembly datum after a compiled-contour fit.
 *
 * A photograph supplies a *shape ratio*, but its foreground mask cannot
 * supersede an approved external width/depth.  The iterative compiled-contour
 * fitter changes local curve ordinates to reduce residuals; without a final
 * datum constraint it can silently shrink an otherwise good assembly below
 * the user/official dimension.  This function is intentionally limited to a
 * centred, z-axis B-Rep assembly whose radial envelope is calculable from the
 * supported feature graph.  It changes the same curve/feature parameters the
 * OCCT compiler consumes -- never a viewer-only scale -- and leaves off-axis
 * or non-radial products for an explicit review question.
 */
export function fitApprovedRadialAssemblyDatum(graph, approvedDimensions = null) {
  const targetDiameter = Math.min(Number(approvedDimensions?.widthMm), Number(approvedDimensions?.depthMm));
  if (!Number.isFinite(targetDiameter) || targetDiameter <= 0) return { graph, applied: false, adjustments: [], reason: "approved_radial_datum_missing" };
  const targetRadius = targetDiameter / 2;
  const next = structuredClone(graph);
  const nodes = new Map(next.nodes.map((node) => [node.id, node]));
  const radialCandidates = [];
  for (const component of next.components) {
    if (component.representation !== "brep_solid") continue;
    const translation = component.transform?.translationMm ?? {};
    const rotation = component.transform?.rotationDeg ?? {};
    if (Math.hypot(Number(translation.x ?? 0), Number(translation.y ?? 0)) > 1e-6 || Math.abs(Number(rotation.x ?? 0)) > 1e-6 || Math.abs(Number(rotation.y ?? 0)) > 1e-6) continue;
    const envelope = Math.max(...component.rootNodeIds.map((id) => radialEnvelopeForNode(nodes, id, new Map())).filter(Number.isFinite));
    if (Number.isFinite(envelope) && envelope > 0) radialCandidates.push({ component, envelope });
  }
  const currentRadius = Math.max(...radialCandidates.map((item) => item.envelope));
  if (!Number.isFinite(currentRadius) || currentRadius <= 0) return { graph, applied: false, adjustments: [], reason: "radial_envelope_unmeasurable" };
  const scale = targetRadius / currentRadius;
  if (Math.abs(scale - 1) <= 1e-6) return { graph, applied: false, adjustments: [], sourceRadiusMm: currentRadius, targetRadiusMm: targetRadius, reason: "approved_radial_datum_already_satisfied" };
  for (const { component } of radialCandidates) {
    for (const node of componentNodes(next, component.id)) node.parameters = scaleRadialParameters(node.parameters, scale);
  }
  return {
    graph: next,
    applied: true,
    sourceRadiusMm: currentRadius,
    targetRadiusMm: targetRadius,
    scale,
    adjustments: radialCandidates.map(({ component, envelope }) => ({ componentId: component.id, sourceRadiusMm: envelope, targetRadiusMm: Number((envelope * scale).toFixed(6)), scale, source: "approved_assembly_radial_datum" })),
  };
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

/**
 * Fit only the upper local shape from an explicitly scoped no-cap/detail
 * image.  The primary image remains the sole global size and full-silhouette
 * datum.  This is how a related reference can inform a hidden bottle neck
 * without silently borrowing that product's diameter, height, logo or body
 * outline.
 */
export function fitNeckDetailFromEvidence(graph, evidence, evidenceManifest, approvedDimensions = null) {
  const detailItem = evidenceManifest?.items?.find((item) => item.role === "neck_detail" && item.allowedFor?.includes("neck_thread"));
  const measurement = detailItem ? evidence?.images?.find((item) => item.ok && item.measurement?.imageId === detailItem.imageId)?.measurement : null;
  const samples = measurement?.neckDetailSilhouette ?? measurement?.topDetailSilhouette;
  if (!detailItem || !Array.isArray(samples) || samples.length < 12) return { graph, applied: false, adjustments: [], observations: [], reason: "neck_detail_evidence_missing" };
  // A perspective/detail photograph with only a *related* product identity
  // is valuable evidence for a later user/official confirmation, but it is
  // not safe to inject as an exact manufacturing curve. This avoids the old
  // behaviour of silently mixing a different vessel's neck into the primary
  // body just because both filenames mention DURAN. Exact-product detail
  // evidence can be promoted by the Evidence Resolver (confidence >= .8).
  if (Number(detailItem.confidence) < .8) {
    return {
      graph,
      applied: false,
      adjustments: [],
      observations: [{ imageId: detailItem.imageId, source: "neck_detail_measurement_pending_identity_confirmation", confidence: detailItem.confidence, sampleCount: samples.length, allowedFor: detailItem.allowedFor }],
      reason: "related_neck_detail_requires_identity_confirmation",
    };
  }
  const candidates = graph.nodes
    .filter((node) => node.operation === "revolve" && Array.isArray(node.parameters?.profile) && node.parameters.profile.length >= 4)
    .map((node) => ({ node, span: Math.max(...node.parameters.profile.map((point) => Number(point.zMm))) - Math.min(...node.parameters.profile.map((point) => Number(point.zMm))) }))
    .sort((left, right) => right.span - left.span);
  const target = candidates[0]?.node;
  if (!target) return { graph, applied: false, adjustments: [], observations: [], reason: "neck_target_requires_topology_review" };
  const source = target.parameters.profile;
  const outer = source.filter((point) => Number(point.xMm) > 1e-8).sort((left, right) => Number(left.zMm) - Number(right.zMm));
  if (outer.length < 4) return { graph, applied: false, adjustments: [], observations: [], reason: "neck_outer_profile_missing" };
  // Axis points only close a revolved planar wire; they are not observed
  // exterior samples.  Some older graphs close an open vessel with an axis
  // point above the real rim.  Using that artificial point as the no-cap
  // registration bound stretched a 12 mm neck reference into a false cone.
  // The actual measured exterior range is the positive-radius profile.
  const minZ = Math.min(...outer.map((point) => Number(point.zMm)));
  const maxZ = Math.max(...outer.map((point) => Number(point.zMm)));
  const approvedHeight = Number(approvedDimensions?.heightMm);
  // A detail image may only replace a section the primary fit has explicitly
  // reserved below an approved top datum.  If the primary B-Rep already owns
  // the full product height, its upper curve is visible evidence and a
  // perspective no-cap image must not overwrite it.  This makes the hidden
  // region a geometric datum, not a filename or component-name heuristic.
  const hiddenTailMm = Number.isFinite(approvedHeight) && approvedHeight > maxZ + 1
    ? approvedHeight - maxZ : 0;
  if (!(hiddenTailMm > 0)) {
    return {
      graph,
      applied: false,
      adjustments: [],
      observations: [{ imageId: detailItem.imageId, source: "neck_detail_not_applied_no_hidden_primary_range", confidence: detailItem.confidence, sampleCount: samples.length, allowedFor: detailItem.allowedFor }],
      reason: "neck_detail_has_no_hidden_primary_range",
    };
  }
  const usableHeight = Number.isFinite(approvedHeight) && approvedHeight > 0 ? Math.min(approvedHeight, maxZ - minZ) : maxZ - minZ;
  // The detail photo's upper 48% maps only to the upper 12% of the already
  // calibrated primary-product B-Rep.  Its lower sample is pinned to the
  // existing shoulder radius, so it can refine lip/ring curvature but cannot
  // grow the unrelated reference into a wider bottle.
  const detailHeight = Math.max(8, Math.min(usableHeight * .12, maxZ - minZ));
  const startZ = maxZ - detailHeight;
  const anchorRadius = radiusFromProfile(source, startZ);
  const ordered = [...samples].filter((item) => Number.isFinite(Number(item.zNorm)) && Number.isFinite(Number(item.radiusNorm))).sort((left, right) => Number(left.zNorm) - Number(right.zNorm));
  const baseRadius = Math.max(1e-6, Number(ordered[0]?.radiusNorm));
  const fittedTail = ordered.map((item) => ({
    xMm: Number(Math.max(.01, anchorRadius * Number(item.radiusNorm) / baseRadius).toFixed(6)),
    yMm: 0,
    zMm: Number((startZ + Math.max(0, Math.min(1, Number(item.zNorm))) * detailHeight).toFixed(6)),
  }));
  const before = outer.filter((point) => Number(point.zMm) < startZ - 1e-6);
  const sample = (items, count) => items.length <= count ? items : Array.from({ length: count }, (_, index) => items[Math.round(index * (items.length - 1) / Math.max(1, count - 1))]);
  const combined = [...sample(before, 44), ...sample(fittedTail, 21)];
  const deduplicated = combined.filter((point, index, all) => index === 0 || Number(point.zMm) > Number(all[index - 1].zMm) + 1e-6);
  if (deduplicated.length < 4) return { graph, applied: false, adjustments: [], observations: [], reason: "neck_detail_degenerate" };
  const next = structuredClone(graph); const node = next.nodes.find((item) => item.id === target.id);
  node.parameters.profile = [{ xMm: 0, yMm: 0, zMm: minZ }, ...deduplicated, { xMm: 0, yMm: 0, zMm: maxZ }];
  node.parameters.curveSegments = monotoneBezierSegments(deduplicated.map(({ xMm, zMm }) => ({ xMm, zMm })));
  const sweepAnchors = reanchorUnionSweepPaths(graph, next, target.componentId, target.id);
  if (sweepAnchors.unresolved.length) return {
    graph,
    applied: false,
    adjustments: [],
    observations: [{ imageId: detailItem.imageId, source: "neck_detail_measurement_blocked_by_unanchored_feature", confidence: detailItem.confidence, nodeIds: sweepAnchors.unresolved.map((item) => item.nodeId) }],
    reason: "neck_target_requires_topology_review",
  };
  return {
    graph: next,
    applied: true,
    observations: [],
    adjustments: [{
      nodeId: node.id,
      imageId: detailItem.imageId,
      zRangeMm: { min: Number(startZ.toFixed(6)), max: Number(maxZ.toFixed(6)) },
      source: "neck_detail_normalized_curve_fit",
      confidence: detailItem.confidence,
      note: "Scoped neck-detail evidence changed only the anchored upper local curve; primary product dimensions and full silhouette remain unchanged.",
    }, ...sweepAnchors.adjustments],
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
  // Attribute a full-product residual only to the component that is actually
  // visible at that axial section.  This is more precise than the former
  // "largest body only" shortcut: a ribbed closure or an annular ring can be
  // the observed outer envelope, while hidden liners and transparent necks
  // remain untouched.  Visibility is computed from assembled B-Rep bounds
  // and PBR opacity/transmission, never from a component's display name.
  const next = structuredClone(graph); const diagnosticsById = new Map(placed.map((item) => [item.componentId, item])); const adjustments = [];
  for (const component of next.components.filter((item) => item.representation === "brep_solid")) {
    const diagnostic = diagnosticsById.get(component.id); const node = outerRevolveNode(next, component.id);
    if (!diagnostic || !node) continue;
    const profile = node.parameters?.profile ?? []; const localHeight = Number(diagnostic.boundsMm.z);
    // A revolve whose raw profile never reaches two distinct axis datums is
    // an annular/ring section.  Its compiler uses the declared closed wire,
    // not an axis-closed Bézier face, so generic exterior-knot insertion would
    // be invalid. Leave it to its own annular feature fit instead of changing
    // topology merely to chase a full-product silhouette sample.
    const axisDatums = profile.filter((point) => Math.abs(Number(point.xMm)) <= 1e-7).map((point) => Number(point.zMm));
    if (axisDatums.length < 2 || Math.max(...axisDatums) - Math.min(...axisDatums) <= 1e-6) continue;
    const placementZ = Number(component.transform?.translationMm?.z ?? 0);
    let nextProfile = profile.map((point) => {
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
    // A sparse initial feature plan can put one Bézier span across a measured
    // neck groove, shoulder break, or heel.  Scaling only the existing end
    // poles then converges to a smooth average and cannot express the actual
    // continuous manufacturing curve.  Insert at most one measured radial
    // control point at the largest *visible* residual.  This is bounded curve
    // fitting (not mesh subdivision), applies only to ordinary Bézier/polyline
    // declarations, and never rewrites an approved rational NURBS knot set.
    const declaredCurves = Array.isArray(node.parameters.curveSegments) ? node.parameters.curveSegments : [];
    const hasRationalNurbs = declaredCurves.some((segment) => segment.kind === "nurbs" && Array.isArray(segment.knots));
    let insertedControlPoint = null;
    const radialProfile = profile.filter((point) => Math.abs(Number(point.xMm)) > 1e-7).sort((left, right) => Number(left.zMm) - Number(right.zMm));
    if (!hasRationalNurbs && radialProfile.length >= 2 && nextProfile.length < 63) {
      const localMin = Math.min(...radialProfile.map((point) => Number(point.zMm)));
      const localMax = Math.max(...radialProfile.map((point) => Number(point.zMm)));
      const minimumSpacing = Math.max(.5, (localMax - localMin) / 120);
      const candidates = measured.silhouette.map((sample) => {
        const globalZ = zMin + Number(sample.zNorm) * (zMax - zMin); const localZ = globalZ - placementZ;
        if (localZ <= localMin + minimumSpacing || localZ >= localMax - minimumSpacing || visibleAt(globalZ)?.componentId !== component.id) return null;
        const compiledRadius = interpolate(diagnostic.silhouette, (localZ - localMin) / Math.max(1e-9, localHeight)) * diagnostic.radius;
        const targetRadius = targetRadiusAt(globalZ); const residual = targetRadius - compiledRadius;
        if (!(compiledRadius > 1e-6) || !Number.isFinite(residual) || Math.abs(residual) < minimumResidualMm) return null;
        const bracket = radialProfile.findIndex((point) => Number(point.zMm) > localZ + minimumSpacing);
        if (bracket <= 0 || localZ - Number(radialProfile[bracket - 1].zMm) < minimumSpacing || Number(radialProfile[bracket].zMm) - localZ < minimumSpacing) return null;
        return { localZ, residual, compiledRadius, bracket };
      }).filter(Boolean).sort((left, right) => Math.abs(right.residual) - Math.abs(left.residual));
      const insertion = candidates[0];
      if (insertion) {
        const profileRadius = Math.abs(radiusFromProfile(nextProfile, insertion.localZ));
        const scale = Math.max(1 - maxScaleStep, Math.min(1 + maxScaleStep, 1 + gain * insertion.residual / Math.max(profileRadius, 1e-6)));
        const point = { xMm: Number((profileRadius * scale).toFixed(6)), yMm: 0, zMm: Number(insertion.localZ.toFixed(6)) };
        const insertAt = nextProfile.findIndex((item) => Math.abs(Number(item.xMm)) > 1e-7 && Number(item.zMm) > point.zMm);
        if (insertAt > 0) {
          nextProfile = [...nextProfile.slice(0, insertAt), point, ...nextProfile.slice(insertAt)];
          insertedControlPoint = { zMm: point.zMm, xMm: point.xMm, residualMm: Number(insertion.residual.toFixed(6)) };
        }
      }
    }
    const profileChanged = nextProfile.length !== profile.length || nextProfile.some((point, index) => index >= profile.length || Math.abs(Number(point.xMm) - Number(profile[index].xMm)) > 1e-8);
    if (!profileChanged) continue;
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
    const canPreserveDeclaredCurves = declaredCurves.length > 0 && declaredCurves.every((segment) => Array.isArray(segment.poles) || Array.isArray(segment.points));
    if (canPreserveDeclaredCurves && !insertedControlPoint) {
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
    const changed = nextProfile.reduce((count, point, index) => count + (index >= profile.length || Math.abs(Number(point.xMm) - Number(profile[index].xMm)) > 1e-8 ? 1 : 0), 0);
    adjustments.push({ componentId: component.id, nodeId: node.id, source: "compiled_occt_assembly_contour", changedControlPoints: changed, insertedControlPoint, gain, maxScaleStep, minimumResidualMm });
  }
  return { graph: next, applied: adjustments.length > 0, adjustments, source: "occt_brep_assembly_tessellation" };
}
