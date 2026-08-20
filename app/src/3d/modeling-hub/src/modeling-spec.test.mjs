import assert from "node:assert/strict";
import {
  analyseDraft,
  compileApprovedDraftToModelingSpec,
  draftPayloadSchema,
  draftReady,
  normaliseComponentInput,
} from "./modeling-spec.mjs";

process.env.NET30_MODELING_DRAFT_FIXTURE = "true";
process.env.NET30_OPENAI_MODEL = "fixture";
process.env.NET30_OPENAI_MODELS = "fixture";

assert.deepEqual(normaliseComponentInput(" 유리병, 뚜껑 , 밀봉 라이너 "), ["유리병", "뚜껑", "밀봉 라이너"]);
assert.throws(() => normaliseComponentInput("뚜껑, 뚜껑"), /중복/);

const input = draftPayloadSchema.parse({
  version: "net30.modeling-draft.v4",
  model: "fixture",
  product: { source: "new", name: "단일 뚜껑 검증" },
  componentInput: "뚜껑",
  prompt: "외경 54 mm, 높이 25 mm의 리브 뚜껑",
  imageIds: [],
  skuId: "all-in-one-pilot",
});
const analysis = await analyseDraft(input, []);
assert.deepEqual(analysis.components.map((component) => component.displayName), ["뚜껑"]);
const draft = {
  id: "fixture",
  revision: 1,
  state: "awaiting_parameter_review",
  input,
  product: analysis.product,
  components: analysis.components,
  questions: analysis.questions.map((question) => ({ ...question, status: "accepted", userValue: question.recommendedValue })),
  stickerSlots: analysis.stickerSlots,
};
assert.equal(draftReady(draft).ready, true);
const spec = compileApprovedDraftToModelingSpec(draft);
assert.deepEqual(spec.components.map((component) => component.component), ["cap"]);
assert.deepEqual(spec.components.map((component) => component.componentInstanceId), [analysis.components[0].id]);
console.log("Modeling v4 proof passed: requested component normalization and approved cap-only spec.");
