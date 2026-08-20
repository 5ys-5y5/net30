import { existsSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../..");
const hostDir = resolve(root, "app");
const serviceDir = resolve(root, "app/src/3d/vitamin-bottle-service");

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

rmSync(resolve(hostDir, "dist"), { recursive: true, force: true });
rmSync(resolve(serviceDir, "dist"), { recursive: true, force: true });
console.log("[Railway 1/4] Install host dependencies");
install(hostDir);
console.log("[Railway 2/4] Build NET30 host");
run("npm", ["run", "build"], {
  cwd: hostDir,
  env: { VITE_NET30_3D_SERVICE_URL: "/3d", VITE_NET30_MODELING_HUB_URL: "" },
});
console.log("[Railway 3/4] Install and build independent 3D service");
install(serviceDir);
run("npm", ["run", "build"], { cwd: serviceDir });
console.log("[Railway 4/4] Verify build outputs");
assertDirectory(resolve(hostDir, "dist"), "Host");
assertDirectory(resolve(serviceDir, "dist"), "3D service");
console.log("NET30_RAILWAY_BUILD_OK");
