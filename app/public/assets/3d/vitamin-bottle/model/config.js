export const MODEL_PRESET_VERSION = 3;

export const DEFAULT_MODEL_STATE = Object.freeze({
  autoRotate: false,
  labelMode: "blank",
  renderedLabelDataUrl: "",
  renderedLabelSourceId: "",
  customLabelImage: "",
  brand: "NET30",
  productName: "제품명",
  subtitle: "제품 설명",
  dose: "함량·규격",
  quantity: "제조번호·수량",
  accentColor: "#111827",
  labelArc: 156,
  labelHeight: 1.53,
  labelY: -0.05,
  labelRotation: 0,
  capColor: "#f2c20f",
  glassColor: "#dff5ec",
  glassAlpha: 0.22,
  background: "#eef0f3",
  pillCount: 38,
  pillColorA: "#f5d547",
  pillColorB: "#f0a23a",
});

export function createModelState(overrides = {}) {
  return {
    ...DEFAULT_MODEL_STATE,
    ...overrides,
  };
}
