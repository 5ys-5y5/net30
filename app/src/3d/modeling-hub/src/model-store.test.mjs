import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createModelStore, ModelStoreError } from "./model-store.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "net30-model-store-"));
const glb = path.join(root, "fixture.glb");
await writeFile(glb, Buffer.concat([Buffer.from("glTF"), Buffer.alloc(32)]));
const store = createModelStore(root, { skuIds: new Set(["all-in-one-pilot", "all-in-one-growth"]) });
await store.initialise();
const first = await store.createParent({ name: "빈 부모" });
assert.equal(first.status, "empty");
assert.equal(first.kind, "assembly");
assert.equal((await store.runtimeForSku("all-in-one-pilot")).state, "unassigned");
const bound = await store.bindSku(first.id, "all-in-one-pilot", first.revision);
assert.equal(bound.linkedSkuId, "all-in-one-pilot");
assert.equal((await store.runtimeForSku("all-in-one-pilot")).state, "empty");
const second = await store.createParent({ name: "다른 부모" });
await assert.rejects(() => store.bindSku(second.id, "all-in-one-pilot", second.revision), (error) => error instanceof ModelStoreError && error.code === "sku_already_bound");
const attached = await store.attachLibraryAssembly({ parentModelId: first.id, expectedRevision: bound.revision, assemblyPath: glb, componentVersions: [{ component: "cap", versionId: "cap-v1", sourcePath: glb }] });
assert.equal(attached.model.directChildren, 1);
assert.equal((await store.runtimeForSku("all-in-one-pilot")).state, "empty");
const published = await store.publish(first.id, attached.revision.id, attached.model.revision);
assert.ok(published.publication.id);
assert.equal((await store.runtimeForSku("all-in-one-pilot")).state, "ready");

// A parent revision must pin the child revision it was assembled with.
const beforeRefine = await store.getTree(first.id, attached.revision.id);
const childId = beforeRefine.children[0].model.id;
const childRevisionBefore = beforeRefine.children[0].revisionId;
assert.equal(beforeRefine.children[0].model.kind, "component");
assert.equal(beforeRefine.children[0].path, beforeRefine.children[0].id);
const selectedInputs = await store.assemblyInputs(first.id, attached.revision.id, [beforeRefine.children[0].path]);
assert.equal(selectedInputs.length, 1);
assert.equal(selectedInputs[0].component, beforeRefine.children[0].path);
await assert.rejects(() => store.assemblyInputs(first.id, attached.revision.id, ["unknown-child-path"]), (error) => error instanceof ModelStoreError && error.code === "selection_not_found");
const refined = await store.attachBuild({
  parentModelId: first.id,
  jobId: "refine-child",
  componentVersions: [{ component: "cap-refined", versionId: "cap-v2", sourcePath: glb, name: "캡" }],
  assemblyPath: glb,
  status: "complete",
  target: { mode: "refine-node", targetModelId: childId },
  expectedRevision: published.model.revision,
  baseRevisionId: published.model.currentRevision.id,
});
const pinned = await store.getTree(first.id, attached.revision.id);
const latest = await store.getTree(first.id);
assert.equal(pinned.children[0].revisionId, childRevisionBefore);
assert.equal(latest.children[0].modelId, childId);
assert.notEqual(latest.children[0].revisionId, childRevisionBefore);
assert.equal(refined.model.status, "unpublished");

// Component visibility belongs to a new assembly revision; prior revisions remain intact.
const visibilityBase = await store.getRoot(first.id);
const hidden = await store.updateChildRef({ parentModelId: first.id, childRefId: latest.children[0].id, expectedRevision: visibilityBase.revision, baseRevisionId: visibilityBase.currentRevision.id, visible: false, assemblyPath: null });
const hiddenTree = await store.getTree(first.id);
assert.equal(hiddenTree.children[0].visible, false);
assert.equal((await store.assemblyInputs(first.id, hiddenTree.selectedRevision.id)).length, 0);
assert.equal((await store.assemblyInputs(first.id, latest.selectedRevision.id)).length, 1);

// A linked parent cannot be deleted; it can be unbound, archived, and restored.
await assert.rejects(() => store.archiveRoot(first.id, hidden.model.revision), (error) => error instanceof ModelStoreError && error.code === "model_bound");
const unbound = await store.bindSku(first.id, null, hidden.model.revision);
const archived = await store.archiveRoot(first.id, unbound.revision);
assert.equal(archived.status, "archived");
assert.equal((await store.listRoots()).some((item) => item.id === first.id), false);
const restored = await store.restoreRoot(first.id, archived.revision);
assert.notEqual(restored.status, "archived");

// Child removal produces a new parent revision without rewriting old history.
const current = await store.getRoot(first.id);
const remove = await store.removeChild({ parentModelId: first.id, childRefId: latest.children[0].id, expectedRevision: current.revision, baseRevisionId: current.currentRevision.id, assemblyPath: null });
assert.equal((await store.getTree(first.id)).children.length, 0);
assert.equal((await store.getTree(first.id, latest.selectedRevision.id)).children.length, 1);
assert.equal(remove.model.status, "unpublished");
const emptyAssembly = await store.getTree(first.id);
assert.equal(emptyAssembly.selectedRevision.assetPath, null);
assert.equal(emptyAssembly.selectedRevision.state, "empty");
console.log("model-store tests passed");
