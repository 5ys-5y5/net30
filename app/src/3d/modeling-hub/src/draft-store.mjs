import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

/** Durable, revisioned modeling drafts.  The volume is the source of truth;
 * the in-memory SSE clients in server.mjs are only a delivery optimisation. */
export function createDraftStore(assetRoot) {
  const root = path.join(assetRoot, "drafts");
  const file = (id) => path.join(root, id, "state.json");
  const log = (id) => path.join(root, id, "decisions.ndjson");
  async function write(id, value) {
    const target = file(id); const temp = `${target}.${randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
    await fs.rename(temp, target);
  }
  async function create(input) {
    const id = `draft-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const value = { id, version: "net30.modeling-draft.v4", revision: 1, state: "analyzing_product", message: "제품과 입력 이미지를 분석 중입니다.", input, product: null, components: [], questions: [], stickerSlots: [], progress: [], nextProgressEventId: 1, jobId: null, events: [], createdAt: now, updatedAt: now };
    await write(id, value); return value;
  }
  async function get(id) { if (!existsSync(file(id))) return null; return JSON.parse(await fs.readFile(file(id), "utf8")); }
  async function save(value) { value.updatedAt = new Date().toISOString(); await write(value.id, value); return value; }
  async function appendDecision(id, decision) { await fs.mkdir(path.dirname(log(id)), { recursive: true }); await fs.appendFile(log(id), `${JSON.stringify({ at: new Date().toISOString(), ...decision })}\n`); }
  async function appendProgress(value, progress) { const event = { eventId: value.nextProgressEventId ?? 1, at: new Date().toISOString(), ...progress }; value.nextProgressEventId = event.eventId + 1; value.progress = [...(value.progress ?? []), event].slice(-240); await save(value); return event; }
  return { initialise: () => fs.mkdir(root, { recursive: true }), create, get, save, appendDecision, appendProgress };
}
