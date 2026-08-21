import assert from "node:assert/strict";
import { adaptGraphToV3, buildEvidenceManifest, enforceEvidenceScopes, fitAxisymmetricProfile, qualityGates } from "./modeling-graph-v3.mjs";
import { canonicalizeGraph, fixtureGraphOutput } from "./modeling-graph.mjs";

const evidence = buildEvidenceManifest([
  { id: "primary", filename: "Duran laboratory bottles 100.jpg" },
  { id: "neck", filename: "Duran laboratory bottles 100 no cap.png" },
  { id: "material", filename: "Duran laboratory bottles 100 display.webp" },
]);
assert.deepEqual(evidence.items.map((item) => item.role), ["primary_product", "neck_detail", "material_reference"]);
assert.ok(evidence.items[2].excludedFrom.includes("silhouette"));

const fit = fitAxisymmetricProfile([{ xMm: 22, zMm: 0 }, { xMm: 27, zMm: 8 }, { xMm: 28, zMm: 45 }, { xMm: 25, zMm: 77 }, { xMm: 17, zMm: 98 }]);
assert.equal(fit.segments[0].kind, "nurbs"); assert.equal(fit.fitted.length, 5);

const output = fixtureGraphOutput({ product: { name: "curve proof" }, requestedComponents: ["유리병"], imageIds: [] });
const canonical = canonicalizeGraph(output, ["유리병"], []);
const v3 = adaptGraphToV3(canonical.graph, evidence);
assert.equal(v3.version, "net30.modeling-graph.v3"); assert.equal(v3.components[0].localCoordinateSystem, "component-local");

const unsafeArtworkGraph = { ...canonical.graph, nodes: canonical.graph.nodes.map((node, index) => index === 0 ? { ...node, operation: "surface_artwork", parameters: { ...node.parameters, artworkImageId: "material" } } : node) };
const scoped = enforceEvidenceScopes(unsafeArtworkGraph, evidence);
assert.equal(scoped.graph.nodes[0].parameters.artworkImageId, "primary");
assert.equal(scoped.warnings.length, 1);

const gates = qualityGates({ graphHash: canonical.graphHash, contour: { iou: .98, rmsMm: .3, hausdorff95Mm: .6 }, landmarks: { maxMm: .4 }, dimensions: { maxDeltaMm: .2, toleranceMm: .5 }, brep: { valid: true, closed: true, solidCount: 1, freeEdges: 0, interferenceCount: 0 }, step: { boundsDeltaMm: .009, volumeDeltaRatio: .0009 }, evidenceComplete: true });
assert.equal(gates.manufacturingStatus, "manufacturing_released");
console.log("v3 evidence, fitting, local-coordinate and quality-gate proof passed.");
