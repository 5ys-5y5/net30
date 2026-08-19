import { VitaminBottleModel } from "../model/vitamin-bottle-model.js";
import { attachSkuBridge } from "../shared/sku-bridge.js";

const canvas = document.getElementById("modelCanvas");
const errorPanel = document.getElementById("errorPanel");
const errorMessage = document.getElementById("errorMessage");
const sourceStatus = document.getElementById("sourceStatus");

function readQueryState() {
  const params = new URLSearchParams(window.location.search);
  const state = {};
  const colorMap = {
    cap: "capColor",
    glass: "glassColor",
    background: "background",
    pillA: "pillColorA",
    pillB: "pillColorB",
  };
  for (const [queryKey, stateKey] of Object.entries(colorMap)) {
    const value = params.get(queryKey);
    if (value && /^#[0-9a-f]{6}$/i.test(value)) state[stateKey] = value;
  }
  const rotate = params.get("rotate");
  if (rotate === "1" || rotate === "true") state.autoRotate = true;
  return state;
}

function showError(error) {
  console.error(error);
  errorMessage.textContent = error instanceof Error ? error.message : String(error);
  errorPanel.hidden = false;
}

try {
  const model = new VitaminBottleModel(canvas, { state: readQueryState() });
  window.__NET30_VITAMIN_MODEL__ = model;
  const detachBridge = attachSkuBridge(model);
  window.addEventListener("pagehide", () => {
    detachBridge();
    model.destroy();
  }, { once: true });

  model.ready.then(() => {
    sourceStatus.textContent = window.parent === window ? "라벨 동기화 대기" : "SKU 연결 대기";
    document.documentElement.dataset.modelReady = "true";
  }).catch(showError);

  canvas.addEventListener("net30-model-change", (event) => {
    if (event.detail?.state?.labelMode === "rendered") sourceStatus.textContent = "웹 라벨 직접 적용";
  });
  canvas.addEventListener("net30-model-error", (event) => showError(event.detail));
} catch (error) {
  showError(error);
}
