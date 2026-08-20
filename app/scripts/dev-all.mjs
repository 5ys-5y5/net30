import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serviceDir = resolve(appDir, "src/3d/vitamin-bottle-service");
const hubDir = resolve(appDir, "src/3d/modeling-hub");
const modelingHubPort = Number(process.env.NET30_MODELING_HUB_PORT ?? 8788);
const children = new Set();
let stopping = false;

async function assertPortAvailable(port, label) {
  await new Promise((resolveReady, rejectReady) => {
    const probe = createServer();
    probe.once("error", (error) => {
      rejectReady(new Error(`${label} 포트 ${port}을 사용할 수 없습니다: ${error.message}`));
    });
    probe.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      probe.close((error) => error ? rejectReady(error) : resolveReady());
    });
  });
}

function launch(label, cwd, args, environment = {}) {
  const child = spawn("npm", args, {
    cwd,
    env: { ...process.env, ...environment, FORCE_COLOR: "1" },
    stdio: "inherit",
  });
  children.add(child);
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (!stopping && code !== 0) {
      console.error(`${label} 종료: code=${code ?? "null"}, signal=${signal ?? "null"}`);
      stop(code ?? 1);
    }
  });
  return child;
}

async function waitFor(url, label, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status >= 200 && response.status < 500) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`${label} 준비 실패: ${lastError}`);
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 250).unref();
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop(0));

try {
  await Promise.all([
    assertPortAvailable(5173, "NET30 host"),
    assertPortAvailable(5174, "3D service"),
    assertPortAvailable(modelingHubPort, "Modeling hub"),
  ]);

  launch("3D service", serviceDir, ["run", "dev"]);
  await waitFor("http://127.0.0.1:5174/3d/", "3D service");

  launch("Modeling hub", hubDir, ["run", "dev"], { NET30_MODELING_HUB_PORT: String(modelingHubPort) });
  await waitFor(`http://127.0.0.1:${modelingHubPort}/health`, "Modeling hub");

  launch("NET30 host", appDir, ["run", "dev:host"], { NET30_MODELING_HUB_PORT: String(modelingHubPort) });
  await waitFor("http://127.0.0.1:5173/", "NET30 host");

  console.log("\nNET30 local services ready");
  console.log("Storefront: http://127.0.0.1:5173/");
  console.log("Modeling:  http://127.0.0.1:5173/model");
  console.log("3D asset:  http://127.0.0.1:5173/3d/models/reference-vial.glb");
  console.log(`Modeling hub: http://127.0.0.1:${modelingHubPort}/health`);
  console.log("Stop: Ctrl+C\n");
} catch (error) {
  console.error(error);
  stop(1);
}
