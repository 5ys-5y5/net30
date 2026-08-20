import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { COMPONENTS } from "./modeling-spec.mjs";

function cleanId(value) { return String(value).replace(/[^a-zA-Z0-9_-]/g, ""); }

export function createVersionStore(assetRoot) {
  const root = path.join(assetRoot, "component-library");
  const manifestPath = path.join(root, "index.json");
  const empty = { version: 1, components: Object.fromEntries(COMPONENTS.map((component) => [component, []])) };
  async function load() { if (!existsSync(manifestPath)) return structuredClone(empty); return JSON.parse(await fs.readFile(manifestPath, "utf8")); }
  async function save(value) { await fs.mkdir(root, { recursive: true }); await fs.writeFile(manifestPath, `${JSON.stringify(value, null, 2)}\n`); }
  async function list(component) { if (!COMPONENTS.includes(component)) throw new Error("지원하지 않는 컴포넌트입니다."); const manifest = await load(); return manifest.components[component] ?? []; }
  async function register({ component, sourcePath, jobId, contractHash, summary, parentVersionId = null }) {
    if (!COMPONENTS.includes(component)) throw new Error("지원하지 않는 컴포넌트입니다.");
    const manifest = await load(); const history = manifest.components[component] ?? []; const ordinal = history.length + 1; const id = `${component}-v${ordinal}-${randomUUID().slice(0, 8)}`;
    const targetDir = path.join(root, component, id); await fs.mkdir(targetDir, { recursive: true }); await fs.copyFile(sourcePath, path.join(targetDir, "model.glb"));
    const entry = { id, component, ordinal, jobId, contractHash, summary, parentVersionId, createdAt: new Date().toISOString(), assetPath: `/api/modeling/components/${component}/versions/${id}/artifact` };
    history.unshift(entry); manifest.components[component] = history; await save(manifest); return entry;
  }
  async function find(component, versionId) { return (await list(component)).find((item) => item.id === versionId) ?? null; }
  async function remove(component, versionId) { const manifest = await load(); const history = manifest.components[component] ?? []; const entry = history.find((item) => item.id === versionId); if (!entry) return null; manifest.components[component] = history.filter((item) => item.id !== versionId); await fs.rm(path.join(root, component, cleanId(versionId)), { recursive: true, force: true }); await save(manifest); return entry; }
  function artifactPath(component, versionId) { return path.join(root, component, cleanId(versionId), "model.glb"); }
  return { list, register, find, remove, artifactPath };
}
