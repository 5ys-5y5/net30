export const MODEL_PRESET_VERSION = 2;

export const PROVIDED_LABEL_URL = new URL(
  "../textures/price-structure-label.png",
  import.meta.url,
).href;

export const DEFAULT_MODEL_STATE = Object.freeze({
  autoRotate: false,
  labelMode: "image",
  customLabelImage: "",
  brand: "NET30",
  productName: "멀티비타민미네랄 올인원",
  subtitle: "멀티비타민 · 유통·가격정보 라벨",
  dose: "총 45g · 1,500mg × 30정",
  quantity: "K2608-V01",
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
  koreanLabelLines: [
    "제품명: 멀티비타민미네랄 올인원",
    "식품유형: 비타민·무기질",
    "내용량: 총 45g(1,500mg × 30정)",
    "제조번호: K2608-V01",
  ],
  priceStructureLines: [
    "총 소비자가: 20,350원",
    "원료: 5,590원 (27.5%)",
    "생산: 4,269원 (21.0%)",
    "유통: 488원 (2.4%)",
    "마케팅: 0원 (0.0%)",
    "운영: 2,053원 (10.1%)",
    "이익: 6,100원 (29.98%)",
    "세금: 1,850원 (9.1%)",
  ],
});

const cloneLines = (value, fallback) =>
  Array.isArray(value) ? [...value] : [...fallback];

export function createModelState(overrides = {}) {
  return {
    ...DEFAULT_MODEL_STATE,
    ...overrides,
    koreanLabelLines: cloneLines(
      overrides.koreanLabelLines,
      DEFAULT_MODEL_STATE.koreanLabelLines,
    ),
    priceStructureLines: cloneLines(
      overrides.priceStructureLines,
      DEFAULT_MODEL_STATE.priceStructureLines,
    ),
  };
}
