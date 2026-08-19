const MESSAGE_TYPE = "NET30_LABEL_DATA";
const READY_TYPE = "NET30_3D_READY";

const toStringArray = (value) =>
  Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim().length > 0)
    : [];

const validColor = (value) =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

export function normalizeSkuPayload(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const normalized = {};
  for (const key of ["brand", "productName", "subtitle", "dose", "quantity"]) {
    if (typeof source[key] === "string") normalized[key] = source[key];
  }
  if (validColor(source.accentColor)) normalized.accentColor = source.accentColor;
  normalized.koreanLabelLines = toStringArray(source.koreanLabelLines);
  normalized.priceStructureLines = toStringArray(source.priceStructureLines);

  // Optional visual overrides are intentionally isolated under `model` so the
  // existing SKU payload remains compatible with the design-system schema.
  if (source.model && typeof source.model === "object") {
    for (const key of ["capColor", "glassColor", "pillColorA", "pillColorB", "background"]) {
      if (validColor(source.model[key])) normalized[key] = source.model[key];
    }
    for (const key of ["glassAlpha", "pillCount", "labelArc", "labelHeight", "labelY", "labelRotation"]) {
      const numberValue = Number(source.model[key]);
      if (Number.isFinite(numberValue)) normalized[key] = numberValue;
    }
  }
  return normalized;
}

export async function applySkuPayload(model, payload) {
  const normalized = normalizeSkuPayload(payload);
  return model.setState({ ...normalized, labelMode: "sku" });
}

export function attachSkuBridge(model, options = {}) {
  const allowedOrigin = options.allowedOrigin || window.location.origin;
  const onMessage = (event) => {
    if (allowedOrigin !== "*" && event.origin !== allowedOrigin) return;
    const message = event.data;
    if (!message || typeof message !== "object" || message.type !== MESSAGE_TYPE) return;
    applySkuPayload(model, message.payload).catch((error) => {
      model.canvas.dispatchEvent(new CustomEvent("net30-model-error", { detail: error }));
    });
  };
  window.addEventListener("message", onMessage);

  if (window.parent && window.parent !== window) {
    const targetOrigin = allowedOrigin === "*" ? "*" : allowedOrigin;
    window.parent.postMessage({ type: READY_TYPE }, targetOrigin);
  }

  return () => window.removeEventListener("message", onMessage);
}

export const SKU_MESSAGE_TYPE = MESSAGE_TYPE;
export const MODEL_READY_MESSAGE_TYPE = READY_TYPE;
