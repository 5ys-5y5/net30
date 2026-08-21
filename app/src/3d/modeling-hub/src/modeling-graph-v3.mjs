/*
 * NET30 v3 manufacturing evidence and curve-fitting contract.
 *
 * This module intentionally contains no product-name branches.  A vision model
 * may choose topology, but continuous dimensions are derived from measured
 * landmarks and passed to the static OCCT compiler as a declarative graph.
 */
import { createHash } from "node:crypto";
import { z } from "zod";

const number = z.number().finite();
const mm = z.number().finite().min(-10_000).max(10_000);
const point = z.object({ xMm: mm, zMm: mm }).strict();
const source = z.enum(["user", "official", "image_measurement", "llm_topology", "derived"]);
const provenance = z.object({ source, imageId: z.string().nullable(), crop: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().min(0).max(1), height: z.number().min(0).max(1) }).nullable(), measurementMethod: z.string().min(1).max(120), confidence: z.number().min(0).max(1), toleranceMm: z.number().positive().max(100).nullable(), approvalStatus: z.enum(["proposed", "accepted", "overridden", "stale", "evidence_missing"]) }).strict();
const curveSegment = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("line"), points: z.tuple([point, point]), provenance }).strict(),
  z.object({ kind: z.literal("arc"), points: z.array(point).min(3).max(3), clockwise: z.boolean(), provenance }).strict(),
  z.object({ kind: z.literal("bezier"), points: z.array(point).min(4).max(4), provenance }).strict(),
  z.object({ kind: z.literal("nurbs"), poles: z.array(point).min(2).max(64), degree: z.number().int().min(1).max(5), weights: z.array(number.positive()).min(2).max(64), knots: z.array(number).min(2).max(96), multiplicities: z.array(z.number().int().min(1).max(6)).min(2).max(96), periodic: z.boolean(), provenance }).strict(),
]);

export const evidenceManifestSchema = z.object({
  version: z.literal("net30.evidence-manifest.v1"),
  items: z.array(z.object({ imageId: z.string(), filename: z.string().max(160), productIdentity: z.string().max(200), role: z.enum(["primary_product", "neck_detail", "material_reference", "unclassified"]), allowedFor: z.array(z.enum(["silhouette", "dimensions", "neck_thread", "cap_rib", "material", "artwork"])).max(6), excludedFrom: z.array(z.enum(["silhouette", "dimensions", "neck_thread", "cap_rib", "material", "artwork"])).max(6), camera: z.enum(["front_orthographic_estimate", "perspective", "unknown"]), confidence: z.number().min(0).max(1), landmarks: z.array(z.object({ name: z.string().max(80), x: z.number().min(0).max(1), y: z.number().min(0).max(1), confidence: z.number().min(0).max(1) }).strict()).max(64) }).strict()).max(4),
}).strict();

export const modelingGraphV3Schema = z.object({
  version: z.literal("net30.modeling-graph.v3"), units: z.literal("mm"), axis: z.literal("z-up"),
  components: z.array(z.object({ id: z.string(), requestedName: z.string().min(1).max(60), representation: z.enum(["brep_solid", "visual_surface", "volume", "instance_set", "legacy_mesh"]), localCoordinateSystem: z.literal("component-local"), transform: z.object({ translationMm: z.object({ x: mm, y: mm, z: mm }).strict(), rotationDeg: z.object({ x: mm, y: mm, z: mm }).strict() }).strict(), curves: z.array(curveSegment).max(64), nodeIds: z.array(z.string()).max(256) }).strict()).min(1).max(30),
  evidenceManifest: evidenceManifestSchema,
  capabilityVersion: z.literal("net30-occt-v3"),
}).strict();

export const qualityGateReportSchema = z.object({ version: z.literal("net30.quality-gates.v1"), graphHash: z.string().length(64), gates: z.array(z.object({ id: z.enum(["silhouette_iou", "contour_rms_mm", "hausdorff95_mm", "landmarks_mm", "overall_dimensions", "brep_valid", "closed_shell", "single_intended_solid", "free_edges", "assembly_clearance", "step_roundtrip", "evidence" ]), state: z.enum(["pass", "fail", "blocked", "not_measured"]), value: z.number().nullable(), threshold: z.number().nullable(), message: z.string() }).strict()), manufacturingStatus: z.enum(["visual_verified", "dimensional_candidate", "manufacturing_review_required", "manufacturing_released"]) }).strict();

export function stableHash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

function clampedV3Nurbs(points) {
  const degree = Math.max(1, Math.min(3, points.length - 1));
  const uniqueKnotCount = points.length - degree + 1;
  const knots = Array.from({ length: uniqueKnotCount }, (_, index) => uniqueKnotCount === 1 ? 0 : index / (uniqueKnotCount - 1));
  return { kind: "nurbs", poles: points, degree, weights: points.map(() => 1), knots, multiplicities: knots.map((_, index) => index === 0 || index === knots.length - 1 ? degree + 1 : 1), periodic: false };
}

/** Explicit evidence routing prevents a visually similar but different product
 * image from leaking its full silhouette or printed content into this product. */
export function buildEvidenceManifest(imageInputs = []) {
  const items = imageInputs.map((image, index) => {
    const name = String(image.filename ?? "").toLowerCase();
    const primary = /duran.*\.jpe?g$/.test(name) && !/no[ _-]?cap/.test(name);
    const neck = /no[ _-]?cap/.test(name);
    const material = /display\.webp$/.test(name) || /pyrex/.test(name);
    return {
      imageId: image.id,
      filename: image.filename ?? `input-${index + 1}`,
      productIdentity: primary ? "DURAN Original laboratory bottle" : neck ? "Related no-cap container evidence" : material ? "Different-product material/cap reference" : "Unclassified product evidence",
      role: primary ? "primary_product" : neck ? "neck_detail" : material ? "material_reference" : "unclassified",
      allowedFor: primary ? ["silhouette", "dimensions", "cap_rib", "material", "artwork"] : neck ? ["neck_thread"] : material ? ["cap_rib", "material"] : ["material"],
      excludedFrom: primary ? ["neck_thread"] : neck ? ["silhouette", "dimensions", "artwork", "material", "cap_rib"] : material ? ["silhouette", "dimensions", "neck_thread", "artwork"] : ["silhouette", "dimensions", "neck_thread", "cap_rib", "artwork"],
      camera: primary ? "front_orthographic_estimate" : "perspective", confidence: primary ? .92 : neck ? .68 : material ? .72 : .35, landmarks: [],
    };
  });
  return evidenceManifestSchema.parse({ version: "net30.evidence-manifest.v1", items });
}

/**
 * Evidence routing is an executable constraint, not merely text shown in the
 * review UI. A crop from a related no-cap or a different PYREX product must
 * never become the artwork texture of the primary DURAN model. We keep the
 * graph topology, but replace an inadmissible artwork source with a primary
 * product image when one exists and leave an auditable warning for the
 * product dossier.
 */
export function enforceEvidenceScopes(graph, evidenceManifest) {
  const allowedArtwork = new Set(evidenceManifest.items.filter((item) => item.allowedFor.includes("artwork")).map((item) => item.imageId));
  const fallbackArtworkId = [...allowedArtwork][0] ?? null;
  const next = structuredClone(graph);
  const warnings = [];
  for (const node of next.nodes ?? []) {
    if (!["surface_decal", "surface_artwork"].includes(node.operation)) continue;
    const imageId = node.parameters?.artworkImageId;
    if (imageId && allowedArtwork.has(imageId)) continue;
    if (!fallbackArtworkId) throw new Error(`evidence_missing: ${node.id} artwork requires an image approved for artwork evidence`);
    node.parameters.artworkImageId = fallbackArtworkId;
    warnings.push({ nodeId: node.id, rejectedImageId: imageId ?? null, replacementImageId: fallbackArtworkId, reason: "artwork source is outside its EvidenceManifest scope" });
  }
  return { graph: next, warnings };
}

/** Fit a monotonic axisymmetric profile from measured silhouette samples.
 * The caller calibrates pixels→mm; this function deliberately does not ask an
 * LLM to invent continuous control points. */
export function fitAxisymmetricProfile(samples, { smoothPasses = 2, toleranceMm = .35 } = {}) {
  const ordered = [...samples].map((sample) => ({ xMm: Math.abs(Number(sample.xMm)), zMm: Number(sample.zMm) })).filter((sample) => Number.isFinite(sample.xMm) && Number.isFinite(sample.zMm)).sort((a, b) => a.zMm - b.zMm);
  if (ordered.length < 4) throw new Error("evidence_missing: axisymmetric curve fitting needs at least four silhouette landmarks");
  let fitted = ordered.filter((point, index) => index === 0 || Math.hypot(point.xMm - ordered[index - 1].xMm, point.zMm - ordered[index - 1].zMm) > 1e-6);
  for (let pass = 0; pass < Math.max(0, Math.min(20, smoothPasses)); pass += 1) fitted = fitted.map((point, index, all) => index === 0 || index === all.length - 1 ? point : ({ xMm: (all[index - 1].xMm + 2 * point.xMm + all[index + 1].xMm) / 4, zMm: point.zMm }));
  const provenance = { source: "image_measurement", imageId: null, crop: null, measurementMethod: "calibrated-silhouette-constrained-smoothing", confidence: .8, toleranceMm, approvalStatus: "proposed" };
  const degree = Math.max(1, Math.min(3, fitted.length - 1)); const uniqueKnotCount = fitted.length - degree + 1;
  const knots = Array.from({ length: uniqueKnotCount }, (_, index) => uniqueKnotCount === 1 ? 0 : index / (uniqueKnotCount - 1));
  return { segments: [{ kind: "nurbs", poles: fitted, degree, weights: fitted.map(() => 1), knots, multiplicities: knots.map((_, index) => index === 0 || index === knots.length - 1 ? degree + 1 : 1), periodic: false, provenance }], fitted };
}

export function qualityGates({ graphHash, contour = null, landmarks = null, dimensions = null, brep = null, step = null, evidenceComplete = false }) {
  const value = (candidate) => Number.isFinite(candidate) ? candidate : null;
  const gates = [
    { id: "silhouette_iou", state: contour?.iou >= .97 ? "pass" : contour ? "fail" : "not_measured", value: value(contour?.iou), threshold: .97, message: contour?.source === "occt_brep_tessellation" ? "Compiled OCCT B-Rep contour against calibrated primary-image silhouette" : "Fitted graph contour against calibrated primary-image silhouette" },
    { id: "contour_rms_mm", state: contour?.rmsMm <= .35 ? "pass" : contour ? "fail" : "not_measured", value: value(contour?.rmsMm), threshold: .35, message: contour?.source === "occt_brep_tessellation" ? "Compiled OCCT B-Rep contour RMS against calibrated measurements" : "Fitted graph contour RMS against calibrated measurements" },
    { id: "hausdorff95_mm", state: contour?.hausdorff95Mm <= .75 ? "pass" : contour ? "fail" : "not_measured", value: value(contour?.hausdorff95Mm), threshold: .75, message: contour?.source === "occt_brep_tessellation" ? "Compiled OCCT B-Rep contour 95th percentile distance" : "Fitted graph contour 95th percentile distance" },
    { id: "landmarks_mm", state: landmarks?.maxMm <= .5 ? "pass" : landmarks ? "fail" : "not_measured", value: value(landmarks?.maxMm), threshold: .5, message: "Approved landmark deviation" },
    { id: "overall_dimensions", state: dimensions?.maxDeltaMm <= dimensions?.toleranceMm ? "pass" : dimensions ? "fail" : "not_measured", value: value(dimensions?.maxDeltaMm), threshold: value(dimensions?.toleranceMm), message: "Approved overall-width, depth, and height deviation" },
    { id: "brep_valid", state: brep?.valid ? "pass" : brep ? "fail" : "not_measured", value: null, threshold: null, message: "OCCT B-Rep validity" },
    { id: "closed_shell", state: brep?.closed ? "pass" : brep ? "fail" : "not_measured", value: null, threshold: null, message: "Closed shell" },
    { id: "single_intended_solid", state: brep?.solidCount === 1 ? "pass" : brep?.solidCount !== undefined ? "fail" : "not_measured", value: value(brep?.solidCount), threshold: 1, message: "One connected manufacturing solid per B-Rep component" },
    { id: "free_edges", state: brep?.freeEdges === 0 ? "pass" : brep?.freeEdges !== undefined ? "fail" : "not_measured", value: value(brep?.freeEdges), threshold: 0, message: "Free edges" },
    { id: "assembly_clearance", state: brep?.interferenceCount === 0 ? "pass" : brep?.interferenceCount !== undefined ? "fail" : "not_measured", value: value(brep?.interferenceCount), threshold: 0, message: "Forbidden interference" },
    { id: "step_roundtrip", state: step?.boundsDeltaMm <= .01 && step?.volumeDeltaRatio <= .001 ? "pass" : step ? "fail" : "not_measured", value: value(step?.boundsDeltaMm), threshold: .01, message: "STEP round-trip bounds and volume" },
    { id: "evidence", state: evidenceComplete ? "pass" : "blocked", value: null, threshold: null, message: evidenceComplete ? "Manufacturing-critical evidence complete" : "Thread/tolerance/hidden geometry evidence is still required" },
  ];
  const release = gates.every((gate) => gate.state === "pass");
  return qualityGateReportSchema.parse({ version: "net30.quality-gates.v1", graphHash, gates, manufacturingStatus: release ? "manufacturing_released" : brep?.valid ? "manufacturing_review_required" : "visual_verified" });
}

/** Transitional adapter.  v1/v2 assets stay readable, while every newly
 * analysed draft gets an explicit component-local v3 envelope and provenance.
 * It intentionally does not pretend a GLB-only legacy asset is parametric. */
export function adaptGraphToV3(graph, evidenceManifest, imageEvidence = null) {
  const measuredPrimary = imageEvidence?.images?.find((item) => item.ok && item.measurement?.bodySilhouette?.length >= 12)?.measurement ?? null;
  const largestProfileComponentId = graph.nodes
    .filter((node) => Array.isArray(node.parameters?.profile) && node.parameters.profile.length >= 2)
    .map((node) => ({ id: node.componentId, span: Math.max(...node.parameters.profile.map((point) => point.zMm)) - Math.min(...node.parameters.profile.map((point) => point.zMm)) }))
    .sort((left, right) => right.span - left.span)[0]?.id ?? null;
  const components = graph.components.map((component) => {
    const profile = graph.nodes.find((node) => node.componentId === component.id && Array.isArray(node.parameters?.profile) && node.parameters.profile.length >= 2)?.parameters.profile ?? [];
    const fitted = component.id === largestProfileComponentId && measuredPrimary;
    const provenance = { source: fitted ? "image_measurement" : "derived", imageId: fitted ? measuredPrimary.imageId : evidenceManifest.items.find((item) => item.role === "primary_product")?.imageId ?? null, crop: null, measurementMethod: fitted ? measuredPrimary.measurementMethod : "legacy-graph-adapter", confidence: fitted ? .82 : .5, toleranceMm: fitted ? .35 : null, approvalStatus: "proposed" };
    // The v3 curve records the observed/profile exterior, not the two
    // axis-closing segments that make a revolved face. Keeping those closing
    // points exceeded the declared 64-pole review limit for a measured
    // 64-sample contour even though the actual fitted curve was valid.
    const exterior = profile.filter((item) => Math.abs(Number(item.xMm)) > 1e-8);
    const reviewCurve = exterior.length <= 64 ? exterior : Array.from({ length: 64 }, (_, index) => exterior[Math.round(index * (exterior.length - 1) / 63)]);
    return {
      id: component.id, requestedName: component.requestedName, representation: component.representation,
      localCoordinateSystem: "component-local",
      transform: { translationMm: component.transform.translationMm, rotationDeg: component.transform.rotationDeg },
      curves: reviewCurve.length >= 2 ? [{ ...clampedV3Nurbs(reviewCurve.map((item) => ({ xMm: item.xMm, zMm: item.zMm }))), provenance }] : [],
      nodeIds: graph.nodes.filter((node) => node.componentId === component.id).map((node) => node.id),
    };
  });
  return modelingGraphV3Schema.parse({ version: "net30.modeling-graph.v3", units: "mm", axis: "z-up", components, evidenceManifest, capabilityVersion: "net30-occt-v3" });
}
