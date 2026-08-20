import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../..");
const hostDir = resolve(root, "app");
const serviceDir = resolve(root, "app/src/3d/vitamin-bottle-service");
const modelFile = resolve(serviceDir, "dist/models/reference-vial.glb");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...options.env },
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
}

function install(directory) {
  const hasLock = existsSync(resolve(directory, "package-lock.json"));
  run("npm", [hasLock ? "ci" : "install", "--no-audit", "--no-fund"], { cwd: directory });
}

function assertDirectory(directory, label) {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    throw new Error(`${label} build output was not created: ${directory}`);
  }
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

rmSync(resolve(hostDir, "dist"), { recursive: true, force: true });
rmSync(resolve(serviceDir, "dist"), { recursive: true, force: true });

console.log("[Railway 1/5] Install host dependencies");
install(hostDir);

console.log("[Railway 2/5] Build NET30 host");
run("npm", ["run", "build"], {
  cwd: hostDir,
  env: {
    VITE_NET30_3D_SERVICE_URL: "/3d",
    VITE_NET30_MODELING_HUB_URL: "/api/modeling",
  },
});

console.log("[Railway 3/5] Install and build independent 3D service");
install(serviceDir);
run("npm", ["run", "build"], { cwd: serviceDir });

console.log("[Railway 4/5] Verify build outputs and static asset base");
assertDirectory(resolve(hostDir, "dist"), "Host");
assertDirectory(resolve(serviceDir, "dist"), "3D service");
if (!existsSync(modelFile)) throw new Error(`3D reference model was not emitted: ${modelFile}`);
if (readFileSync(modelFile).subarray(0, 4).toString("utf8") !== "glTF") {
  throw new Error(`3D reference model is not GLB v2: ${modelFile}`);
}
let hasCanonicalModelUrl = false;
for (const file of walk(resolve(serviceDir, "dist")).filter((name) => name.endsWith(".js"))) {
  const text = readFileSync(file, "utf8");
  if (text.includes('"/models/reference-vial.glb"') || text.includes("'/models/reference-vial.glb'")) {
    throw new Error(`Root-relative 3D model URL leaked into production bundle: ${file}`);
  }
  hasCanonicalModelUrl ||= text.includes('"/3d/models/reference-vial.glb"') || text.includes("'/3d/models/reference-vial.glb'");
}
if (!hasCanonicalModelUrl) throw new Error("Canonical /3d/models/reference-vial.glb URL is missing from the production bundle");

console.log("[Railway 5/5] Build complete");
console.log("NET30_RAILWAY_BUILD_OK");
