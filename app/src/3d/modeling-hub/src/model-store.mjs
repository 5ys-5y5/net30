import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const now = () => new Date().toISOString();
const cleanId = (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, "");

export class ModelStoreError extends Error {
  constructor(code, message, detail = {}) { super(message); this.code = code; this.detail = detail; }
}

function emptyManifest() {
  return { version: 1, artifacts: {}, models: {}, publications: {}, bindings: {}, migrations: { legacyJobs: {}, legacyShowcase: false } };
}

/**
 * Durable hierarchy for runtime product models. Component versions remain in
 * version-store; this store owns immutable model revisions and SKU bindings.
 */
export function createModelStore(assetRoot, { skuIds = new Set() } = {}) {
  const root = path.join(assetRoot, "product-models");
  const indexPath = path.join(root, "index.json");
  let queue = Promise.resolve();

  async function load() {
    if (!existsSync(indexPath)) return emptyManifest();
    const parsed = JSON.parse(await fs.readFile(indexPath, "utf8"));
    return { ...emptyManifest(), ...parsed, artifacts: parsed.artifacts ?? {}, models: parsed.models ?? {}, publications: parsed.publications ?? {}, bindings: parsed.bindings ?? {}, migrations: { ...emptyManifest().migrations, ...(parsed.migrations ?? {}) } };
  }
  async function write(manifest) {
    await fs.mkdir(root, { recursive: true });
    const temporary = `${indexPath}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
    await fs.rename(temporary, indexPath);
  }
  async function mutate(fn) {
    const run = queue.then(async () => { const manifest = await load(); const value = await fn(manifest); await write(manifest); return value; });
    queue = run.catch(() => undefined);
    return run;
  }
  async function storeArtifact(manifest, sourcePath) {
    if (!sourcePath || !existsSync(sourcePath)) throw new ModelStoreError("artifact_missing", "모델 GLB를 찾을 수 없습니다.");
    const bytes = await fs.readFile(sourcePath);
    if (bytes.length < 20 || bytes.subarray(0, 4).toString("ascii") !== "glTF") throw new ModelStoreError("artifact_invalid", "유효한 GLB만 제품 모델로 저장할 수 있습니다.");
    const hash = createHash("sha256").update(bytes).digest("hex"); const id = `artifact-${hash.slice(0, 20)}`;
    if (!manifest.artifacts[id]) {
      const target = path.join(root, "artifacts", `${id}.glb`);
      await fs.mkdir(path.dirname(target), { recursive: true });
      if (!existsSync(target)) await fs.writeFile(target, bytes);
      manifest.artifacts[id] = { id, hash, byteLength: bytes.length, createdAt: now() };
    }
    return id;
  }
  function createRevision(model, { artifactId = null, children = [], state = artifactId ? "ready" : "empty", source = "manual", summary = "" } = {}) {
    const ordinal = model.revisions.length + 1; const id = `${model.id}-r${ordinal}`;
    const revision = { id, ordinal, artifactId, children, state, source, summary, createdAt: now() };
    model.revisions.push(revision); model.currentRevisionId = id; model.updatedAt = now(); model.revision += 1; return revision;
  }
  function rootModel(manifest, id) {
    const model = manifest.models[id];
    if (!model) throw new ModelStoreError("model_not_found", "제품 모델을 찾을 수 없습니다.");
    if (model.parentId) throw new ModelStoreError("not_root_model", "SKU는 최상위 부모 모델에만 연결할 수 있습니다.");
    return model;
  }
  function modelSummary(manifest, model) {
    const revision = model.revisions.find((item) => item.id === model.currentRevisionId) ?? null;
    const published = model.revisions.find((item) => item.id === model.publishedRevisionId) ?? null;
    const descendants = countDescendants(manifest, model.id, new Set());
    return { id: model.id, name: model.name, revision: model.revision, linkedSkuId: model.skuId ?? null, currentRevision: revision && publicRevision(revision), publishedRevision: published && publicRevision(published), directChildren: revision?.children.length ?? 0, descendantCount: descendants, status: published ? "published" : revision?.state ?? "empty", createdAt: model.createdAt, updatedAt: model.updatedAt, source: model.source };
  }
  function publicRevision(revision) { return { id: revision.id, ordinal: revision.ordinal, state: revision.state, source: revision.source, summary: revision.summary, artifactId: revision.artifactId, childCount: revision.children.length, createdAt: revision.createdAt }; }
  function countDescendants(manifest, id, visited) {
    if (visited.has(id)) return 0; visited.add(id); const model = manifest.models[id]; const current = model?.revisions.find((item) => item.id === model.currentRevisionId); return (current?.children ?? []).reduce((total, child) => total + 1 + countDescendants(manifest, child.modelId, visited), 0);
  }
  function tree(manifest, id, visited = new Set()) {
    if (visited.has(id)) throw new ModelStoreError("cycle_detected", "모델 트리에 순환 참조가 있습니다.");
    visited.add(id); const model = manifest.models[id]; if (!model) throw new ModelStoreError("model_not_found", "제품 모델을 찾을 수 없습니다.");
    const revision = model.revisions.find((item) => item.id === model.currentRevisionId) ?? null;
    return { ...modelSummary(manifest, model), children: (revision?.children ?? []).map((child) => ({ ...child, model: tree(manifest, child.modelId, new Set(visited)) })) };
  }
  async function createParent({ name, source = "draft" } = {}) {
    return mutate(async (manifest) => {
      const id = `model-${randomUUID().slice(0, 12)}`; const createdAt = now();
      const model = { id, name: String(name ?? "새 제품 모델").trim() || "새 제품 모델", parentId: null, source, revision: 0, revisions: [], currentRevisionId: null, publishedRevisionId: null, skuId: null, createdAt, updatedAt: createdAt };
      manifest.models[id] = model; createRevision(model, { state: "empty", source, summary: "구성 부품을 기다리는 빈 부모 모델입니다." }); return modelSummary(manifest, model);
    });
  }
  async function attachBuild({ parentModelId, name, jobId, componentVersions, assemblyPath, status, summary }) {
    return mutate(async (manifest) => {
      let parent = parentModelId ? manifest.models[parentModelId] : null;
      if (!parent) {
        const id = `model-${randomUUID().slice(0, 12)}`; const createdAt = now(); parent = { id, name: name || `조립 모델 ${jobId}`, parentId: null, source: "generated", revision: 0, revisions: [], currentRevisionId: null, publishedRevisionId: null, skuId: null, createdAt, updatedAt: createdAt }; manifest.models[id] = parent; createRevision(parent, { state: "empty", source: "generated", summary: "생성 결과를 기다리는 부모 모델입니다." });
      }
      if (parent.parentId) throw new ModelStoreError("not_root_model", "빌드 결과는 최상위 부모 모델에만 추가할 수 있습니다.");
      const children = [];
      for (const item of componentVersions) {
        const artifactId = await storeArtifact(manifest, item.sourcePath); const id = `model-${randomUUID().slice(0, 12)}`; const createdAt = now();
        const child = { id, name: item.name ?? item.component, parentId: parent.id, source: "component", componentVersion: { component: item.component, versionId: item.versionId }, revision: 0, revisions: [], currentRevisionId: null, publishedRevisionId: null, skuId: null, createdAt, updatedAt: createdAt };
        manifest.models[id] = child; const childRevision = createRevision(child, { artifactId, state: "ready", source: "component", summary: item.summary ?? "생성된 구성 부품" }); children.push({ modelId: child.id, revisionId: childRevision.id, transform: item.transform ?? null });
      }
      const assemblyArtifactId = await storeArtifact(manifest, assemblyPath);
      const revision = createRevision(parent, { artifactId: assemblyArtifactId, children, state: status === "failed" ? "failed" : "ready", source: "build", summary: summary ?? "Blender 조립 결과" });
      return { model: modelSummary(manifest, parent), revision: publicRevision(revision) };
    });
  }
  async function attachLibraryAssembly({ parentModelId, componentVersions, assemblyPath, expectedRevision, summary = "선택한 자산 라이브러리 조립" }) {
    return mutate(async (manifest) => {
      const parent = rootModel(manifest, parentModelId); if (expectedRevision !== parent.revision) throw new ModelStoreError("revision_conflict", "모델 목록이 최신이 아닙니다.", { model: modelSummary(manifest, parent) }); const children = [];
      for (const item of componentVersions) {
        const artifactId = await storeArtifact(manifest, item.sourcePath); const id = `model-${randomUUID().slice(0, 12)}`; const createdAt = now();
        const child = { id, name: item.name ?? item.component, parentId: parent.id, source: "library", componentVersion: { component: item.component, versionId: item.versionId }, revision: 0, revisions: [], currentRevisionId: null, publishedRevisionId: null, skuId: null, createdAt, updatedAt: createdAt };
        manifest.models[id] = child; const childRevision = createRevision(child, { artifactId, state: "ready", source: "library", summary: item.summary ?? "선택한 컴포넌트 버전" }); children.push({ modelId: child.id, revisionId: childRevision.id, transform: item.transform ?? null });
      }
      const revision = createRevision(parent, { artifactId: await storeArtifact(manifest, assemblyPath), children, state: "ready", source: "library", summary });
      return { model: modelSummary(manifest, parent), revision: publicRevision(revision) };
    });
  }
  async function listRoots() { const manifest = await load(); return Object.values(manifest.models).filter((model) => !model.parentId).map((model) => modelSummary(manifest, model)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  async function getRoot(id) { const manifest = await load(); return modelSummary(manifest, rootModel(manifest, id)); }
  async function getTree(id) { const manifest = await load(); return tree(manifest, id); }
  async function bindSku(id, skuId, expectedRevision) {
    return mutate(async (manifest) => {
      const model = rootModel(manifest, id); if (expectedRevision !== model.revision) throw new ModelStoreError("revision_conflict", "모델 목록이 최신이 아닙니다.", { model: modelSummary(manifest, model) });
      if (skuId !== null && !skuIds.has(skuId)) throw new ModelStoreError("unknown_sku", "알 수 없는 SKU입니다.");
      if (skuId) { const boundId = manifest.bindings[skuId]; if (boundId && boundId !== model.id) throw new ModelStoreError("sku_already_bound", "이 SKU는 다른 부모 모델에 이미 연결되어 있습니다.", { modelId: boundId }); }
      if (model.skuId && model.skuId !== skuId) delete manifest.bindings[model.skuId];
      if (skuId) manifest.bindings[skuId] = model.id; model.skuId = skuId; model.revision += 1; model.updatedAt = now(); return modelSummary(manifest, model);
    });
  }
  async function publish(id, revisionId, expectedRevision) {
    return mutate(async (manifest) => {
      const model = rootModel(manifest, id); if (expectedRevision !== model.revision) throw new ModelStoreError("revision_conflict", "모델 목록이 최신이 아닙니다.", { model: modelSummary(manifest, model) });
      const revision = model.revisions.find((item) => item.id === revisionId); if (!revision) throw new ModelStoreError("revision_not_found", "게시할 모델 리비전을 찾을 수 없습니다.");
      if (!revision.artifactId) throw new ModelStoreError("empty_revision", "빈 부모 모델은 구성 부품을 추가한 뒤 게시할 수 있습니다.");
      const publication = Object.values(manifest.publications).find((item) => item.modelId === model.id && item.revisionId === revision.id) ?? { id: `publication-${randomUUID().slice(0, 12)}`, modelId: model.id, revisionId: revision.id, artifactId: revision.artifactId, createdAt: now() };
      manifest.publications[publication.id] = publication; model.publishedRevisionId = revision.id; model.revision += 1; model.updatedAt = now(); revision.state = "published"; return { model: modelSummary(manifest, model), publication: { ...publication, assetPath: `/api/modeling/publications/${publication.id}/artifact` } };
    });
  }
  async function runtimeForSku(skuId) {
    if (!skuIds.has(skuId)) throw new ModelStoreError("unknown_sku", "알 수 없는 SKU입니다."); const manifest = await load(); const modelId = manifest.bindings[skuId];
    if (!modelId) return { skuId, state: "unassigned", model: null, assetPath: null };
    const model = manifest.models[modelId]; const revision = model?.revisions.find((item) => item.id === model.publishedRevisionId) ?? null;
    if (!revision?.artifactId) return { skuId, state: "empty", model: modelSummary(manifest, model), assetPath: null };
    const publication = Object.values(manifest.publications).find((item) => item.modelId === model.id && item.revisionId === revision.id);
    return { skuId, state: "ready", model: modelSummary(manifest, model), publicationId: publication?.id ?? null, assetPath: publication ? `/api/modeling/publications/${publication.id}/artifact` : `/api/modeling/artifacts/${revision.artifactId}` };
  }
  async function publicationArtifactPath(id) { const manifest = await load(); const publication = manifest.publications[id]; return publication ? artifactPath(publication.artifactId) : null; }
  function artifactPath(id) { return path.join(root, "artifacts", `${cleanId(id)}.glb`); }
  async function referencesComponentVersion(component, versionId) { const manifest = await load(); return Object.values(manifest.models).some((model) => model.componentVersion?.component === component && model.componentVersion?.versionId === versionId); }
  async function migrateLegacy({ versionStore, jobsRoot }) {
    return mutate(async (manifest) => {
      const jobs = await fs.readdir(jobsRoot, { withFileTypes: true }).catch(() => []);
      for (const entry of jobs.filter((item) => item.isDirectory())) {
        if (manifest.migrations.legacyJobs[entry.name]) continue;
        const assemblyPath = path.join(jobsRoot, entry.name, "render", "assembly.glb"); if (!existsSync(assemblyPath)) continue;
        const requestPath = path.join(jobsRoot, entry.name, "request.json"); let name = `조립 모델 ${entry.name.slice(-8)}`;
        try { const request = JSON.parse(await fs.readFile(requestPath, "utf8")); name = request.spec?.contract?.product?.name ?? request.payload?.prompt?.slice(0, 80) ?? name; } catch { /* legacy metadata is optional */ }
        const componentVersions = [];
        for (const component of Object.keys((await versionStore.manifest()).components)) {
          const version = (await versionStore.list(component)).find((item) => item.jobId === entry.name); if (version) componentVersions.push({ component, versionId: version.id, sourcePath: versionStore.artifactPath(component, version.id), name: component, summary: version.summary, transform: version.transform });
        }
        const id = `legacy-${cleanId(entry.name)}`; const createdAt = now(); const parent = { id, name, parentId: null, source: "legacy", revision: 0, revisions: [], currentRevisionId: null, publishedRevisionId: null, skuId: null, createdAt, updatedAt: createdAt }; manifest.models[id] = parent; createRevision(parent, { state: "empty", source: "legacy", summary: "이전 작업에서 가져온 부모 모델입니다." });
        const children = [];
        for (const item of componentVersions) { const artifactId = await storeArtifact(manifest, item.sourcePath); const childId = `legacy-child-${randomUUID().slice(0, 10)}`; const childCreatedAt = now(); const child = { id: childId, name: item.name, parentId: parent.id, source: "legacy-component", componentVersion: { component: item.component, versionId: item.versionId }, revision: 0, revisions: [], currentRevisionId: null, publishedRevisionId: null, skuId: null, createdAt: childCreatedAt, updatedAt: childCreatedAt }; manifest.models[childId] = child; const childRevision = createRevision(child, { artifactId, state: "ready", source: "legacy", summary: item.summary }); children.push({ modelId: childId, revisionId: childRevision.id, transform: item.transform ?? null }); }
        createRevision(parent, { artifactId: await storeArtifact(manifest, assemblyPath), children, state: "ready", source: "legacy", summary: "이전 Blender 조립 결과" }); manifest.migrations.legacyJobs[entry.name] = true;
      }
      if (!manifest.migrations.legacyShowcase) { const showcase = await versionStore.showcase(); const source = versionStore.showcaseArtifactPath(); if (showcase && existsSync(source)) { const id = "legacy-showcase"; if (!manifest.models[id]) { const createdAt = now(); const parent = { id, name: "이전 전역 쇼케이스", parentId: null, source: "legacy", revision: 0, revisions: [], currentRevisionId: null, publishedRevisionId: null, skuId: null, createdAt, updatedAt: createdAt }; manifest.models[id] = parent; createRevision(parent, { state: "empty", source: "legacy", summary: "이전 전역 쇼케이스입니다." }); createRevision(parent, { artifactId: await storeArtifact(manifest, source), state: "ready", source: "legacy", summary: "SKU 미연결 이전 쇼케이스" }); } } manifest.migrations.legacyShowcase = true; }
    });
  }
  return { initialise: () => fs.mkdir(root, { recursive: true }), createParent, attachBuild, attachLibraryAssembly, listRoots, getRoot, getTree, bindSku, publish, runtimeForSku, publicationArtifactPath, artifactPath, referencesComponentVersion, migrateLegacy };
}
