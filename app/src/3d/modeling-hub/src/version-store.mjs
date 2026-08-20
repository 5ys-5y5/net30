import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { COMPONENTS } from "./modeling-spec.mjs";

function cleanId(value) { return String(value).replace(/[^a-zA-Z0-9_-]/g, ""); }

export function createVersionStore(assetRoot) {
  const root = path.join(assetRoot, "component-library");
  const manifestPath = path.join(root, "index.json");
  const empty = { version: 1, showcase: null, components: Object.fromEntries(COMPONENTS.map((component) => [component, []])) };
  async function load() { if (!existsSync(manifestPath)) return structuredClone(empty); const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")); return { ...empty, ...manifest, components: { ...empty.components, ...manifest.components } }; }
  async function save(value) { await fs.mkdir(root, { recursive: true }); await fs.writeFile(manifestPath, `${JSON.stringify(value, null, 2)}\n`); }
  async function list(component) { if (!COMPONENTS.includes(component)) throw new Error("지원하지 않는 컴포넌트입니다."); const manifest = await load(); return manifest.components[component] ?? []; }
  async function register({ component, sourcePath, jobId, contractHash, summary, parentVersionId = null }) {
    if (!COMPONENTS.includes(component)) throw new Error("지원하지 않는 컴포넌트입니다.");
    const manifest = await load(); const history = manifest.components[component] ?? []; const ordinal = history.length + 1; const id = `${component}-v${ordinal}-${randomUUID().slice(0, 8)}`;
    const targetDir = path.join(root, component, id); await fs.mkdir(targetDir, { recursive: true }); await fs.copyFile(sourcePath, path.join(targetDir, "model.glb"));
    const entry = { id, component, ordinal, jobId, contractHash, summary, parentVersionId, createdAt: new Date().toISOString(), assetPath: `/api/modeling/components/${component}/versions/${id}/artifact` };
    history.unshift(entry); manifest.components[component] = history; await save(manifest); return entry;
  }
  async function importLegacyJobs(jobsRoot) {
    const manifest = await load(); let changed = false;
    const jobs = await fs.readdir(jobsRoot, { withFileTypes: true }).catch(() => []);
    for (const job of jobs.filter((entry) => entry.isDirectory())) {
      const componentsRoot = path.join(jobsRoot, job.name, "components");
      const files = await fs.readdir(componentsRoot).catch(() => []);
      for (const file of files.filter((entry) => entry.endsWith(".glb"))) {
        const component = file.slice(0, -4); if (!COMPONENTS.includes(component)) continue;
        const history = manifest.components[component] ?? [];
        if (history.some((entry) => entry.jobId === job.name)) continue;
        const ordinal = history.length + 1; const id = `${component}-v${ordinal}-${randomUUID().slice(0, 8)}`;
        const targetDir = path.join(root, component, id); await fs.mkdir(targetDir, { recursive: true }); await fs.copyFile(path.join(componentsRoot, file), path.join(targetDir, "model.glb"));
        history.unshift({ id, component, ordinal, jobId: job.name, contractHash: null, summary: "기존 모델링 작업에서 가져온 자산입니다.", parentVersionId: null, createdAt: new Date().toISOString(), assetPath: `/api/modeling/components/${component}/versions/${id}/artifact` }); manifest.components[component] = history; changed = true;
      }
    }
    if (changed) await save(manifest);
  }
  async function showcase() { return (await load()).showcase; }
  async function setShowcase({ component, versionId, selections, sourcePath }) {
    const selected = selections?.length ? selections : [{ component, versionId }];
    if (!Array.isArray(selected) || selected.length === 0) throw new Error("홈에 표시할 컴포넌트 버전을 선택하세요.");
    const unique = new Map();
    for (const item of selected) unique.set(item.component, { component: item.component, versionId: item.versionId });
    const resolved = [];
    for (const item of unique.values()) {
      const version = await find(item.component, item.versionId); if (!version) throw new Error("버전을 찾을 수 없습니다.");
      resolved.push({ component: version.component, versionId: version.id });
    }
    if (!existsSync(sourcePath)) throw new Error("조립 GLB를 찾을 수 없습니다.");
    const manifest = await load(); const target = path.join(root, "showcase", "current.glb"); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.copyFile(sourcePath, target);
    const first = resolved[0]; const version = await find(first.component, first.versionId);
    manifest.showcase = { component: first.component, versionId: first.versionId, jobId: version.jobId, selections: resolved, assetPath: "/api/modeling/showcase/artifact", updatedAt: new Date().toISOString() }; await save(manifest); return manifest.showcase;
  }
  async function initialiseShowcase(jobsRoot) {
    const current = await showcase();
    if (current?.selections?.length) return;
    if (current?.component && current?.versionId) {
      const sourcePath = artifactPath(current.component, current.versionId);
      if (existsSync(sourcePath)) await setShowcase({ selections: [{ component: current.component, versionId: current.versionId }], sourcePath });
    }
  }
  async function find(component, versionId) { return (await list(component)).find((item) => item.id === versionId) ?? null; }
  async function remove(component, versionId) { const manifest = await load(); const history = manifest.components[component] ?? []; const entry = history.find((item) => item.id === versionId); if (!entry) return null; manifest.components[component] = history.filter((item) => item.id !== versionId); await fs.rm(path.join(root, component, cleanId(versionId)), { recursive: true, force: true }); await save(manifest); return entry; }
  function artifactPath(component, versionId) { return path.join(root, component, cleanId(versionId), "model.glb"); }
  function assemblyPath(assemblyId) { return path.join(root, "assemblies", `${cleanId(assemblyId)}.glb`); }
  function showcaseArtifactPath() { return path.join(root, "showcase", "current.glb"); }
  return { list, register, importLegacyJobs, showcase, setShowcase, initialiseShowcase, find, remove, artifactPath, assemblyPath, showcaseArtifactPath };
}
