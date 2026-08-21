import assert from "node:assert/strict";
import {
  analyseDraft,
  compileApprovedDraftToModelingSpec,
  draftAnalysisJsonSchema,
  draftPayloadSchema,
  draftReady,
  normaliseComponentInput,
  normaliseAxisymmetricCavityFeatures,
  applyQuestionValue,
  responseJson,
} from "./modeling-spec.mjs";
import { ANALYSIS_OPERATIONS, applyModelingPatch, canonicalizeGraph, fixtureGraphOutput, graphHash, graphSketchPlan, modelingComponentRepairJsonSchema, modelingGraphJsonSchema, modelingPatchJsonSchema, validateGraph, valueHash } from "./modeling-graph.mjs";
import { monotoneBezierSegments } from "./image-evidence.mjs";

process.env.NET30_MODELING_DRAFT_FIXTURE = "true";
process.env.NET30_OPENAI_MODEL = "fixture";
process.env.NET30_OPENAI_MODELS = "fixture";

assert.deepEqual(normaliseComponentInput(" 유리병, 뚜껑 , 밀봉 라이너 "), ["유리병", "뚜껑", "밀봉 라이너"]);
assert.throws(() => normaliseComponentInput("뚜껑, 뚜껑"), /중복/);
const analysisSchema = draftAnalysisJsonSchema();
const componentOutput = analysisSchema.properties.components.items;
assert.equal("requestedName" in componentOutput.properties, false);
assert.deepEqual([...componentOutput.required].sort(), Object.keys(componentOutput.properties).sort());
function auditStrictSchema(schema, path = "root") {
  if (!schema || typeof schema !== "object") return;
  if (schema.properties) { assert.equal(schema.additionalProperties, false, `${path} must reject extra properties`); assert.deepEqual([...(schema.required ?? [])].sort(), Object.keys(schema.properties).sort(), `${path} must require every property`); }
  // Responses Structured Outputs accepts a single object/boolean `items`
  // schema, not JSON Schema draft-7 tuple arrays. This is easy to regress
  // when modelling a fixed number of points, so audit every outbound schema.
  assert.equal(Array.isArray(schema.items), false, `${path}.items must not use a tuple schema`);
  assert.equal("oneOf" in schema, false, `${path} must use anyOf rather than oneOf for Responses Structured Outputs`);
  for (const [key, value] of Object.entries(schema)) if (key !== "$defs") Array.isArray(value) ? value.forEach((item, index) => auditStrictSchema(item, `${path}.${key}[${index}]`)) : auditStrictSchema(value, `${path}.${key}`);
  for (const [key, value] of Object.entries(schema.$defs ?? {})) auditStrictSchema(value, `${path}.$defs.${key}`);
}
auditStrictSchema(modelingGraphJsonSchema());
auditStrictSchema(modelingComponentRepairJsonSchema());
auditStrictSchema(modelingPatchJsonSchema());
assert.equal(ANALYSIS_OPERATIONS.includes("fillet"), false);
const boundedBezier = monotoneBezierSegments([
  { xMm: 20, zMm: 0 },
  { xMm: 8, zMm: 10 },
  { xMm: 24, zMm: 20 },
]);
for (const segment of boundedBezier) {
  const [start, startHandle, endHandle, end] = segment.points;
  const lower = Math.min(start.xMm, end.xMm); const upper = Math.max(start.xMm, end.xMm);
  assert.ok(startHandle.xMm >= lower && startHandle.xMm <= upper, "a fitted Bézier start handle must remain within measured radial bounds");
  assert.ok(endHandle.xMm >= lower && endHandle.xMm <= upper, "a fitted Bézier end handle must remain within measured radial bounds");
}
const strictFeatureOperations = modelingGraphJsonSchema().properties.components.items.properties.features.items.anyOf.map((variant) => variant.properties.operation.const);
assert.equal(strictFeatureOperations.includes("fillet"), false);
assert.equal(strictFeatureOperations.includes("boolean"), true);

const originalApiKey = process.env.OPENAI_API_KEY;
process.env.OPENAI_API_KEY = "test-key";
const backgroundRequests = [];
const completedGraph = JSON.stringify(fixtureGraphOutput({ product: { name: "background" }, prompt: "test", requestedComponents: ["병"], imageIds: [] }));
const backgroundResult = await responseJson({ model: "fixture", instructions: "test", input: "test", schema: modelingGraphJsonSchema(), name: "background_test" }, {
  pollIntervalMs: 0,
  sleep: async () => undefined,
  fetchImpl: async (url, options = {}) => {
    backgroundRequests.push({ url, options });
    const body = options.method === "POST" ? { id: "resp-test", status: "in_progress" } : { id: "resp-test", status: "completed", output_text: completedGraph };
    return { ok: true, status: 200, json: async () => body };
  },
});
assert.equal(backgroundResult.product.name, "background");
assert.equal(backgroundResult.components.length, 1);
assert.equal(backgroundRequests.length, 2);
assert.equal(JSON.parse(backgroundRequests[0].options.body).background, true);
assert.match(backgroundRequests[1].url, /\/responses\/resp-test$/);
await assert.rejects(() => responseJson({ model: "fixture", instructions: "test", input: "test", schema: modelingGraphJsonSchema(), name: "failed_test" }, {
  pollIntervalMs: 0,
  sleep: async () => undefined,
  fetchImpl: async (_url, options = {}) => ({ ok: true, status: 200, json: async () => options.method === "POST" ? { id: "resp-failed", status: "in_progress" } : { id: "resp-failed", status: "failed", error: { code: "server_error", message: "generation failed" } } }),
}), (error) => error.responseId === "resp-failed" && /generation failed/.test(error.message));
if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalApiKey;

const input = draftPayloadSchema.parse({
  version: "net30.modeling-draft.v4",
  model: "fixture",
  product: { source: "new", name: "단일 뚜껑 검증" },
  componentInput: "뚜껑",
  prompt: "외경 54 mm, 높이 25 mm의 리브 뚜껑",
  imageIds: [],
  skuId: "all-in-one-pilot",
});
assert.equal(draftPayloadSchema.parse({ version: "net30.modeling-draft.v7", operation: "create-parent", model: "fixture", product: { source: "new", name: "새 부모" }, componentInput: "유리병", prompt: "유리병" }).operation, "create-parent");
assert.throws(() => draftPayloadSchema.parse({ version: "net30.modeling-draft.v7", operation: "create-parent", model: "fixture", parentModelId: "parent", product: { source: "new", name: "새 부모" }, componentInput: "유리병", prompt: "유리병" }), /새 부모 생성/);
const analysis = await analyseDraft(input, []);
assert.deepEqual(analysis.components.map((component) => component.displayName), ["뚜껑"]);
const draft = {
  id: "fixture",
  revision: 1,
  state: "awaiting_parameter_review",
  input,
  product: analysis.product,
  components: analysis.components,
  modelingGraph: analysis.modelingGraph,
  modelingGraphHash: analysis.modelingGraphHash,
  questions: analysis.questions.map((question) => ({ ...question, status: "accepted", userValue: question.recommendedValue })),
  stickerSlots: analysis.stickerSlots,
};
assert.equal(draftReady(draft).ready, true);
draft.state = "failed";
assert.equal(draftReady(draft).ready, true, "an approved draft remains retryable after a Blender failure");
draft.state = "awaiting_parameter_review";
const spec = compileApprovedDraftToModelingSpec(draft);
assert.deepEqual(spec.components.map((component) => component.componentInstanceId), [analysis.components[0].id]);
assert.deepEqual(spec.components.map((component) => component.version), ["net30.graph-component-spec.v1"], "a graph-backed draft must not be reconstructed as a fixed bottle/cap recipe");
const printInput = draftPayloadSchema.parse({ ...input, componentInput: "유리병, 전면 인쇄", prompt: "병 전면의 흰 눈금과 로고를 이미지 crop으로 인쇄", imageIds: ["11111111-1111-4111-8111-111111111111"] });
// A dynamic print is permitted only when an actual evidence image is scoped
// for artwork. Keep this separate from the no-image cap fixture above so the
// test exercises the same EvidenceManifest gate used in production.
const printAnalysis = await analyseDraft(printInput, [{
  id: "11111111-1111-4111-8111-111111111111",
  filename: "Duran laboratory bottles 100.jpg",
  mimeType: "image/jpeg",
  dataUrl: "data:image/jpeg;base64,AA==",
}]);
const printDraft = { ...draft, input: printInput, product: printAnalysis.product, components: printAnalysis.components, modelingGraph: printAnalysis.modelingGraph, modelingGraphHash: printAnalysis.modelingGraphHash, questions: printAnalysis.questions.map((question) => ({ ...question, status: "accepted", userValue: question.recommendedValue })), stickerSlots: printAnalysis.stickerSlots };
const printSpec = compileApprovedDraftToModelingSpec(printDraft);
assert.equal(printSpec.components.find((component) => component.displayName === "전면 인쇄")?.representation, "visual_surface", "a user-named front print must remain a graph surface instead of becoming a fixed recipe");
assert.ok(printSpec.components.every((component) => component.version === "net30.graph-component-spec.v1"));
const workingDraft = structuredClone(draft);
const widthQuestion = workingDraft.questions.find((question) => question.path === "product.dimensionsMm.widthMm");
const graphHashBeforeDimensionOverride = workingDraft.modelingGraphHash;
applyQuestionValue(workingDraft, widthQuestion, 70);
assert.equal(workingDraft.product.widthMm, 70, "an approved overall-width override updates the product file immediately");
assert.notEqual(workingDraft.modelingGraphHash, graphHashBeforeDimensionOverride, "an overall assembly dimension override updates the working graph rather than waiting for final build");
const scaledProfile = workingDraft.modelingGraph.nodes.find((node) => node.parameters.profile?.length)?.parameters.profile;
assert.ok(Math.max(...scaledProfile.map((point) => point.xMm)) > Math.max(...analysis.modelingGraph.nodes.find((node) => node.parameters.profile?.length).parameters.profile.map((point) => point.xMm)), "the graph geometry is scaled with the approved assembly dimension");
const printCanonical = canonicalizeGraph(fixtureGraphOutput({ product: { name: "인쇄 병" }, prompt: "사진의 전면 인쇄를 재현", requestedComponents: ["유리병", "전면 인쇄"], imageIds: ["image-1"] }), ["유리병", "전면 인쇄"], ["image-1"]);
const printComponent = printCanonical.graph.components.find((item) => item.requestedName === "전면 인쇄");
const printNode = printCanonical.graph.nodes.find((item) => item.componentId === printComponent.id);
assert.equal(printComponent.representation, "visual_surface");
assert.equal(printNode.operation, "surface_decal");
assert.ok(graphSketchPlan(printCanonical.product, printCanonical.graph).components[0].points.length >= 4);
const incompleteArtworkOutput = fixtureGraphOutput({ product: { name: "부착값 없는 인쇄" }, prompt: "print", requestedComponents: ["body", "front print"], imageIds: ["image-1"] });
incompleteArtworkOutput.components[1].features[0].parameters.dimensionsMm = null;
assert.throws(() => canonicalizeGraph(incompleteArtworkOutput, ["body", "front print"], ["image-1"]), /graph_repair_required: component-2\.surfaceArtworkPlacement/, "a print missing its mm placement must be repaired locally instead of becoming an arbitrary flat band");
const closureWithClearance = fixtureGraphOutput({ product: { name: "내부 clearance 뚜껑" }, prompt: "hollow closure", requestedComponents: ["뚜껑"], imageIds: [] });
const closureBase = closureWithClearance.components[0].features[0];
const clearanceTool = { ...structuredClone(closureBase), key: "closure-clearance", operation: "primitive", inputKeys: [], parameters: { ...structuredClone(closureBase.parameters), primitive: "cylinder", profile: null, curveSegments: null, dimensionsMm: null, radiusMm: 12, heightMm: 18, transform: { translationMm: { x: 0, y: 0, z: 1 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } } };
const clearanceCut = { ...structuredClone(closureBase), key: "closure-final-cut", operation: "boolean", inputKeys: [closureBase.key, clearanceTool.key], parameters: { ...structuredClone(closureBase.parameters), primitive: null, profile: null, curveSegments: null, dimensionsMm: null, radiusMm: null, heightMm: null, transform: null, operation: "cut" } };
closureWithClearance.components[0].features = [closureBase, clearanceTool, clearanceCut];
assert.doesNotThrow(() => canonicalizeGraph(closureWithClearance, ["뚜껑"], []), "a contained cylindrical clearance must be validated by the host profile rather than forcing an LLM repair");
const preCurveFieldResponse = fixtureGraphOutput({ product: { name: "기존 응답" }, prompt: "compatibility", requestedComponents: ["유리병"], imageIds: [] });
delete preCurveFieldResponse.components[0].features[0].parameters.curveSegments;
assert.doesNotThrow(() => canonicalizeGraph(preCurveFieldResponse, ["유리병"], []), "stored responses from before curveSegments must remain refinable");
const legacyGraph = structuredClone(printCanonical.graph);
for (const node of legacyGraph.nodes) delete node.parameters.curveSegments;
assert.doesNotThrow(() => validateGraph(legacyGraph), "legacy stored graphs without the additive curve field remain refinable");
assert.match(graphHash(legacyGraph), /^[a-f0-9]{64}$/, "legacy graph compatibility must produce a deterministic working hash");
const selfHostedLegacyGraph = structuredClone(legacyGraph);
selfHostedLegacyGraph.components[0].hostComponentId = selfHostedLegacyGraph.components[0].id;
selfHostedLegacyGraph.nodes.filter((node) => node.componentId === selfHostedLegacyGraph.components[0].id).forEach((node) => { node.parameters.hostComponentKey = selfHostedLegacyGraph.components[0].id; });
assert.equal(validateGraph(selfHostedLegacyGraph).components[0].hostComponentId, null, "a legacy B-Rep self-host marker must not block a rebuild when no surface attachment needs that host");
const nodeHostedPrint = fixtureGraphOutput({ product: { name: "노드 host 인쇄" }, prompt: "test", requestedComponents: ["유리병", "전면 인쇄"], imageIds: ["image-1"] });
nodeHostedPrint.components[1].hostComponentKey = null;
const nodeHostedCanonical = canonicalizeGraph(nodeHostedPrint, ["유리병", "전면 인쇄"], ["image-1"]);
assert.equal(nodeHostedCanonical.graph.components[1].hostComponentId, nodeHostedCanonical.graph.components[0].id);
const modifierOutput = fixtureGraphOutput({ product: { name: "수정자 병" }, prompt: "test", requestedComponents: ["유리병"], imageIds: [] });
const modifierBase = modifierOutput.components[0].features[0]; modifierBase.key = "body-revolve"; modifierBase.parameters.thicknessMm = null;
const shellFeature = { ...structuredClone(modifierBase), key: "body-shell", operation: "shell", inputKeys: [modifierBase.key], parameters: { ...modifierBase.parameters, profile: null, thicknessMm: 2.6 } };
modifierOutput.components[0].features = [modifierBase, shellFeature];
const normalizedModifier = canonicalizeGraph(modifierOutput, ["유리병"], []);
assert.deepEqual(normalizedModifier.graph.nodes.map((node) => node.operation), ["revolve", "shell"]);
assert.equal(normalizedModifier.graph.nodes[1].parameters.thicknessMm, 2.6);
assert.equal(normalizedModifier.graph.nodes[1].inputNodeIds[0], normalizedModifier.graph.nodes[0].id);
const orphanRibOutput = fixtureGraphOutput({ product: { name: "리브 캡" }, prompt: "리브", requestedComponents: ["뚜껑"], imageIds: [] });
orphanRibOutput.components[0].features = [{ ...orphanRibOutput.components[0].features[0], key: "cap-rib", operation: "rib", inputKeys: [], parameters: { ...orphanRibOutput.components[0].features[0].parameters, profile: null } }];
assert.throws(() => canonicalizeGraph(orphanRibOutput, ["뚜껑"], []), /Too small: expected array to have >=1 items/, "strict output schema rejects a rib without its base before graph compilation");
const incompleteRibOutput = fixtureGraphOutput({ product: { name: "불완전 리브 캡" }, prompt: "rib", requestedComponents: ["뚜껑"], imageIds: [] });
const ribBase = incompleteRibOutput.components[0].features[0];
incompleteRibOutput.components[0].features = [
  ribBase,
  { ...structuredClone(ribBase), key: "missing-rib-values", operation: "rib", inputKeys: [ribBase.key], parameters: { ...ribBase.parameters, profile: null, count: null, spacingMm: null, depthMm: null, thicknessMm: null, heightMm: null } },
];
assert.throws(() => canonicalizeGraph(incompleteRibOutput, ["뚜껑"], []), /graph_repair_required: component-1\.rib\.spacingMm\+depthMm\+heightMm/);
const modifierOnlyOutput = fixtureGraphOutput({ product: { name: "리브만 있는 임의 부품" }, prompt: "rib", requestedComponents: ["bottle_gl45_100"], imageIds: [] });
modifierOnlyOutput.components[0].features = [{ ...structuredClone(modifierOnlyOutput.components[0].features[0]), key: "orphan-rib", operation: "rib", inputKeys: ["missing-base"], parameters: { ...modifierOnlyOutput.components[0].features[0].parameters, profile: null, heightMm: 12, spacingMm: 2, depthMm: 1 } }];
assert.throws(() => canonicalizeGraph(modifierOnlyOutput, ["bottle_gl45_100"], []), /graph_repair_required: component-1\.generatingFeature/, "a modifier-only component must trigger a local graph repair instead of an opaque unsupported-operation failure");
const incompleteBooleanOutput = fixtureGraphOutput({ product: { name: "불완전 절단" }, prompt: "cut", requestedComponents: ["유리병"], imageIds: [] });
const booleanBase = incompleteBooleanOutput.components[0].features[0];
incompleteBooleanOutput.components[0].features.push({ ...structuredClone(booleanBase), key: "incomplete-cut", operation: "boolean", inputKeys: [booleanBase.key], parameters: { ...booleanBase.parameters, profile: null, operation: "cut" } });
assert.throws(() => canonicalizeGraph(incompleteBooleanOutput, ["유리병"], []), /Too small: expected array to have >=2 items/, "strict output schema rejects a Boolean without both operands");
const coplanarCavityOutput = fixtureGraphOutput({ product: { name: "모호한 cavity" }, prompt: "cap cavity", requestedComponents: ["뚜껑"], imageIds: [] });
const outerCap = { ...structuredClone(coplanarCavityOutput.components[0].features[0]), key: "cap-outer", operation: "primitive", inputKeys: [], parameters: { ...coplanarCavityOutput.components[0].features[0].parameters, profile: null, primitive: "cylinder", radiusMm: 27, heightMm: 24 } };
const ambiguousCut = { ...structuredClone(outerCap), key: "cap-cavity", operation: "revolve", inputKeys: [], parameters: { ...outerCap.parameters, primitive: null, radiusMm: null, heightMm: null, profile: [{ xMm: 0, yMm: 0, zMm: 1 }, { xMm: 22, yMm: 0, zMm: 1 }, { xMm: 22, yMm: 0, zMm: 24 }, { xMm: 0, yMm: 0, zMm: 24 }], operation: null } };
const ambiguousBoolean = { ...structuredClone(outerCap), key: "cap-cavity-cut", operation: "boolean", inputKeys: [outerCap.key, ambiguousCut.key], parameters: { ...outerCap.parameters, primitive: null, profile: null, operation: "cut" } };
coplanarCavityOutput.components[0].features = [outerCap, ambiguousCut, ambiguousBoolean];
assert.throws(() => canonicalizeGraph(coplanarCavityOutput, ["뚜껑"], []), /graph_repair_required: component-1\.boolean\.cutContainment/);
const crossingCavityOutput = fixtureGraphOutput({ product: { name: "관통 cavity" }, prompt: "bottle cavity", requestedComponents: ["유리병"], imageIds: [] });
const outerBottle = { ...structuredClone(crossingCavityOutput.components[0].features[0]), key: "outer-bottle" };
const crossingInner = { ...structuredClone(outerBottle), key: "crossing-inner", parameters: { ...outerBottle.parameters, profile: [{ xMm: 0, yMm: 0, zMm: 0 }, { xMm: 30, yMm: 0, zMm: 0 }, { xMm: 30, yMm: 0, zMm: 100 }, { xMm: 0, yMm: 0, zMm: 100 }] } };
const crossingBoolean = { ...structuredClone(outerBottle), key: "final-cut", operation: "boolean", inputKeys: [outerBottle.key, crossingInner.key], parameters: { ...outerBottle.parameters, profile: null, operation: "cut" } };
crossingCavityOutput.components[0].features = [outerBottle, crossingInner, crossingBoolean];
assert.throws(() => canonicalizeGraph(crossingCavityOutput, ["유리병"], []), /graph_repair_required: component-1\.boolean\.cavityWithinOuter/);
const measuredCavityOutput = fixtureGraphOutput({ product: { name: "측정 공동" }, prompt: "measured bottle cavity", requestedComponents: ["유리병"], imageIds: [] });
const measuredOuter = { ...structuredClone(measuredCavityOutput.components[0].features[0]), key: "measured-outer", inputKeys: [], parameters: { ...measuredCavityOutput.components[0].features[0].parameters, profile: [{ xMm: 0, yMm: 0, zMm: 0 }, { xMm: 30, yMm: 0, zMm: 0 }, { xMm: 30, yMm: 0, zMm: 100 }, { xMm: 0, yMm: 0, zMm: 100 }] } };
const measuredInner = { ...structuredClone(measuredOuter), key: "measured-inner", parameters: { ...measuredOuter.parameters, profile: [{ xMm: 0, yMm: 0, zMm: 3 }, { xMm: 26, yMm: 0, zMm: 3 }, { xMm: 26, yMm: 0, zMm: 50 }, { xMm: 25, yMm: 0, zMm: 96 }, { xMm: 0, yMm: 0, zMm: 96 }] } };
const measuredCut = { ...structuredClone(measuredOuter), key: "measured-cavity-cut", operation: "boolean", inputKeys: [measuredOuter.key, measuredInner.key], parameters: { ...measuredOuter.parameters, profile: null, operation: "cut" } };
measuredCavityOutput.components[0].features = [measuredOuter, measuredInner, measuredCut];
const measuredCavity = normaliseAxisymmetricCavityFeatures(measuredCavityOutput);
assert.equal(measuredCavity.converted, 1);
assert.deepEqual(measuredCavity.raw.components[0].features.map((feature) => feature.operation), ["revolve", "shell"]);
assert.doesNotThrow(() => canonicalizeGraph(measuredCavity.raw, ["유리병"], []));
const shallowAnnulusOutput = fixtureGraphOutput({ product: { name: "얕은 환형 링" }, prompt: "annular ring", requestedComponents: ["링"], imageIds: [] });
const annulusOuter = { ...structuredClone(shallowAnnulusOutput.components[0].features[0]), key: "annulus-outer", inputKeys: [], parameters: { ...shallowAnnulusOutput.components[0].features[0].parameters, profile: [{ xMm: 0, yMm: 0, zMm: 0 }, { xMm: 30, yMm: 0, zMm: 0 }, { xMm: 30, yMm: 0, zMm: 8 }, { xMm: 0, yMm: 0, zMm: 8 }] } };
const annulusInner = { ...structuredClone(annulusOuter), key: "annulus-inner", parameters: { ...annulusOuter.parameters, profile: [{ xMm: 0, yMm: 0, zMm: 1 }, { xMm: 15, yMm: 0, zMm: 1 }, { xMm: 15, yMm: 0, zMm: 7 }, { xMm: 0, yMm: 0, zMm: 7 }] } };
const annulusCut = { ...structuredClone(annulusOuter), key: "annulus-cut", operation: "boolean", inputKeys: [annulusOuter.key, annulusInner.key], parameters: { ...annulusOuter.parameters, profile: null, operation: "cut" } };
shallowAnnulusOutput.components[0].features = [annulusOuter, annulusInner, annulusCut];
const shallowAnnulus = normaliseAxisymmetricCavityFeatures(shallowAnnulusOutput);
assert.equal(shallowAnnulus.converted, 0, "a shallow annular Boolean remains an explicit through-hole instead of an invalid vessel shell");
assert.equal(shallowAnnulus.raw.components[0].features.at(-1).operation, "boolean");
const reversedCutOutput = fixtureGraphOutput({ product: { name: "역전 cut" }, prompt: "cut", requestedComponents: ["마개"], imageIds: [] });
const smallBase = { ...structuredClone(reversedCutOutput.components[0].features[0]), key: "small-base", operation: "primitive", inputKeys: [], parameters: { ...reversedCutOutput.components[0].features[0].parameters, profile: null, primitive: "cylinder", radiusMm: 18, heightMm: 20, dimensionsMm: null } };
const largerCutter = { ...structuredClone(smallBase), key: "larger-cutter", parameters: { ...smallBase.parameters, radiusMm: 22 } };
const reversedCut = { ...structuredClone(smallBase), key: "reversed-cut", operation: "boolean", inputKeys: [smallBase.key, largerCutter.key], parameters: { ...smallBase.parameters, primitive: null, radiusMm: null, heightMm: null, operation: "cut" } };
reversedCutOutput.components[0].features = [smallBase, largerCutter, reversedCut];
assert.throws(() => canonicalizeGraph(reversedCutOutput, ["마개"], []), /graph_repair_required: component-1\.boolean\.cutContainment/);
const mouthOpeningOutput = fixtureGraphOutput({ product: { name: "상부 개구 병" }, prompt: "open mouth", requestedComponents: ["유리병"], imageIds: [] });
const mouthOuter = structuredClone(mouthOpeningOutput.components[0].features[0]); mouthOuter.key = "outer-vessel";
mouthOuter.parameters = { ...mouthOuter.parameters, profile: [{ xMm: 0, yMm: 0, zMm: 0 }, { xMm: 28, yMm: 0, zMm: 0 }, { xMm: 28, yMm: 95, zMm: 0 }, { xMm: 14, yMm: 100, zMm: 0 }, { xMm: 0, yMm: 100, zMm: 0 }] };
const mouthCutter = { ...structuredClone(mouthOuter), key: "mouth-cutter", operation: "primitive", inputKeys: [], parameters: { ...mouthOuter.parameters, profile: null, primitive: "cylinder", radiusMm: 10, heightMm: 15, dimensionsMm: null, transform: { translationMm: { x: 0, y: 90, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } } };
const mouthCut = { ...structuredClone(mouthOuter), key: "open-mouth", operation: "boolean", inputKeys: [mouthOuter.key, mouthCutter.key], parameters: { ...mouthOuter.parameters, profile: null, primitive: null, operation: "cut" } };
mouthOpeningOutput.components[0].features = [mouthOuter, mouthCutter, mouthCut];
const normalizedMouth = canonicalizeGraph(mouthOpeningOutput, ["유리병"], []);
assert.equal(normalizedMouth.graph.nodes.find((node) => node.id === normalizedMouth.graph.nodes.find((node) => node.operation === "primitive")?.id)?.parameters.transform.translationMm.z, 90, "a Y-axis visual plan must move its mouth cutter into canonical Z");
const openRevolveOutput = fixtureGraphOutput({ product: { name: "열린 회전 단면" }, prompt: "cap", requestedComponents: ["뚜껑"], imageIds: [] });
openRevolveOutput.components[0].features[0].parameters.profile = [{ xMm: 20, yMm: 0, zMm: 0 }, { xMm: 22, yMm: 0, zMm: 1 }, { xMm: 20, yMm: 0, zMm: 2 }];
assert.throws(() => canonicalizeGraph(openRevolveOutput, ["뚜껑"], []), /graph_repair_required: component-1\.revolve\.closedProfile/);
const selfHostedOutput = fixtureGraphOutput({ product: { name: "자기 부착 인쇄" }, prompt: "self host", requestedComponents: ["유리병"], imageIds: [] });
selfHostedOutput.components[0].hostComponentKey = selfHostedOutput.components[0].componentKey;
assert.equal(canonicalizeGraph(selfHostedOutput, ["유리병"], []).graph.components[0].hostComponentId, null, "a non-surface solid self-host is canonicalized to no host");
const selfHostedDecalOutput = fixtureGraphOutput({ product: { name: "자기 부착 인쇄" }, prompt: "self host", requestedComponents: ["유리병", "전면 인쇄"], imageIds: ["image-1"] });
selfHostedDecalOutput.components[1].hostComponentKey = selfHostedDecalOutput.components[1].componentKey;
selfHostedDecalOutput.components[1].features[0].parameters.hostComponentKey = selfHostedDecalOutput.components[1].componentKey;
assert.throws(() => canonicalizeGraph(selfHostedDecalOutput, ["유리병", "전면 인쇄"], ["image-1"]), /graph_repair_required: component-2\.hostComponentKey/);
const disconnectedRootsOutput = fixtureGraphOutput({ product: { name: "분리 루트 캡" }, prompt: "리브", requestedComponents: ["뚜껑"], imageIds: [] });
const secondRoot = structuredClone(disconnectedRootsOutput.components[0].features[0]);
secondRoot.key = "cap-second-root";
secondRoot.parameters = { ...secondRoot.parameters, profile: secondRoot.parameters.profile.map((point) => ({ ...point, zMm: point.zMm + 1 })) };
disconnectedRootsOutput.components[0].features.push(secondRoot);
assert.throws(() => canonicalizeGraph(disconnectedRootsOutput, ["뚜껑"], []), /graph_repair_required: component-1\.rootTopology/);
const invalidPatternOutput = fixtureGraphOutput({ product: { name: "잘못된 cap pattern" }, prompt: "rib", requestedComponents: ["뚜껑"], imageIds: [] });
const patternBase = invalidPatternOutput.components[0].features[0];
invalidPatternOutput.components[0].features = [
  patternBase,
  { ...structuredClone(patternBase), key: "invalid-whole-cap-pattern", operation: "pattern", inputKeys: [patternBase.key], parameters: { ...patternBase.parameters, profile: null, count: 36 } },
];
assert.throws(() => canonicalizeGraph(invalidPatternOutput, ["뚜껑"], []), /Too small: expected array to have >=2 items/, "strict output schema rejects a pattern without base and seed");
const assemblyPlacement = fixtureGraphOutput({ product: { name: "조립 배치", widthMm: 56, heightMm: 120, depthMm: 56 }, prompt: "test", requestedComponents: ["몸체", "마개", "밀봉 링"], imageIds: [] });
assemblyPlacement.product.heightMm = 120;
assemblyPlacement.components[0].features[0].parameters.profile = [{ xMm: 0, yMm: 0, zMm: 0 }, { xMm: 28, yMm: 0, zMm: 0 }, { xMm: 28, yMm: 105, zMm: 0 }, { xMm: 0, yMm: 105, zMm: 0 }];
assemblyPlacement.components[1].features = [{ ...structuredClone(assemblyPlacement.components[1].features[0]), key: "cap", operation: "primitive", inputKeys: [], parameters: { ...assemblyPlacement.components[1].features[0].parameters, profile: null, primitive: "cylinder", radiusMm: 27, heightMm: 24, dimensionsMm: null, transform: { translationMm: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } } }];
assemblyPlacement.components[2].features[0].parameters.profile = [{ xMm: 22, yMm: -.5, zMm: 0 }, { xMm: 26, yMm: -.5, zMm: 0 }, { xMm: 26, yMm: 3, zMm: 0 }, { xMm: 22, yMm: 3, zMm: 0 }];
assemblyPlacement.interfaces = [{ key: "thread", componentKeys: [assemblyPlacement.components[0].componentKey, assemblyPlacement.components[1].componentKey], kind: "thread", clearanceMm: .3, rationale: "thread" }, { key: "seal", componentKeys: [assemblyPlacement.components[0].componentKey, assemblyPlacement.components[2].componentKey], kind: "seal", clearanceMm: .2, rationale: "seal" }];
const placedAssembly = canonicalizeGraph(assemblyPlacement, ["몸체", "마개", "밀봉 링"], []);
assert.equal(placedAssembly.graph.nodes.find((node) => node.parameters.profile)?.parameters.profile.at(-1).zMm, 105, "the varying y ordinate must become canonical XZ");
assert.equal(placedAssembly.graph.components[1].transform.translationMm.z, 96, "threaded cap local datum must align its top with assembly height");
assert.equal(placedAssembly.graph.components[2].transform.translationMm.z, 93, "seal must sit directly below the threaded closure envelope");
const inferredAssembly = structuredClone(assemblyPlacement);
inferredAssembly.interfaces = [];
const inferredPlacement = canonicalizeGraph(inferredAssembly, ["몸체", "마개", "밀봉 링"], []).graph;
assert.equal(inferredPlacement.components[1].transform.translationMm.z, 81, "unmated concentric children receive one provisional datum below the tallest child rather than exporting at z=0");
assert.equal(inferredPlacement.components[2].transform.translationMm.z, 81.5, "the provisional datum preserves each child’s component-local geometry");
assert.throws(() => validateGraph({ ...printCanonical.graph, nodes: [{ ...printCanonical.graph.nodes[0], operation: "eval" }] }), /지원하지 않는|Invalid/);
const patched = applyModelingPatch(printCanonical.graph, { version: "net30.modeling-patch.v1", baseGraphHash: printCanonical.graphHash, scope: { stage: "material_surface", componentIds: [printComponent.id] }, changes: [{ op: "set_parameter", nodeId: printNode.id, field: "wrapDegrees", expectedValueHash: valueHash(printNode.parameters.wrapDegrees), value: 120, rationale: "사진의 감김 범위" }] });
assert.equal(patched.graph.nodes.find((item) => item.id === printNode.id).parameters.wrapDegrees, 120);
console.log("Modeling v4 proof passed: requested component normalization and approved cap-only spec.");
