import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { ssim } from "ssim.js";

const root = resolve(new URL("..", import.meta.url).pathname);
const referencePath = resolve(root, "public/qa/reference-vial.jpg");
const renderPath = resolve(root, process.argv[2] ?? "qa-output/render.png");
const outputDir = resolve(root, "qa-output");
mkdirSync(outputDir, { recursive: true });

async function load(path) {
  const { data, info } = await sharp(path).resize(450, 450, { fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
}

function mask(image, threshold = 246) {
  const result = new Uint8Array(image.width * image.height);
  for (let i = 0; i < result.length; i += 1) {
    const r = image.data[i * 4];
    const g = image.data[i * 4 + 1];
    const b = image.data[i * 4 + 2];
    const distance = Math.max(255 - r, 255 - g, 255 - b);
    result[i] = distance > (255 - threshold) ? 1 : 0;
  }
  return result;
}

function edgeMask(image) {
  const gray = new Float32Array(image.width * image.height);
  for (let i = 0; i < gray.length; i += 1) {
    gray[i] = image.data[i * 4] * 0.2126 + image.data[i * 4 + 1] * 0.7152 + image.data[i * 4 + 2] * 0.0722;
  }
  const edge = new Uint8Array(gray.length);
  const w = image.width;
  for (let y = 1; y < image.height - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      const gx = -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] + gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
      const gy = -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] + gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
      edge[i] = Math.hypot(gx, gy) > 38 ? 1 : 0;
    }
  }
  return edge;
}

function iou(a, b) {
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] && b[i]) intersection += 1;
    if (a[i] || b[i]) union += 1;
  }
  return union === 0 ? 1 : intersection / union;
}

function bbox(binary, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!binary[y * width + x]) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

const [reference, render] = await Promise.all([load(referencePath), load(renderPath)]);
const referenceMask = mask(reference);
const renderMask = mask(render);
const silhouetteIoU = iou(referenceMask, renderMask);
const edgeIoU = iou(edgeMask(reference), edgeMask(render));
const fullSsim = ssim(
  { data: reference.data, width: reference.width, height: reference.height },
  { data: render.data, width: render.width, height: render.height },
  { downsample: "original" },
).mssim;
const referenceBox = bbox(referenceMask, 450, 450);
const renderBox = bbox(renderMask, 450, 450);
const widthError = Math.abs(renderBox.width - referenceBox.width) / referenceBox.width;
const heightError = Math.abs(renderBox.height - referenceBox.height) / referenceBox.height;
const centerError = Math.hypot(
  (renderBox.minX + renderBox.maxX - referenceBox.minX - referenceBox.maxX) / 2,
  (renderBox.minY + renderBox.maxY - referenceBox.minY - referenceBox.maxY) / 2,
);
const geometryScore = 0.7 * silhouetteIoU + 0.3 * edgeIoU;
const passed = silhouetteIoU >= 0.99 && edgeIoU >= 0.99 && widthError <= 0.01 && heightError <= 0.01 && centerError <= 1;
const report = {
  passed,
  silhouetteIoU,
  edgeIoU,
  geometryScore,
  fullImageSSIM: fullSsim,
  widthError,
  heightError,
  centerErrorPixels: centerError,
  referenceBox,
  renderBox,
  note: "99% gate is geometry/edge based. Full RGB SSIM also reports print and lighting differences in the supplied photo.",
};
writeFileSync(resolve(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!passed) process.exitCode = 2;
