import { z } from "zod";

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/).catch("#2d5fc4");

export const modelingSpecSchema = z.object({
  version: z.literal("net30.modeling-spec.v1"),
  summary: z.string().min(1).max(480),
  silhouette: z.enum(["cylindrical", "short-wide", "tall-slim", "ribbed", "custom"]),
  dimensionsMm: z.object({ width: z.number().min(10).max(500), height: z.number().min(10).max(800), depth: z.number().min(10).max(500), wall: z.number().min(0.5).max(30) }),
  materials: z.object({ body: z.enum(["glass", "opaque-plastic", "paper", "custom"]), cap: z.enum(["opaque-plastic", "metal", "glass", "custom"]), bodyColor: colorSchema, capColor: colorSchema, labelColor: colorSchema, finish: z.string().min(1).max(80) }),
  parts: z.object({ neckRatio: z.number().min(0.25).max(0.9), capRatio: z.number().min(0.08).max(0.3), labelRatio: z.number().min(0.1).max(0.75), ribbedCap: z.boolean(), shoulder: z.enum(["flat", "soft", "rounded"]), labelText: z.string().max(80) }),
  camera: z.object({ yawDegrees: z.number().min(-180).max(180), elevationDegrees: z.number().min(-45).max(45) }),
});

export function openAiModels() {
  const fallback = (process.env.NET30_OPENAI_MODEL ?? "").trim();
  const configured = (process.env.NET30_OPENAI_MODELS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  return [...new Set(configured.length ? configured : fallback ? [fallback] : [])];
}

export function defaultOpenAiModel() {
  return openAiModels()[0] ?? "";
}

export function modelingSpecJsonSchema() {
  return z.toJSONSchema(modelingSpecSchema, { target: "draft-7" });
}

function fallbackSpec(payload) {
  const settings = payload.settings;
  const width = Number(settings.sizeXmm ?? settings.widthMm ?? 54);
  const depth = Number(settings.sizeYmm ?? settings.depthMm ?? width);
  const height = Number(settings.sizeZmm ?? settings.heightMm ?? 116);
  const wall = Number(settings.shellThicknessMm ?? settings.thicknessMm ?? 2.4);
  const shape = ["cylindrical", "short-wide", "tall-slim", "ribbed", "custom"].includes(settings.shape) ? settings.shape : "cylindrical";
  const tone = /^#[0-9a-fA-F]{6}$/.test(settings.tone ?? settings.color ?? "") ? settings.tone ?? settings.color : "#2d5fc4";
  return modelingSpecSchema.parse({
    version: "net30.modeling-spec.v1",
    summary: "OpenAI 키가 설정되지 않아 입력값 기반 구조 명세로 생성했습니다.",
    silhouette: shape,
    dimensionsMm: { width, height, depth, wall },
    materials: { body: settings.material === "opaque-plastic" ? "opaque-plastic" : "glass", cap: "opaque-plastic", bodyColor: "#d7e8f6", capColor: tone, labelColor: "#f6f1df", finish: settings.finish ?? "satin" },
    parts: { neckRatio: 0.66, capRatio: 0.16, labelRatio: 0.38, ribbedCap: shape === "ribbed", shoulder: shape === "tall-slim" ? "soft" : "rounded", labelText: "NET30" },
    camera: { yawDegrees: 0, elevationDegrees: 8 },
  });
}

export async function createModelingSpec(payload, imageInputs) {
  const apiKey = (process.env.OPENAI_API_KEY ?? "").trim();
  const model = payload.model || defaultOpenAiModel();
  if (!apiKey || !model) return { spec: fallbackSpec(payload), source: "deterministic-fallback", model: null };
  const allowed = openAiModels();
  if (!allowed.includes(model)) throw new Error("허용되지 않은 OpenAI 모델입니다.");

  const imageParts = imageInputs.map((image) => ({ type: "input_image", image_url: image.dataUrl, detail: "high" }));
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      instructions: "You are NET30's product modeling planner. Convert the user's Korean or English instruction and optional product images into a precise, safe Blender ModelingSpec. Images are optional design input, never a similarity target. Infer only visible, supportable product-packaging features. Return JSON matching the schema exactly; no prose.",
      input: [{ role: "user", content: [{ type: "input_text", text: `Component: ${payload.component}\nPrompt: ${payload.prompt}\nControls: ${JSON.stringify(payload.settings)}` }, ...imageParts] }],
      text: { format: { type: "json_schema", name: "net30_modeling_spec", strict: true, schema: modelingSpecJsonSchema() } },
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message ?? "OpenAI 모델링 분석 요청이 실패했습니다.");
  const output = body.output_text ?? body.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
  if (typeof output !== "string") throw new Error("OpenAI가 ModelingSpec을 반환하지 않았습니다.");
  return { spec: modelingSpecSchema.parse(JSON.parse(output)), source: "openai", model };
}
