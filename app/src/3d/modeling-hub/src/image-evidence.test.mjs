import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyseDraft } from "./modeling-spec.mjs";
import { canonicalizeGraph, fixtureGraphOutput, graphHash } from "./modeling-graph.mjs";
import { fitAxialAssemblyEnvelope, fitCompiledAssemblyContour, fitCompiledClosureDatum, fitMeasuredClosureAssembly, fitRadialAssemblyEnvelope, measureImageEvidence, normaliseComponentLocalCoordinates } from "./image-evidence.mjs";

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
assert.ok(evidence.images[0].measurement.cap.silhouette.length >= 12, "primary image must expose a separate closure outline for the revolved B-Rep");

const analysis = await analyseDraft({
  model: "fixture", product: { source: "new", name: "DURAN GL45 100 mL 실험용 병" },
  requestedComponents: ["유리병", "뚜껑", "푸어링 링", "전면 인쇄"], componentInput: "유리병, 뚜껑, 푸어링 링, 전면 인쇄",
  prompt: "DURAN laboratory bottle", imageIds: inputs.map((item) => item.id),
}, inputs);
assert.equal(analysis.fit.applied, true, "the largest revolved component must use the primary-image fit");
assert.equal(analysis.fit.contour.imageId, "fixture-image-1", "no-cap and PYREX evidence must not replace the primary silhouette");
assert.ok(analysis.fit.contour.rmsMm <= .35, "measured profile must meet the contour fitting gate");
assert.equal(analysis.modelingGraphV3.components[0].curves[0].provenance.source, "image_measurement");
assert.ok(analysis.fit.primaryBodyCalibration.visibleBodyHeightMm <= analysis.fit.primaryBodyCalibration.targetHeightMm, "a primary image fit must never extend a measured contour beyond the approved local B-Rep datum");

const radialOutput = fixtureGraphOutput({ product: { name: "radial envelope" }, prompt: "closure", requestedComponents: ["closure"] });
radialOutput.components[0].features[0].parameters.profile.forEach((point) => { point.xMm *= 1.12; });
const radialGraph = canonicalizeGraph(radialOutput, ["closure"]).graph;
radialGraph.nodes[0].parameters.curveSegments = [{ kind: "nurbs", poles: radialGraph.nodes[0].parameters.profile.filter((point) => point.xMm > 0).map(({ xMm, zMm }) => ({ xMm, zMm })) }];
const radialFit = fitRadialAssemblyEnvelope(radialGraph, { widthMm: 50, depthMm: 50 });
assert.equal(radialFit.applied, true, "a centred radial component outside its approved assembly envelope must be fitted before review");
const fittedProfile = radialFit.graph.nodes[0].parameters.profile;
assert.equal(Math.max(...fittedProfile.map((point) => point.xMm)), 25, "radial fitting must edit the graph feature values, not apply a hidden assembly scale");
const fittedCurveSegments = radialFit.graph.nodes[0].parameters.curveSegments ?? [];
assert.ok(fittedCurveSegments.length > 0, "the source feature must keep its declared OCCT curve representation");
const fittedCurveX = fittedCurveSegments.flatMap((segment) => segment.poles ?? segment.points ?? []).map((point) => point.xMm);
assert.equal(Math.max(...fittedCurveX), 25, "radial fitting must update the NURBS/B\u00e9zier data OCCT actually compiles");

const ribbedOutput = fixtureGraphOutput({ product: { name: "ribbed closure" }, prompt: "closure", requestedComponents: ["뚜껑"] });
const ribBase = ribbedOutput.components[0].features[0];
const ribParameters = { ...structuredClone(ribBase.parameters), primitive: null, profile: null, dimensionsMm: null, radiusMm: null, innerRadiusMm: null, heightMm: 20, thicknessMm: null, count: null, spacingMm: 3, depthMm: 1.2, transform: { translationMm: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } };
const rib = { key: "cap-rib", operation: "rib", inputKeys: [ribBase.key], parameters: ribParameters, rationale: "measured closure rib", confidence: .9 };
const pattern = { key: "cap-pattern", operation: "pattern", inputKeys: [ribBase.key, rib.key], parameters: { ...structuredClone(ribParameters), heightMm: null, spacingMm: null, depthMm: null, count: 36 }, rationale: "radial repetition", confidence: .9 };
ribbedOutput.components[0].features = [ribBase, rib, pattern];
const ribbedGraph = canonicalizeGraph(ribbedOutput, ["뚜껑"]).graph;
const capFit = fitRadialAssemblyEnvelope(ribbedGraph, { widthMm: 56, depthMm: 56 }, { cap: { outerDiameterRatio: .9 } });
assert.equal(capFit.adjustments[0]?.source, "primary_cap_measurement", "a ribbed radial component may expand to the measured cap envelope without a name rule");
const capAssemblyFit = fitMeasuredClosureAssembly(ribbedGraph, { widthMm: 56, depthMm: 56, heightMm: 100 }, { cap: { heightNorm: .25, silhouette: Array.from({ length: 16 }, (_, index) => ({ zNorm: index / 15, radiusNorm: index < 4 ? .94 : .86 })) } });
assert.equal(capAssemblyFit.applied, true, "a cap colour-band measurement must fit a patterned component without matching its display name");
assert.equal(capAssemblyFit.closureHeightMm, 25);
assert.equal(capAssemblyFit.adjustments[0]?.role, "patterned_closure_outline", "the outer closure profile must be measured independently from its axial placement");
const fittedClosure = capAssemblyFit.graph.components[0];
assert.ok(fittedClosure.transform.translationMm.z > 0, "measured cap band must place the patterned closure above the component-local body datum");
const closureProfiles = capAssemblyFit.graph.nodes.filter((node) => node.componentId === fittedClosure.id && Array.isArray(node.parameters?.profile)).flatMap((node) => node.parameters.profile);
assert.ok(Math.max(...closureProfiles.map((point) => point.zMm)) + fittedClosure.transform.translationMm.z <= 100.01, "closure local B-Rep and assembly transform must remain inside the approved overall-height datum");
assert.ok(capAssemblyFit.graph.nodes.some((node) => node.componentId === fittedClosure.id && node.operation === "revolve" && node.parameters.curveSegments?.length), "the measured closure outline must be declared as OCCT Bézier curves, not a display-only polyline");
assert.equal(typeof graphHash(capAssemblyFit.graph), "string", "a fitted Bézier closure must remain serialisable by the strict graph schema");
const compiledDatumFit = fitCompiledClosureDatum(capAssemblyFit.graph, { diagnostics: [{ componentId: fittedClosure.id, code: "ok", boundsMm: { z: 24.5 } }] }, { heightMm: 100 });
assert.equal(compiledDatumFit.applied, true, "the assembly datum must use the actual compiled child B-Rep height when it differs from the conservative graph envelope");
assert.equal(compiledDatumFit.graph.components[0].transform.translationMm.z, 75.5);

// A graph may use a transformed primitive as the seed for a radial feature.
// The measured closure outline must constrain that real graph feature instead
// of treating it as a display-only rib or relying on its requested name.
const seededOutput = fixtureGraphOutput({ product: { name: "measured patterned closure" }, prompt: "closure", requestedComponents: ["임의 부품"] });
const seededBase = seededOutput.components[0].features[0];
const seededParameters = structuredClone(seededBase.parameters);
seededParameters.primitive = "box"; seededParameters.profile = null; seededParameters.dimensionsMm = { x: 1.4, y: 4, z: 40 }; seededParameters.radiusMm = null; seededParameters.innerRadiusMm = null; seededParameters.heightMm = null; seededParameters.thicknessMm = null; seededParameters.count = null; seededParameters.depthMm = null;
const seededTransform = structuredClone(seededBase.parameters);
Object.assign(seededTransform, { primitive: null, profile: null, dimensionsMm: null, radiusMm: null, innerRadiusMm: null, heightMm: null, thicknessMm: null, count: null, depthMm: null, transform: { translationMm: { x: 27, y: 0, z: 2 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } });
const seededPattern = structuredClone(seededBase.parameters);
Object.assign(seededPattern, { primitive: null, profile: null, dimensionsMm: null, radiusMm: 27, innerRadiusMm: null, heightMm: null, thicknessMm: null, count: 24, depthMm: null, transform: null, distribution: "radial" });
const seededBoolean = structuredClone(seededBase.parameters);
Object.assign(seededBoolean, { primitive: null, profile: null, dimensionsMm: null, radiusMm: null, innerRadiusMm: null, heightMm: null, thicknessMm: null, count: null, depthMm: null, transform: null, operation: "union" });
seededOutput.components[0].features = [
  seededBase,
  { key: "seed-box", operation: "primitive", inputKeys: [], parameters: seededParameters, rationale: "radial seed", confidence: .8 },
  { key: "seed-place", operation: "transform", inputKeys: ["seed-box"], parameters: seededTransform, rationale: "radial seed placement", confidence: .8 },
  { key: "seed-pattern", operation: "pattern", inputKeys: [seededBase.key, "seed-place"], parameters: seededPattern, rationale: "radial pattern", confidence: .8 },
  { key: "seed-root", operation: "boolean", inputKeys: [seededBase.key, "seed-pattern"], parameters: seededBoolean, rationale: "closure union", confidence: .8 },
];
const seededGraph = canonicalizeGraph(seededOutput, ["임의 부품"]).graph;
const seededFit = fitMeasuredClosureAssembly(seededGraph, { widthMm: 56, depthMm: 56, heightMm: 100 }, { cap: { heightNorm: .25, silhouette: Array.from({ length: 16 }, (_, index) => ({ zNorm: index / 15 * .7, radiusNorm: .9 })) } });
const fittedSeed = seededFit.graph.nodes.find((node) => node.operation === "primitive");
const fittedSeedPlacement = seededFit.graph.nodes.find((node) => node.operation === "transform");
assert.ok(fittedSeed.parameters.dimensionsMm.z < 40, "measured taper must clip an overlong patterned primitive instead of allowing it to flatten the closure apex");
assert.ok(fittedSeedPlacement.parameters.transform.translationMm.x < 27, "measured outer rib envelope must reposition the transformed seed without a product-name rule");
assert.ok(seededFit.adjustments[0].patternSeedAnchors.length === 1, "the fitting dossier must retain the measured pattern anchor for review");

const compiledGraph = canonicalizeGraph(fixtureGraphOutput({ product: { name: "compiled contour" }, prompt: "generic revolved part", requestedComponents: ["임의 회전 부품"] }), ["임의 회전 부품"]).graph;
const compiledComponent = compiledGraph.components[0];
const compiledProfile = compiledGraph.nodes.find((node) => node.componentId === compiledComponent.id && node.operation === "revolve").parameters.profile;
const compiledPreflight = {
  diagnostics: [{
    componentId: compiledComponent.id, code: "ok", boundsMm: { x: 50, y: 50, z: 105 },
    transform: compiledComponent.transform, material: compiledComponent.material,
    silhouette: Array.from({ length: 16 }, (_, index) => ({ zNorm: index / 15, radiusNorm: .8 })),
  }],
};
const compiledEvidence = { images: [{ ok: true, measurement: { imageId: "compiled-primary", silhouette: Array.from({ length: 16 }, (_, index) => ({ zNorm: index / 15, radiusNorm: .92 })) } }] };
const compiledFit = fitCompiledAssemblyContour(compiledGraph, compiledPreflight, compiledEvidence, "compiled-primary");
assert.equal(compiledFit.applied, true, "the compiled OCCT contour must be able to make a bounded graph correction without an LLM or a component-name rule");
const correctedProfile = compiledFit.graph.nodes.find((node) => node.componentId === compiledComponent.id && node.operation === "revolve").parameters.profile;
assert.ok(Math.max(...correctedProfile.map((point) => point.xMm)) > Math.max(...compiledProfile.map((point) => point.xMm)), "compiled residual fitting must update the same revolve profile that OCCT consumes");
assert.ok(compiledFit.adjustments[0].changedControlPoints > 0, "compiled residual fitting must record changed graph control points for the dossier");
const rationalCompiledGraph = structuredClone(compiledGraph);
const rationalNode = rationalCompiledGraph.nodes.find((node) => node.componentId === compiledComponent.id && node.operation === "revolve");
rationalNode.parameters.curveSegments = [{ kind: "nurbs", poles: rationalNode.parameters.profile.filter((point) => point.xMm > 0).map(({ xMm, zMm }) => ({ xMm, zMm })), degree: 3, weights: rationalNode.parameters.profile.filter((point) => point.xMm > 0).map(() => 1), knots: [0, 1], multiplicities: [4, rationalNode.parameters.profile.filter((point) => point.xMm > 0).length - 4] }];
const rationalFit = fitCompiledAssemblyContour(rationalCompiledGraph, compiledPreflight, compiledEvidence, "compiled-primary");
const rationalSegment = rationalFit.graph.nodes.find((node) => node.id === rationalNode.id).parameters.curveSegments[0];
assert.equal(rationalSegment.kind, "nurbs", "compiled fitting must preserve an approved NURBS representation");
assert.equal(rationalSegment.degree, 3, "compiled fitting must preserve NURBS degree and therefore curve continuity intent");
assert.equal(rationalSegment.poles.length, rationalNode.parameters.curveSegments[0].poles.length, "compiled fitting must adjust declared poles rather than recreate an approximate curve");
const mixedCompiledGraph = structuredClone(compiledGraph);
const secondaryComponent = structuredClone(mixedCompiledGraph.components[0]);
secondaryComponent.id = "small-auxiliary"; secondaryComponent.requestedName = "auxiliary"; secondaryComponent.nodeIds = []; secondaryComponent.rootNodeIds = [];
mixedCompiledGraph.components.push(secondaryComponent);
const mixedPreflight = { diagnostics: [...compiledPreflight.diagnostics, { componentId: secondaryComponent.id, code: "ok", boundsMm: { x: 12, y: 12, z: 6 }, transform: secondaryComponent.transform, material: secondaryComponent.material, silhouette: Array.from({ length: 16 }, (_, index) => ({ zNorm: index / 15, radiusNorm: 1 })) }] };
const mixedFit = fitCompiledAssemblyContour(mixedCompiledGraph, mixedPreflight, compiledEvidence, "compiled-primary");
assert.deepEqual(mixedFit.adjustments.map((item) => item.componentId), [compiledComponent.id], "a global silhouette residual must not rewrite smaller overlapping components without their own evidence scope");

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
