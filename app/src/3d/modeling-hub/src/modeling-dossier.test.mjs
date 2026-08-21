import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ModelingDossier } from "./modeling-dossier.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "net30-dossier-"));
const dossier = new ModelingDossier(root, "dossier-fixture");
const largeGraph = { graphHash: "a".repeat(64), components: Array.from({ length: 500 }, (_, index) => ({ id: `component-${index}`, requestedName: `component ${index}`, rationale: "measured curve evidence ".repeat(40) })) };
dossier.record("graph.approved", largeGraph);
await dossier.writeSnapshot("graph/modeling-graph.json", largeGraph);
dossier.record("manufacturing.blocked", { blockers: ["thread evidence missing"] });
const manifest = await dossier.finalize({ status: "review_required" });
const markdown = await fs.readFile(path.join(root, "MODELING-DOSSIER.md"), "utf8");
const ledger = await fs.readFile(path.join(root, "decisions", "events.ndjson"), "utf8");

assert.equal(manifest.eventCount, 3, "the event ledger must retain every raw decision record");
assert.equal(ledger.trim().split("\n").length, manifest.eventCount, "the immutable ledger count must match the manifest");
assert.match(markdown, /Evidence, graph, decisions and artifacts/, "the Markdown dossier must index the retained source snapshots");
assert.match(markdown, /graph\/modeling-graph\.json/, "the graph snapshot must be linked from the readable dossier");
assert.match(markdown, /full record: `decisions\/events\.ndjson`/, "large raw records must remain auditable without being copied into Markdown");
assert.ok(Buffer.byteLength(markdown) < 32 * 1024, "a large graph must not make the human-readable dossier balloon with duplicate raw payloads");
assert.match(ledger, /component-499/, "the exact large graph must remain in the immutable ledger");

console.log("Modeling dossier auditability and bounded Markdown proof passed.");
