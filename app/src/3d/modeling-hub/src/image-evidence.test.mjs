import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyseDraft } from "./modeling-spec.mjs";
import { canonicalizeGraph, fixtureGraphOutput } from "./modeling-graph.mjs";
import { fitAxialAssemblyEnvelope, fitRadialAssemblyEnvelope, measureImageEvidence, normaliseComponentLocalCoordinates } from "./image-evidence.mjs";

process.env.NET30_MODELING_DRAFT_FIXTURE = "true";
process.env.NET30_OPENAI_MODEL = "fixture";
process.env.NET30_OPENAI_MODELS = "fixture";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../tmp/pdfs/pics");
const files = ["Duran laboratory bottles 100.jpg", "Duran laboratory bottles 100 no cap.png", "Duran laboratory bottles 100 display.webp"];
const types = ["image/jpeg", "image/png", "image/webp"];
const inputs = await Promise.all(files.map(async (filename, index) => ({ id: `fixture-image-${index + 1}`, filename, dataUrl: `data:${types[index]};base64,${(await fs.readFile(path.join(root, filename))).toString("base64")}` })));
const evidence = await measureImageEvidence(inputs);
assert.equal(evidence.images.filter((item) => item.ok).length, 3, "all fixed fixture images must be measurable without an LLM");
assert.ok(evidence.images[0].measurement.cap.bottomY < evidence.images[0].measurement.bounds.bottomY, "primary image must isolate a cap boundary from the bottle");
assert.ok(evidence.images[0].measurement.cap.outerDiameterRatio > .8, "primary image must expose a measured cap envelope separately from the bottle contour");

const analysis = await analyseDraft({
  model: "fixture", product: { source: "new", name: "DURAN GL45 100 mL 실험용 병" },
  requestedComponents: ["유리병", "뚜껑", "푸어링 링", "전면 인쇄"], componentInput: "유리병, 뚜껑, 푸어링 링, 전면 인쇄",
  prompt: "DURAN laboratory bottle", imageIds: inputs.map((item) => item.id),
}, inputs);
assert.equal(analysis.fit.applied, true, "the largest revolved component must use the primary-image fit");
assert.equal(analysis.fit.contour.imageId, "fixture-image-1", "no-cap and PYREX evidence must not replace the primary silhouette");
assert.ok(analysis.fit.contour.rmsMm <= .35, "measured profile must meet the contour fitting gate");
assert.equal(analysis.modelingGraphV3.components[0].curves[0].provenance.source, "image_measurement");

const radialOutput = fixtureGraphOutput({ product: { name: "radial envelope" }, prompt: "closure", requestedComponents: ["closure"] });
radialOutput.components[0].features[0].parameters.profile.forEach((point) => { point.xMm *= 1.12; });
const radialGraph = canonicalizeGraph(radialOutput, ["closure"]).graph;
const radialFit = fitRadialAssemblyEnvelope(radialGraph, { widthMm: 50, depthMm: 50 });
assert.equal(radialFit.applied, true, "a centred radial component outside its approved assembly envelope must be fitted before review");
const fittedProfile = radialFit.graph.nodes[0].parameters.profile;
assert.equal(Math.max(...fittedProfile.map((point) => point.xMm)), 25, "radial fitting must edit the graph feature values, not apply a hidden assembly scale");

const ribbedOutput = fixtureGraphOutput({ product: { name: "ribbed closure" }, prompt: "closure", requestedComponents: ["뚜껑"] });
const ribBase = ribbedOutput.components[0].features[0];
const ribParameters = { ...structuredClone(ribBase.parameters), primitive: null, profile: null, dimensionsMm: null, radiusMm: null, innerRadiusMm: null, heightMm: 20, thicknessMm: null, count: null, spacingMm: 3, depthMm: 1.2, transform: { translationMm: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } };
const rib = { key: "cap-rib", operation: "rib", inputKeys: [ribBase.key], parameters: ribParameters, rationale: "measured closure rib", confidence: .9 };
const pattern = { key: "cap-pattern", operation: "pattern", inputKeys: [ribBase.key, rib.key], parameters: { ...structuredClone(ribParameters), heightMm: null, spacingMm: null, depthMm: null, count: 36 }, rationale: "radial repetition", confidence: .9 };
ribbedOutput.components[0].features = [ribBase, rib, pattern];
const ribbedGraph = canonicalizeGraph(ribbedOutput, ["뚜껑"]).graph;
const capFit = fitRadialAssemblyEnvelope(ribbedGraph, { widthMm: 56, depthMm: 56 }, { cap: { outerDiameterRatio: .9 } });
assert.equal(capFit.adjustments[0]?.source, "primary_cap_measurement", "a ribbed radial component may expand to the measured cap envelope without a name rule");

const localGraph = structuredClone(radialGraph);
localGraph.nodes[0].parameters.profile.forEach((point) => { point.zMm += 83; });
const localFit = normaliseComponentLocalCoordinates(localGraph);
assert.equal(localFit.applied, true, "absolute feature coordinates must be rebased into a component-local child B-Rep");
assert.equal(Math.min(...localFit.graph.nodes[0].parameters.profile.map((point) => point.zMm)), 0);
assert.equal(localFit.graph.components[0].transform.translationMm.z, 83);

const tallPlacement = structuredClone(radialGraph);
tallPlacement.components[0].transform.translationMm.z = 90;
const axialFit = fitAxialAssemblyEnvelope(tallPlacement, { heightMm: 100 });
assert.equal(axialFit.applied, true, "a local component placed beyond the approved assembly height must be moved into the z-up datum");
assert.equal(axialFit.graph.components[0].transform.translationMm.z, 0);
console.log("image evidence measurement and primary silhouette fitting proof passed");
