import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const now = () => new Date().toISOString();
const cleanId = (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, "");
const clone = (value) => JSON.parse(JSON.stringify(value));

export class ModelStoreError extends Error {
  constructor(code, message, detail = {}) { super(message); this.code = code; this.detail = detail; }
}

function emptyManifest() {
  return { version: 2, artifacts: {}, models: {}, publications: {}, bindings: {}, migrations: { schemaV2: true, legacyJobs: {}, legacyShowcase: false } };
}

/** Immutable product hierarchy. Parent revisions pin ChildRef.revisionId. */
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
    queue = run.catch(() => undefined); return run;
  }
  function childRef(value, order) { return { id: value.id ?? `childref-${randomUUID().slice(0, 12)}`, modelId: value.modelId, revisionId: value.revisionId, transform: value.transform ?? null, order: Number.isInteger(value.order) ? value.order : order }; }
  function upgrade(manifest) {
    if (Number(manifest.version ?? 1) >= 2 && manifest.migrations?.schemaV2) return false;
    for (const value of Object.values(manifest.models ?? {})) {
      value.archivedAt ??= null; value.revisions ??= [];
      for (const revision of value.revisions) revision.children = (revision.children ?? []).map(childRef);
    }
    manifest.version = 2; manifest.migrations = { ...(manifest.migrations ?? {}), schemaV2: true }; return true;
  }
  async function initialise() {
    await fs.mkdir(root, { recursive: true });
    if (!existsSync(indexPath)) return;
    const raw = JSON.parse(await fs.readFile(indexPath, "utf8"));
    if (Number(raw.version ?? 1) < 2 || !raw.migrations?.schemaV2) {
      await fs.writeFile(`${indexPath}.v1-backup-${Date.now()}.json`, `${JSON.stringify(raw, null, 2)}\n`);
      await mutate(async (manifest) => { upgrade(manifest); return null; });
    }
  }
  async function storeArtifact(manifest, sourcePath) {
    if (!sourcePath || !existsSync(sourcePath)) throw new ModelStoreError("artifact_missing", "모델 GLB를 찾을 수 없습니다.");
    const bytes = await fs.readFile(sourcePath);
    if (bytes.length < 20 || bytes.subarray(0, 4).toString("ascii") !== "glTF") throw new ModelStoreError("artifact_invalid", "유효한 GLB만 제품 모델로 저장할 수 있습니다.");
    const hash = createHash("sha256").update(bytes).digest("hex"); const id = `artifact-${hash.slice(0, 20)}`;
    if (!manifest.artifacts[id]) {
      const target = path.join(root, "artifacts", `${id}.glb`); await fs.mkdir(path.dirname(target), { recursive: true });
      if (!existsSync(target)) await fs.writeFile(target, bytes);
      manifest.artifacts[id] = { id, hash, byteLength: bytes.length, createdAt: now() };
    }
    return id;
  }
  function model(manifest, id, { includeArchived = false } = {}) {
    const value = manifest.models[id];
    if (!value) throw new ModelStoreError("model_not_found", "제품 모델을 찾을 수 없습니다.");
    if (value.archivedAt && !includeArchived) throw new ModelStoreError("model_archived", "보관된 모델입니다.");
    return value;
  }
  function rootModel(manifest, id, options) { const value = model(manifest, id, options); if (value.parentId) throw new ModelStoreError("not_root_model", "SKU는 최상위 부모 모델에만 연결할 수 있습니다."); return value; }
  function revisionOf(value, id = value.currentRevisionId) { const revision = value?.revisions?.find((item) => item.id === id); if (!revision) throw new ModelStoreError("revision_not_found", "모델 리비전을 찾을 수 없습니다."); return revision; }
  function createNode(manifest, { name, parentId = null, source = "manual" }) {
    const id = `model-${randomUUID().slice(0, 12)}`; const createdAt = now();
    const value = { id, name: String(name ?? "새 모델").trim() || "새 모델", parentId, source, revision: 0, revisions: [], currentRevisionId: null, publishedRevisionId: null, skuId: null, archivedAt: null, createdAt, updatedAt: createdAt };
    manifest.models[id] = value; return value;
  }
  function createRevision(value, { artifactId = null, children = [], state = artifactId ? "ready" : "empty", source = "manual", summary = "" } = {}) {
    const id = `${value.id}-r${value.revisions.length + 1}`;
    const revision = { id, ordinal: value.revisions.length + 1, artifactId, children: children.map(childRef), state, source, summary, createdAt: now() };
    value.revisions.push(revision); value.currentRevisionId = id; value.updatedAt = now(); value.revision += 1; return revision;
  }
  function publicRevision(revision) { return { id: revision.id, ordinal: revision.ordinal, state: revision.state, source: revision.source, summary: revision.summary, artifactId: revision.artifactId, assetPath: revision.artifactId ? `/api/modeling/artifacts/${revision.artifactId}` : null, childCount: revision.children.length, createdAt: revision.createdAt }; }
  function countDescendants(manifest, id, revisionId, seen = new Set()) {
    const key = `${id}:${revisionId ?? "current"}`; if (seen.has(key)) return 0; seen.add(key);
    const value = manifest.models[id]; if (!value) return 0; const revision = revisionOf(value, revisionId);
    return revision.children.reduce((total, ref) => total + 1 + countDescendants(manifest, ref.modelId, ref.revisionId, new Set(seen)), 0);
  }
  function statusFor(value, current, published) {
    if (value.archivedAt) return "archived";
    if (!current) return "empty";
    if (current.state === "failed") return "failed";
    if (published && current.id !== published.id) return "unpublished";
    return published ? "published" : current.state ?? "empty";
  }
  function summary(manifest, value) {
    const current = value.currentRevisionId ? revisionOf(value) : null; const published = value.publishedRevisionId ? revisionOf(value, value.publishedRevisionId) : null;
    return { id: value.id, name: value.name, parentId: value.parentId ?? null, revision: value.revision, linkedSkuId: value.skuId ?? null, currentRevision: current && publicRevision(current), publishedRevision: published && publicRevision(published), directChildren: current?.children.length ?? 0, descendantCount: current ? countDescendants(manifest, value.id, current.id) : 0, status: statusFor(value, current, published), archivedAt: value.archivedAt ?? null, createdAt: value.createdAt, updatedAt: value.updatedAt, source: value.source };
  }
  function tree(manifest, id, revisionId, seen = new Set()) {
    const value = model(manifest, id, { includeArchived: true }); const revision = revisionOf(value, revisionId); const key = `${id}:${revision.id}`;
    if (seen.has(key)) throw new ModelStoreError("cycle_detected", "모델 트리에 순환 참조가 있습니다."); seen.add(key);
    return { ...summary(manifest, value), selectedRevision: publicRevision(revision), children: [...revision.children].sort((a, b) => a.order - b.order).map((ref) => ({ ...clone(ref), model: tree(manifest, ref.modelId, ref.revisionId, new Set(seen)) })) };
  }
  function ensureBase(parent, expectedRevision, baseRevisionId = parent.currentRevisionId) {
    if (expectedRevision !== parent.revision || baseRevisionId !== parent.currentRevisionId) throw new ModelStoreError("revision_conflict", "모델 목록 또는 조립 기준 리비전이 최신이 아닙니다.", { model: summaryFromError(parent), latestRevision: parent.revision, currentRevisionId: parent.currentRevisionId });
  }
  function summaryFromError(value) { return { id: value.id, revision: value.revision, currentRevisionId: value.currentRevisionId }; }
  function parentChildren(parent) { return clone(revisionOf(parent).children); }
  function nodeArtifactPath(artifactId) { return path.join(root, "artifacts", `${cleanId(artifactId)}.glb`); }

  async function createParent({ name, source = "draft" } = {}) { return mutate(async (manifest) => { const parent = createNode(manifest, { name: name ?? "새 제품 모델", source }); createRevision(parent, { state: "empty", source, summary: "구성 부품을 기다리는 빈 부모 모델입니다." }); return summary(manifest, parent); }); }
  async function createChild({ parentModelId, expectedRevision, baseRevisionId, name, source = "manual", assemblyPath = null }) {
    return mutate(async (manifest) => {
      const parent = rootModel(manifest, parentModelId); ensureBase(parent, expectedRevision, baseRevisionId); const child = createNode(manifest, { name, parentId: parent.id, source }); createRevision(child, { state: "empty", source, summary: "AI 보완 또는 자산 연결을 기다리는 빈 하위 자산입니다." });
      const prior = revisionOf(parent); const artifactId = assemblyPath === undefined ? prior.artifactId : assemblyPath ? await storeArtifact(manifest, assemblyPath) : null; const children = [...parentChildren(parent), childRef({ modelId: child.id, revisionId: child.currentRevisionId, transform: null }, prior.children.length)];
      const revision = createRevision(parent, { artifactId, children, state: artifactId ? "ready" : "empty", source, summary: `${child.name} 하위 자산을 추가했습니다.` }); return { model: summary(manifest, parent), child: summary(manifest, child), revision: publicRevision(revision) };
    });
  }
  async function renameModel(id, name, expectedRevision) { return mutate(async (manifest) => { const value = model(manifest, id, { includeArchived: true }); if (expectedRevision !== value.revision) throw new ModelStoreError("revision_conflict", "모델 목록이 최신이 아닙니다.", { model: summary(manifest, value) }); const next = String(name ?? "").trim(); if (!next) throw new ModelStoreError("invalid_name", "모델 이름을 입력하세요."); value.name = next.slice(0, 160); value.revision += 1; value.updatedAt = now(); return summary(manifest, value); }); }
  async function archiveRoot(id, expectedRevision) { return mutate(async (manifest) => { const parent = rootModel(manifest, id); if (expectedRevision !== parent.revision) throw new ModelStoreError("revision_conflict", "모델 목록이 최신이 아닙니다.", { model: summary(manifest, parent) }); if (parent.skuId) throw new ModelStoreError("model_bound", "SKU 연결을 먼저 해제한 뒤 부모 모델을 삭제하세요.", { model: summary(manifest, parent) }); parent.archivedAt = now(); parent.revision += 1; parent.updatedAt = now(); return summary(manifest, parent); }); }
  async function restoreRoot(id, expectedRevision) { return mutate(async (manifest) => { const parent = rootModel(manifest, id, { includeArchived: true }); if (expectedRevision !== parent.revision) throw new ModelStoreError("revision_conflict", "모델 목록이 최신이 아닙니다.", { model: summary(manifest, parent) }); parent.archivedAt = null; parent.revision += 1; parent.updatedAt = now(); return summary(manifest, parent); }); }
  async function updateChildRef({ parentModelId, childRefId, expectedRevision, baseRevisionId, transform, order, revisionId, assemblyPath, summary: note = "하위 자산 조립 정보를 수정했습니다." }) {
    return mutate(async (manifest) => {
      const parent = rootModel(manifest, parentModelId); ensureBase(parent, expectedRevision, baseRevisionId); const children = parentChildren(parent); const index = children.findIndex((item) => item.id === childRefId); if (index < 0) throw new ModelStoreError("child_not_found", "하위 자산 연결을 찾을 수 없습니다.");
      const current = children[index]; if (revisionId) revisionOf(model(manifest, current.modelId, { includeArchived: true }), revisionId); children[index] = { ...current, transform: transform === undefined ? current.transform : transform, order: Number.isInteger(order) ? order : current.order, revisionId: revisionId ?? current.revisionId };
      const artifactId = assemblyPath === undefined ? revisionOf(parent).artifactId : assemblyPath ? await storeArtifact(manifest, assemblyPath) : null; const revision = createRevision(parent, { artifactId, children, state: artifactId ? "ready" : "empty", source: "library", summary: note }); return { model: summary(manifest, parent), revision: publicRevision(revision) };
    });
  }
  async function removeChild({ parentModelId, childRefId, expectedRevision, baseRevisionId, assemblyPath }) {
    return mutate(async (manifest) => {
      const parent = rootModel(manifest, parentModelId); ensureBase(parent, expectedRevision, baseRevisionId); const children = parentChildren(parent); const removed = children.find((item) => item.id === childRefId); if (!removed) throw new ModelStoreError("child_not_found", "하위 자산 연결을 찾을 수 없습니다.");
      const child = model(manifest, removed.modelId, { includeArchived: true }); child.archivedAt = now(); child.revision += 1; child.updatedAt = now(); const remaining = children.filter((item) => item.id !== childRefId).map((item, order) => ({ ...item, order })); const artifactId = assemblyPath === undefined ? revisionOf(parent).artifactId : assemblyPath ? await storeArtifact(manifest, assemblyPath) : null;
      const revision = createRevision(parent, { artifactId, children: remaining, state: artifactId ? "ready" : "empty", source: "library", summary: `${child.name} 하위 자산을 현재 조립에서 제거했습니다.` }); return { model: summary(manifest, parent), removed: summary(manifest, child), revision: publicRevision(revision) };
    });
  }
  async function restoreChild({ parentModelId, childModelId, expectedRevision, baseRevisionId, assemblyPath }) {
    return mutate(async (manifest) => {
      const parent = rootModel(manifest, parentModelId); ensureBase(parent, expectedRevision, baseRevisionId); const child = model(manifest, childModelId, { includeArchived: true }); if (child.parentId !== parent.id) throw new ModelStoreError("parent_mismatch", "이 부모 모델의 하위 자산이 아닙니다.");
      child.archivedAt = null; child.revision += 1; child.updatedAt = now(); const prior = revisionOf(parent); const children = [...parentChildren(parent), childRef({ modelId: child.id, revisionId: child.currentRevisionId, transform: null }, prior.children.length)]; const artifactId = assemblyPath === undefined ? prior.artifactId : assemblyPath ? await storeArtifact(manifest, assemblyPath) : null;
      const revision = createRevision(parent, { artifactId, children, state: artifactId ? "ready" : "empty", source: "restore", summary: `${child.name} 하위 자산을 복원했습니다.` }); return { model: summary(manifest, parent), child: summary(manifest, child), revision: publicRevision(revision) };
    });
  }
  async function attachBuild({ parentModelId, name, jobId, componentVersions, assemblyPath, status, summary: note, target = null, expectedRevision, baseRevisionId }) {
    return mutate(async (manifest) => {
      let parent; if (parentModelId) parent = rootModel(manifest, parentModelId); else { parent = createNode(manifest, { name: name || `조립 모델 ${jobId}`, source: "generated" }); createRevision(parent, { state: "empty", source: "generated", summary: "생성 결과를 기다리는 부모 모델입니다." }); }
      if (expectedRevision !== undefined) ensureBase(parent, expectedRevision, baseRevisionId); const children = parentChildren(parent);
      for (const item of componentVersions) {
        const artifactId = await storeArtifact(manifest, item.sourcePath); const targetId = target?.mode === "refine-node" ? target.targetModelId : target?.targetModelIds?.[item.component] ?? null; let child = targetId ? model(manifest, targetId, { includeArchived: true }) : null;
        if (child && child.parentId !== parent.id) throw new ModelStoreError("parent_mismatch", "보완 대상이 선택한 부모의 하위 자산이 아닙니다."); if (!child) { child = createNode(manifest, { name: item.name ?? item.component, parentId: parent.id, source: "component" }); createRevision(child, { state: "empty", source: "component", summary: "생성 전 하위 자산" }); }
        child.archivedAt = null; const childRevision = createRevision(child, { artifactId, state: "ready", source: "component", summary: item.summary ?? "생성된 구성 부품" }); const index = children.findIndex((ref) => ref.modelId === child.id); const ref = childRef({ id: index >= 0 ? children[index].id : undefined, modelId: child.id, revisionId: childRevision.id, transform: item.transform ?? (index >= 0 ? children[index].transform : null), order: index >= 0 ? children[index].order : children.length }, index >= 0 ? children[index].order : children.length); if (index >= 0) children[index] = ref; else children.push(ref);
      }
      const revision = createRevision(parent, { artifactId: await storeArtifact(manifest, assemblyPath), children, state: status === "failed" ? "failed" : "ready", source: "build", summary: note ?? "Blender 조립 결과" }); return { model: summary(manifest, parent), revision: publicRevision(revision) };
    });
  }
  async function attachLibraryAssembly({ parentModelId, componentVersions, assemblyPath, expectedRevision, baseRevisionId, summary: note = "선택한 자산 라이브러리 조립" }) { return attachBuild({ parentModelId, componentVersions, assemblyPath, expectedRevision, baseRevisionId, status: "complete", summary: note }); }
  async function createAssemblyRevision({ parentModelId, expectedRevision, baseRevisionId, childRefIds, assemblyPath, summary: note = "선택한 하위 자산 조립" }) { return mutate(async (manifest) => { const parent = rootModel(manifest, parentModelId); ensureBase(parent, expectedRevision, baseRevisionId); const selected = new Set(childRefIds ?? []); const children = parentChildren(parent).filter((ref) => selected.has(ref.id)); if (!children.length) throw new ModelStoreError("empty_selection", "조립할 하위 자산을 선택하세요."); const revision = createRevision(parent, { artifactId: await storeArtifact(manifest, assemblyPath), children, state: "ready", source: "library", summary: note }); return { model: summary(manifest, parent), revision: publicRevision(revision) }; }); }
  async function listRoots({ includeArchived = false } = {}) { const manifest = await load(); return Object.values(manifest.models).filter((value) => !value.parentId && (includeArchived || !value.archivedAt)).map((value) => summary(manifest, value)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  async function getRoot(id, options) { const manifest = await load(); return summary(manifest, rootModel(manifest, id, options)); }
  async function getTree(id, revisionId) { const manifest = await load(); return tree(manifest, id, revisionId); }
  async function revisions(id) { const manifest = await load(); return model(manifest, id, { includeArchived: true }).revisions.map(publicRevision); }
  async function assemblyInputs(id, revisionId) { const manifest = await load(); const parent = rootModel(manifest, id, { includeArchived: true }); const revision = revisionOf(parent, revisionId); return revision.children.map((ref) => { const child = model(manifest, ref.modelId, { includeArchived: true }); const childRevision = revisionOf(child, ref.revisionId); if (!childRevision.artifactId) throw new ModelStoreError("child_artifact_missing", `${child.name} 하위 자산에 GLB가 없습니다.`); return { component: ref.id, versionId: childRevision.id, sourcePath: nodeArtifactPath(childRevision.artifactId), transform: ref.transform }; }); }
  async function childInput(id) { const manifest = await load(); const child = model(manifest, id, { includeArchived: true }); const revision = revisionOf(child); if (!revision.artifactId) throw new ModelStoreError("child_artifact_missing", `${child.name} 하위 자산에 GLB가 없습니다.`); return { component: `restore-${child.id}`, versionId: revision.id, sourcePath: nodeArtifactPath(revision.artifactId), transform: null }; }
  async function bindSku(id, skuId, expectedRevision) { return mutate(async (manifest) => { const value = rootModel(manifest, id); if (expectedRevision !== value.revision) throw new ModelStoreError("revision_conflict", "모델 목록이 최신이 아닙니다.", { model: summary(manifest, value) }); if (skuId !== null && !skuIds.has(skuId)) throw new ModelStoreError("unknown_sku", "알 수 없는 SKU입니다."); if (skuId) { const boundId = manifest.bindings[skuId]; if (boundId && boundId !== value.id) throw new ModelStoreError("sku_already_bound", "이 SKU는 다른 부모 모델에 이미 연결되어 있습니다.", { modelId: boundId }); } if (value.skuId && value.skuId !== skuId) delete manifest.bindings[value.skuId]; if (skuId) manifest.bindings[skuId] = value.id; value.skuId = skuId; value.revision += 1; value.updatedAt = now(); return summary(manifest, value); }); }
  async function publish(id, revisionId, expectedRevision) { return mutate(async (manifest) => { const parent = rootModel(manifest, id); if (expectedRevision !== parent.revision) throw new ModelStoreError("revision_conflict", "모델 목록이 최신이 아닙니다.", { model: summary(manifest, parent) }); const revision = revisionOf(parent, revisionId); if (!revision.artifactId) throw new ModelStoreError("empty_revision", "빈 부모 모델은 구성 부품을 추가한 뒤 게시할 수 있습니다."); const publication = Object.values(manifest.publications).find((item) => item.modelId === parent.id && item.revisionId === revision.id) ?? { id: `publication-${randomUUID().slice(0, 12)}`, modelId: parent.id, revisionId: revision.id, artifactId: revision.artifactId, createdAt: now() }; manifest.publications[publication.id] = publication; parent.publishedRevisionId = revision.id; parent.revision += 1; parent.updatedAt = now(); return { model: summary(manifest, parent), publication: { ...publication, assetPath: `/api/modeling/publications/${publication.id}/artifact` } }; }); }
  async function runtimeForSku(skuId) { if (!skuIds.has(skuId)) throw new ModelStoreError("unknown_sku", "알 수 없는 SKU입니다."); const manifest = await load(); const id = manifest.bindings[skuId]; if (!id) return { skuId, state: "unassigned", model: null, assetPath: null }; const parent = manifest.models[id]; const revision = parent?.publishedRevisionId ? revisionOf(parent, parent.publishedRevisionId) : null; if (!revision?.artifactId) return { skuId, state: "empty", model: summary(manifest, parent), assetPath: null }; const publication = Object.values(manifest.publications).find((item) => item.modelId === parent.id && item.revisionId === revision.id); return { skuId, state: "ready", model: summary(manifest, parent), publicationId: publication?.id ?? null, assetPath: publication ? `/api/modeling/publications/${publication.id}/artifact` : `/api/modeling/artifacts/${revision.artifactId}` }; }
  async function publicationArtifactPath(id) { const manifest = await load(); const publication = manifest.publications[id]; return publication ? nodeArtifactPath(publication.artifactId) : null; }
  function artifactPath(id) { return nodeArtifactPath(id); }
  async function referencesComponentVersion(component, versionId) { const manifest = await load(); return Object.values(manifest.models).some((value) => value.componentVersion?.component === component && value.componentVersion?.versionId === versionId && !value.archivedAt); }
  async function migrateLegacy({ versionStore, jobsRoot }) {
    return mutate(async (manifest) => {
      upgrade(manifest); const jobs = await fs.readdir(jobsRoot, { withFileTypes: true }).catch(() => []);
      for (const entry of jobs.filter((item) => item.isDirectory())) {
        if (manifest.migrations.legacyJobs[entry.name]) continue; const assemblyPath = path.join(jobsRoot, entry.name, "render", "assembly.glb"); if (!existsSync(assemblyPath)) continue;
        let name = `조립 모델 ${entry.name.slice(-8)}`; try { const request = JSON.parse(await fs.readFile(path.join(jobsRoot, entry.name, "request.json"), "utf8")); name = request.spec?.contract?.product?.name ?? request.payload?.prompt?.slice(0, 80) ?? name; } catch { /* optional metadata */ }
        const parent = createNode(manifest, { name, source: "legacy" }); createRevision(parent, { state: "empty", source: "legacy", summary: "이전 작업에서 가져온 부모 모델입니다." }); const children = [];
        for (const component of Object.keys((await versionStore.manifest()).components)) { const version = (await versionStore.list(component)).find((item) => item.jobId === entry.name); if (!version) continue; const child = createNode(manifest, { name: component, parentId: parent.id, source: "legacy-component" }); child.componentVersion = { component: version.component, versionId: version.id }; const childRevision = createRevision(child, { artifactId: await storeArtifact(manifest, versionStore.artifactPath(component, version.id)), state: "ready", source: "legacy", summary: version.summary }); children.push(childRef({ modelId: child.id, revisionId: childRevision.id, transform: version.transform ?? null }, children.length)); }
        createRevision(parent, { artifactId: await storeArtifact(manifest, assemblyPath), children, state: "ready", source: "legacy", summary: "이전 Blender 조립 결과" }); manifest.migrations.legacyJobs[entry.name] = true;
      }
      if (!manifest.migrations.legacyShowcase) { const showcase = await versionStore.showcase(); const source = versionStore.showcaseArtifactPath(); if (showcase && existsSync(source)) { const parent = createNode(manifest, { name: "이전 전역 쇼케이스", source: "legacy" }); createRevision(parent, { state: "empty", source: "legacy", summary: "이전 전역 쇼케이스입니다." }); createRevision(parent, { artifactId: await storeArtifact(manifest, source), state: "ready", source: "legacy", summary: "SKU 미연결 이전 쇼케이스" }); } manifest.migrations.legacyShowcase = true; }
    });
  }
  return { initialise, createParent, createChild, renameModel, archiveRoot, restoreRoot, updateChildRef, removeChild, restoreChild, attachBuild, attachLibraryAssembly, createAssemblyRevision, listRoots, getRoot, getTree, revisions, assemblyInputs, childInput, bindSku, publish, runtimeForSku, publicationArtifactPath, artifactPath, referencesComponentVersion, migrateLegacy };
}
