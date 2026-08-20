import type { RenderedLabelSurface, RenderedLabelTexture } from "./schema";

const LABEL_SHEET_CLASS = "ds-label-sticker-sheet";
const MAX_RASTER_EDGE = 2048;
const DEFAULT_RASTER_SCALE = 1.75;
const TRANSPARENT = new Set(["transparent", "rgba(0, 0, 0, 0)", "rgba(0,0,0,0)"]);
const SOURCE_LABELS = ["한글표시사항", "전체 가격 구조"] as const;
type SourceLabel = (typeof SOURCE_LABELS)[number];

function resolveBackgroundColor(element: HTMLElement): string {
  let current: HTMLElement | null = element;
  while (current) {
    const color = getComputedStyle(current).backgroundColor;
    if (color && !TRANSPARENT.has(color)) return color;
    current = current.parentElement;
  }
  return "#ffffff";
}

function copyComputedStyle(source: Element, target: Element): void {
  const computed = getComputedStyle(source);
  const declarations: string[] = [];
  for (const property of computed) declarations.push(`${property}:${computed.getPropertyValue(property)};`);
  target.setAttribute("style", declarations.join(""));
}

function cloneWithComputedStyles(sourceRoot: HTMLElement): HTMLElement {
  const cloneRoot = sourceRoot.cloneNode(true) as HTMLElement;
  const sourceElements = [sourceRoot, ...Array.from(sourceRoot.querySelectorAll<HTMLElement>("*"))];
  const cloneElements = [cloneRoot, ...Array.from(cloneRoot.querySelectorAll<HTMLElement>("*"))];
  if (sourceElements.length !== cloneElements.length) throw new Error("라벨 DOM 복제 과정에서 노드 수가 일치하지 않습니다.");
  sourceElements.forEach((source, index) => {
    const clone = cloneElements[index];
    copyComputedStyle(source, clone);
    if (source instanceof HTMLDetailsElement && clone instanceof HTMLDetailsElement) clone.open = source.open;
    if (source instanceof HTMLInputElement && clone instanceof HTMLInputElement) {
      clone.value = source.value;
      clone.checked = source.checked;
    }
    if (source instanceof HTMLTextAreaElement && clone instanceof HTMLTextAreaElement) {
      clone.value = source.value;
      clone.textContent = source.value;
    }
  });
  cloneRoot.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  return cloneRoot;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("라벨 SVG data URL을 만들지 못했습니다."));
    reader.readAsDataURL(blob);
  });
}

function loadSvgImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("라벨 DOM을 래스터 이미지로 변환하지 못했습니다."));
    image.src = source;
  });
}

function getExactSheets(root: HTMLElement): readonly [HTMLElement, HTMLElement] {
  const sheets = Array.from(root.querySelectorAll<HTMLElement>(`.${LABEL_SHEET_CLASS}`));
  if (sheets.length !== 2) throw new Error(`3D 라벨은 두 개의 ds-label-sticker-sheet만 허용합니다: ${sheets.length}개 발견`);
  sheets.forEach((sheet, index) => {
    const expected = SOURCE_LABELS[index];
    const actual = sheet.getAttribute("aria-label")?.trim();
    if (!sheet.classList.contains("ds-surface") || actual !== expected) {
      throw new Error(`3D 라벨 ${index + 1}번 시트는 ds-surface[aria-label="${expected}"]여야 합니다.`);
    }
  });
  return [sheets[0], sheets[1]];
}

async function renderSurface(element: HTMLElement, sourceLabel: SourceLabel): Promise<RenderedLabelSurface> {
  const rect = element.getBoundingClientRect();
  const cssWidth = Math.ceil(rect.width);
  const cssHeight = Math.ceil(rect.height);
  if (cssWidth < 1 || cssHeight < 1) throw new Error(`${sourceLabel} 캡처 원본의 실제 크기가 0입니다.`);
  const clone = cloneWithComputedStyles(element);
  clone.style.setProperty("width", `${cssWidth}px`, "important");
  clone.style.setProperty("height", `${cssHeight}px`, "important");
  clone.style.setProperty("margin", "0", "important");
  clone.style.setProperty("transform", "none", "important");
  clone.style.setProperty("animation", "none", "important");
  clone.style.setProperty("transition", "none", "important");
  clone.style.setProperty("contain", "none", "important");
  const serialized = new XMLSerializer().serializeToString(clone);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cssWidth}" height="${cssHeight}" viewBox="0 0 ${cssWidth} ${cssHeight}">`,
    "<style>summary::-webkit-details-marker{display:none}</style>",
    `<foreignObject x="0" y="0" width="100%" height="100%">${serialized}</foreignObject>`,
    "</svg>",
  ].join("");
  const image = await loadSvgImage(await blobToDataUrl(new Blob([svg], { type: "image/svg+xml;charset=utf-8" })));
  const scale = Math.min(DEFAULT_RASTER_SCALE, MAX_RASTER_EDGE / cssWidth, MAX_RASTER_EDGE / cssHeight);
  const pixelWidth = Math.max(1, Math.round(cssWidth * scale));
  const pixelHeight = Math.max(1, Math.round(cssHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("라벨 캡처용 Canvas 2D context를 만들 수 없습니다.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.fillStyle = resolveBackgroundColor(element);
  context.fillRect(0, 0, pixelWidth, pixelHeight);
  context.drawImage(image, 0, 0, pixelWidth, pixelHeight);
  return { dataUrl: canvas.toDataURL("image/png"), pixelWidth, pixelHeight, sourceLabel };
}

export async function renderLabelStickerToTexture(
  root: HTMLElement,
  expectedLabels: readonly [string, string],
): Promise<RenderedLabelTexture> {
  if (!root.classList.contains("ds-label-sticker")) throw new Error("3D 라벨 캡처 원본은 ds-label-sticker 루트여야 합니다.");
  if (expectedLabels[0] !== SOURCE_LABELS[0] || expectedLabels[1] !== SOURCE_LABELS[1]) {
    throw new Error("3D 라벨 순서는 한글표시사항, 전체 가격 구조여야 합니다.");
  }
  const [frontElement, backElement] = getExactSheets(root);
  const [front, back] = await Promise.all([
    renderSurface(frontElement, SOURCE_LABELS[0]),
    renderSurface(backElement, SOURCE_LABELS[1]),
  ]);
  return { front, back, sourceLabels: SOURCE_LABELS };
}
