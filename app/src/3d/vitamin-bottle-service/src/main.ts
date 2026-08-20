import "./style.css";
import { SERVICE_MESSAGE_TYPE, type ProductConfig } from "./api/contracts";
import { attachBridge } from "./api/bridge";
import { CONTENT_PRESETS, DEFAULT_CONTENTS } from "./model/presets";
import { BottleViewer } from "./render/BottleViewer";

const root = document.getElementById("app");
if (!root) throw new Error("3D service root not found");

const query = new URLSearchParams(location.search);
const serviceBaseUrl = import.meta.env.BASE_URL;
const qaMode = query.get("qa") === "reference";
const captureMode = query.get("capture") === "1";
const contentPreset = CONTENT_PRESETS[query.get("contents") ?? "multivitamin"] ?? DEFAULT_CONTENTS;

root.innerHTML = `
  <section class="viewer${qaMode ? " viewer--qa" : ""}${captureMode ? " viewer--capture" : ""}">
    <canvas class="viewer__canvas" aria-label="NET30 독립 3D 비타민 병"></canvas>
    ${qaMode ? `<img class="viewer__reference" src="${serviceBaseUrl}qa/reference-vial.jpg" alt="유리병 기준 사진">` : ""}
    <div class="viewer__status"><strong>NET30 3D</strong><span data-status>독립 서비스 시작 중</span></div>
    <div class="viewer__controls">
      <button type="button" data-zoom-out aria-label="축소">−</button>
      <button type="button" data-reset>1:1</button>
      <button type="button" data-zoom-in aria-label="확대">＋</button>
    </div>
    ${qaMode ? '<label class="viewer__qa">기준 사진 <input type="range" min="0" max="100" value="50" data-opacity></label>' : ""}
    <p class="viewer__help">좌우 드래그 회전 · 휠 확대 · 더블클릭 정면</p>
    <section class="viewer__error" data-error hidden><h1>3D 서비스를 표시할 수 없습니다.</h1><p data-error-message></p></section>
  </section>
`;

const canvas = root.querySelector<HTMLCanvasElement>("canvas");
const status = root.querySelector<HTMLElement>("[data-status]");
const errorPanel = root.querySelector<HTMLElement>("[data-error]");
const errorMessage = root.querySelector<HTMLElement>("[data-error-message]");
if (!canvas || !status) throw new Error("3D service DOM creation failed");

const showError = (error: unknown) => {
  console.error(error);
  if (errorMessage) errorMessage.textContent = error instanceof Error ? error.message : String(error);
  if (errorPanel) errorPanel.hidden = false;
};

const numberParam = (name: string) => {
  const value = Number(query.get(name));
  return Number.isFinite(value) ? value : undefined;
};

const viewer = new BottleViewer(canvas, {
  qaMode,
  fit: {
    zoom: numberParam("fitZoom"),
    offsetY: numberParam("fitY"),
    scaleX: numberParam("fitScaleX"),
    scaleY: numberParam("fitScaleY"),
  },
  onStatus: (message) => { status.textContent = message; },
});

let activeConfig: ProductConfig = {
  skuId: query.get("sku") ?? "standalone-preview",
  modelId: "reference-vial",
  capColor: query.get("cap") ?? "#083da9",
  contents: qaMode ? [] : contentPreset,
};

root.querySelector<HTMLButtonElement>("[data-zoom-out]")?.addEventListener("click", () => viewer.setView({ zoom: Math.max(0.35, viewer.camera.zoom / 1.18) }));
root.querySelector<HTMLButtonElement>("[data-zoom-in]")?.addEventListener("click", () => viewer.setView({ zoom: Math.min(3, viewer.camera.zoom * 1.18) }));
root.querySelector<HTMLButtonElement>("[data-reset]")?.addEventListener("click", () => viewer.setView({ reset: true }));

const reference = root.querySelector<HTMLImageElement>(".viewer__reference");
const opacity = root.querySelector<HTMLInputElement>("[data-opacity]");
if (reference && opacity) {
  const apply = () => { reference.style.opacity = String(Number(opacity.value) / 100); };
  opacity.addEventListener("input", apply);
  apply();
}


const allowedHostOrigin = query.get("hostOrigin") ?? window.location.origin;
const onLegacyMessage = (event: MessageEvent) => {
  if (event.source !== window.parent) return;
  if (event.origin !== allowedHostOrigin) return;
  const message = event.data as { type?: unknown; payload?: any } | null;
  if (!message || message.type !== "NET30_LABEL_DATA") return;
  const rendered = message.payload?.renderedLabel;
  if (!rendered?.front || !rendered?.back) return;
  void viewer.applyLabels(rendered.front, rendered.back).catch(showError);
};
window.addEventListener("message", onLegacyMessage);
if (window.parent !== window) window.parent.postMessage({ type: "NET30_3D_READY" }, allowedHostOrigin);

const detachBridge = attachBridge({
  async configure(message) {
    activeConfig = message.payload;
    await viewer.configure(activeConfig);
    if (window.parent !== window) {
      window.parent.postMessage({
        type: SERVICE_MESSAGE_TYPE.configured,
        requestId: message.requestId,
        payload: { skuId: activeConfig.skuId },
      }, allowedHostOrigin);
    }
  },
  async labels(message) {
    await viewer.applyLabels(message.payload.front, message.payload.back);
  },
  view(message) {
    viewer.setView(message.payload);
  },
});

(window as Window & { __NET30_3D_SERVICE__?: unknown }).__NET30_3D_SERVICE__ = {
  version: "0.1.1",
  viewer,
  getState: () => ({ ...activeConfig, qaMode, yaw: viewer.modelRoot.rotation.y, zoom: viewer.camera.zoom }),
  capturePng: () => viewer.captureDataUrl(),
};

viewer.initialize(activeConfig).then(() => {
  document.documentElement.dataset.serviceReady = "true";
  viewer.requestRender();
}).catch(showError);

window.addEventListener("pagehide", () => {
  detachBridge();
  window.removeEventListener("message", onLegacyMessage);
  viewer.dispose();
}, { once: true });
