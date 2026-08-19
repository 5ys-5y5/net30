import { DEFAULT_MODEL_STATE, MODEL_PRESET_VERSION } from "../model/config.js";
import { VitaminBottleModel } from "../model/vitamin-bottle-model.js";
import { attachSkuBridge } from "../shared/sku-bridge.js";

const byId = (id) => document.getElementById(id);
const canvas = byId("modelCanvas");
const panel = byId("panel");
const panelToggle = byId("panelToggle");
const errorPanel = byId("errorPanel");
const errorMessage = byId("errorMessage");
const connectionStatus = byId("connectionStatus");

const CONTROL_IDS = [
  "autoRotate",
  "labelMode",
  "brand",
  "productName",
  "subtitle",
  "dose",
  "quantity",
  "accentColor",
  "labelArc",
  "labelHeight",
  "labelY",
  "labelRotation",
  "capColor",
  "glassColor",
  "glassAlpha",
  "background",
  "pillCount",
  "pillColorA",
  "pillColorB",
];

const NUMBER_IDS = new Set([
  "labelArc",
  "labelHeight",
  "labelY",
  "labelRotation",
  "glassAlpha",
  "pillCount",
]);

function showError(error) {
  console.error(error);
  errorMessage.textContent = error instanceof Error ? error.message : String(error);
  errorPanel.hidden = false;
}

function updateOutputs(state) {
  byId("labelArcOut").textContent = `${Math.round(state.labelArc)}°`;
  byId("labelHeightOut").textContent = Number(state.labelHeight).toFixed(2);
  byId("labelYOut").textContent = `${state.labelY >= 0 ? "+" : ""}${Number(state.labelY).toFixed(2)}`;
  byId("labelRotationOut").textContent = `${Math.round(state.labelRotation)}°`;
  byId("glassAlphaOut").textContent = `${Math.round(state.glassAlpha * 100)}%`;
  byId("pillCountOut").textContent = `${state.pillCount}개`;
}

function syncControls(state) {
  for (const id of CONTROL_IDS) {
    const element = byId(id);
    if (!element || !(id in state)) continue;
    if (element.type === "checkbox") element.checked = Boolean(state[id]);
    else element.value = state[id];
  }
  byId("uploadWrap").classList.toggle("hidden", state.labelMode !== "custom");
  updateOutputs(state);
}

function downloadBlob(filename, contents, type) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.download = filename;
  anchor.href = url;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

try {
  const model = new VitaminBottleModel(canvas);
  window.__NET30_VITAMIN_MODEL__ = model;
  const detachBridge = attachSkuBridge(model);

  for (const id of CONTROL_IDS) {
    const element = byId(id);
    if (!element) continue;
    const eventName = element.tagName === "SELECT" ? "change" : "input";
    element.addEventListener(eventName, () => {
      let value = element.type === "checkbox" ? element.checked : element.value;
      if (NUMBER_IDS.has(id)) value = Number(value);
      model.setState({ [id]: value }).catch(showError);
    });
  }

  byId("labelUpload").addEventListener("change", (event) => {
    const [file] = event.target.files || [];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      showError(new Error("라벨 이미지는 8MB 이하로 사용해주세요."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      model.setState({
        customLabelImage: String(reader.result),
        labelMode: "custom",
      }).then(syncControls).catch(showError);
    };
    reader.onerror = () => showError(reader.error || new Error("라벨 이미지를 읽을 수 없습니다."));
    reader.readAsDataURL(file);
  });

  byId("exportPng").addEventListener("click", () => {
    const autoRotate = model.getState().autoRotate;
    model.setState({ autoRotate: false }).then(() => {
      model.capturePng("net30-vitamin-bottle.png");
      return model.setState({ autoRotate });
    }).catch(showError);
  });

  byId("savePreset").addEventListener("click", () => {
    const preset = {
      version: MODEL_PRESET_VERSION,
      asset: "NET30 vitamin-bottle",
      settings: model.getState(),
    };
    downloadBlob(
      "net30-vitamin-bottle-settings.json",
      JSON.stringify(preset, null, 2),
      "application/json",
    );
  });

  byId("loadPreset").addEventListener("change", (event) => {
    const [file] = event.target.files || [];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const settings = parsed.settings || parsed;
        model.reset(settings).then(syncControls).catch(showError);
      } catch {
        showError(new Error("설정 JSON을 읽을 수 없습니다."));
      }
    };
    reader.onerror = () => showError(reader.error || new Error("설정 파일을 읽을 수 없습니다."));
    reader.readAsText(file);
  });

  byId("reset").addEventListener("click", () => {
    model.reset(DEFAULT_MODEL_STATE).then(syncControls).catch(showError);
  });

  panelToggle.addEventListener("click", () => {
    panel.classList.toggle("open");
    panelToggle.textContent = panel.classList.contains("open") ? "×" : "☰";
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && panel.classList.contains("open")) {
      panel.classList.remove("open");
      panelToggle.textContent = "☰";
    }
  });

  canvas.addEventListener("net30-model-change", (event) => {
    const state = event.detail?.state || model.getState();
    syncControls(state);
    connectionStatus.textContent = state.labelMode === "sku"
      ? "SKU 실시간 적용 중"
      : "로컬 편집 상태";
  });
  canvas.addEventListener("net30-model-error", (event) => showError(event.detail));

  model.ready.then(() => {
    syncControls(model.getState());
    connectionStatus.textContent = "편집 가능";
    document.documentElement.dataset.modelReady = "true";
  }).catch(showError);

  window.addEventListener("pagehide", () => {
    detachBridge();
    model.destroy();
  }, { once: true });
} catch (error) {
  showError(error);
}
