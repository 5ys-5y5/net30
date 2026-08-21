import assert from "node:assert/strict";
import {
  analyseDraft,
  compileApprovedDraftToModelingSpec,
  draftAnalysisJsonSchema,
  draftPayloadSchema,
  draftReady,
  normaliseComponentInput,
  responseJson,
} from "./modeling-spec.mjs";
import { applyModelingPatch, canonicalizeGraph, fixtureGraphOutput, graphSketchPlan, modelingGraphJsonSchema, modelingPatchJsonSchema, validateGraph, valueHash } from "./modeling-graph.mjs";

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
  for (const [key, value] of Object.entries(schema)) if (key !== "$defs") Array.isArray(value) ? value.forEach((item, index) => auditStrictSchema(item, `${path}.${key}[${index}]`)) : auditStrictSchema(value, `${path}.${key}`);
  for (const [key, value] of Object.entries(schema.$defs ?? {})) auditStrictSchema(value, `${path}.$defs.${key}`);
}
auditStrictSchema(modelingGraphJsonSchema());
auditStrictSchema(modelingPatchJsonSchema());

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
const spec = compileApprovedDraftToModelingSpec(draft);
assert.deepEqual(spec.components.map((component) => component.component), ["cap"]);
assert.deepEqual(spec.components.map((component) => component.componentInstanceId), [analysis.components[0].id]);
const printCanonical = canonicalizeGraph(fixtureGraphOutput({ product: { name: "인쇄 병" }, prompt: "사진의 전면 인쇄를 재현", requestedComponents: ["유리병", "전면 인쇄"], imageIds: ["image-1"] }), ["유리병", "전면 인쇄"], ["image-1"]);
const printComponent = printCanonical.graph.components.find((item) => item.requestedName === "전면 인쇄");
const printNode = printCanonical.graph.nodes.find((item) => item.componentId === printComponent.id);
assert.equal(printComponent.representation, "visual_surface");
assert.equal(printNode.operation, "surface_decal");
assert.ok(graphSketchPlan(printCanonical.product, printCanonical.graph).components[0].points.length >= 4);
assert.throws(() => validateGraph({ ...printCanonical.graph, nodes: [{ ...printCanonical.graph.nodes[0], operation: "eval" }] }), /지원하지 않는|Invalid/);
const patched = applyModelingPatch(printCanonical.graph, { version: "net30.modeling-patch.v1", baseGraphHash: printCanonical.graphHash, scope: { stage: "material_surface", componentIds: [printComponent.id] }, changes: [{ op: "set_parameter", nodeId: printNode.id, field: "wrapDegrees", expectedValueHash: valueHash(printNode.parameters.wrapDegrees), value: 120, rationale: "사진의 감김 범위" }] });
assert.equal(patched.graph.nodes.find((item) => item.id === printNode.id).parameters.wrapDegrees, 120);
console.log("Modeling v4 proof passed: requested component normalization and approved cap-only spec.");
