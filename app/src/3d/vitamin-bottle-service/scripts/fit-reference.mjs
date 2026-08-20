import { mkdirSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import sharp from "sharp";

const root = resolve(new URL("..", import.meta.url).pathname);
const outputDir = resolve(root, "qa-output");
mkdirSync(outputDir, { recursive: true });
const server = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "dev"], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.pipe(process.stdout);
server.stderr.pipe(process.stderr);

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const response = await fetch("http://127.0.0.1:5174/");
      if (response.ok) return;
    } catch { /* retry */ }
    await sleep(250);
  }
  throw new Error("3D service did not start on port 5174");
}

function runCapture(params, index) {
  const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString();
  const path = `qa-output/candidate-${String(index).padStart(4, "0")}.png`;
  const result = spawnSync(process.execPath, ["scripts/capture-reference.mjs", path, query], {
    cwd: root,
    stdio: "ignore",
  });
  if (result.status !== 0) throw new Error(`capture failed for ${query}`);
  return resolve(root, path);
}

async function quickScore(path) {
  const referencePath = resolve(root, "public/qa/reference-vial.jpg");
  const [a, b] = await Promise.all([
    sharp(referencePath).resize(450, 450).greyscale().raw().toBuffer(),
    sharp(path).resize(450, 450).greyscale().raw().toBuffer(),
  ]);
  let squared = 0;
  let count = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] > 252 && b[i] > 252) continue;
    const d = Number(a[i]) - Number(b[i]);
    squared += d * d;
    count += 1;
  }
  const rmse = Math.sqrt(squared / Math.max(1, count));
  return 1 - Math.min(1, rmse / 255);
}

let exitCode = 1;
try {
  await waitForServer();
  let current = { fitZoom: 0.49, fitY: 0, fitScaleX: 1, fitScaleY: 1 };
  let image = runCapture(current, 0);
  let best = await quickScore(image);
  let index = 1;
  const steps = [
    ["fitZoom", 0.04],
    ["fitY", 0.002],
    ["fitScaleX", 0.025],
    ["fitScaleY", 0.025],
  ];
  for (let round = 0; round < 6; round += 1) {
    let improved = false;
    for (const [key, initialStep] of steps) {
      const step = initialStep / (round + 1);
      for (const direction of [-1, 1]) {
        const candidate = { ...current, [key]: current[key] + step * direction };
        const candidateImage = runCapture(candidate, index++);
        const score = await quickScore(candidateImage);
        if (score > best) {
          best = score;
          current = candidate;
          image = candidateImage;
          improved = true;
        }
      }
    }
    if (!improved && round >= 2) break;
  }
  writeFileSync(resolve(outputDir, "fit.json"), `${JSON.stringify({ ...current, quickScore: best }, null, 2)}\n`);
  const scoreResult = spawnSync(process.execPath, ["scripts/score-reference.mjs", image], {
    cwd: root,
    stdio: "inherit",
  });
  exitCode = scoreResult.status ?? 1;
} finally {
  server.kill("SIGTERM");
  await sleep(100);
  if (!server.killed) server.kill("SIGKILL");
}
process.exit(exitCode);
