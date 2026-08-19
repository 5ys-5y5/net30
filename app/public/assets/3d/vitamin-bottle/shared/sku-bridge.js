const MESSAGE_TYPE = "NET30_LABEL_DATA";
const READY_TYPE = "NET30_3D_READY";
const MAX_TEXTURE_DATA_URL_LENGTH = 12 * 1024 * 1024;
const REQUIRED_SOURCE_LABELS = ["한글표시사항", "전체 가격 구조"];
const MAX_TEXTURE_EDGE = 3072;

function isRenderedLabel(value) {
  if (!value || typeof value !== "object") return false;
  if (typeof value.dataUrl !== "string") return false;
  if (!value.dataUrl.startsWith("data:image/png;base64,")) return false;
  if (value.dataUrl.length > MAX_TEXTURE_DATA_URL_LENGTH) return false;
  const width = Number(value.pixelWidth);
  const height = Number(value.pixelHeight);
  if (
    !Number.isFinite(width)
    || !Number.isFinite(height)
    || width < 1
    || height < 1
    || width > MAX_TEXTURE_EDGE
    || height > MAX_TEXTURE_EDGE
  ) return false;
  if (!Array.isArray(value.sourceLabels) || value.sourceLabels.length !== REQUIRED_SOURCE_LABELS.length) return false;
  return REQUIRED_SOURCE_LABELS.every((label, index) => value.sourceLabels[index] === label);
}

export function normalizeSkuPayload(payload) {
  const source = payload && typeof payload === "object" ? payload : null;
  if (!source || typeof source.skuId !== "string" || !source.skuId.trim()) {
    throw new Error("3D 라벨 payload에 SKU ID가 없습니다.");
  }
  if (!isRenderedLabel(source.renderedLabel)) {
    throw new Error("3D 라벨 payload는 실제 ds-label-sticker-sheet PNG 캡처를 포함해야 합니다.");
  }

  return {
    dataUrl: source.renderedLabel.dataUrl,
    sourceId: source.skuId,
    pixelWidth: Number(source.renderedLabel.pixelWidth),
    pixelHeight: Number(source.renderedLabel.pixelHeight),
  };
}

export async function applySkuPayload(model, payload) {
  const normalized = normalizeSkuPayload(payload);
  if (typeof model.setRenderedLabel !== "function") {
    throw new Error("3D 모델이 Storefront 라벨 적용 API를 제공하지 않습니다.");
  }
  return model.setRenderedLabel(normalized);
}

export function attachSkuBridge(model, options = {}) {
  const allowedOrigin = options.allowedOrigin || window.location.origin;
  const onMessage = (event) => {
    if (event.source !== window.parent) return;
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
