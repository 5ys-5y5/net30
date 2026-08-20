import { existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const output = resolve(root, process.argv[2] ?? "qa-output/render.png");
const query = process.argv[3] ?? "";
mkdirSync(dirname(output), { recursive: true });

const candidates = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
const chrome = candidates.find((candidate) => existsSync(candidate));
if (!chrome) throw new Error("Chrome/Chromium 실행 파일을 찾지 못했습니다. CHROME_BIN을 지정하세요.");

const url = `http://127.0.0.1:5174/?qa=reference&capture=1${query ? `&${query}` : ""}`;
const result = spawnSync(chrome, [
  "--headless=new",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--hide-scrollbars",
  "--force-device-scale-factor=1",
  "--window-size=450,450",
  "--virtual-time-budget=4500",
  `--screenshot=${output}`,
  url,
], { stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(output);
