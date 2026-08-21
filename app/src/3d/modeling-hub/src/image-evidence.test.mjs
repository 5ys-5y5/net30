import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyseDraft } from "./modeling-spec.mjs";
import { measureImageEvidence } from "./image-evidence.mjs";

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

const analysis = await analyseDraft({
  model: "fixture", product: { source: "new", name: "DURAN GL45 100 mL 실험용 병" },
  requestedComponents: ["유리병", "뚜껑", "푸어링 링", "전면 인쇄"], componentInput: "유리병, 뚜껑, 푸어링 링, 전면 인쇄",
  prompt: "DURAN laboratory bottle", imageIds: inputs.map((item) => item.id),
}, inputs);
assert.equal(analysis.fit.applied, true, "the largest revolved component must use the primary-image fit");
assert.equal(analysis.fit.contour.imageId, "fixture-image-1", "no-cap and PYREX evidence must not replace the primary silhouette");
assert.ok(analysis.fit.contour.rmsMm <= .35, "measured profile must meet the contour fitting gate");
assert.equal(analysis.modelingGraphV3.components[0].curves[0].provenance.source, "image_measurement");
console.log("image evidence measurement and primary silhouette fitting proof passed");
