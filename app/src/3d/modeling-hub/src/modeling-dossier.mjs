import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const SECRET_KEY = /(authorization|api[-_]?key|token|secret|password|signed[-_]?url)/i;
const ABSOLUTE_PATH = /(?:\/Users\/|\/home\/|\/root\/|[A-Za-z]:\\)/g;

export function dossierHash(value) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

export function sanitizeDossierValue(value, key = "") {
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => sanitizeDossierValue(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([childKey, item]) => [childKey, sanitizeDossierValue(item, childKey)]));
  if (typeof value === "string") {
    if (/^data:[^,]+;base64,/i.test(value)) return `[CONTENT ${dossierHash(value).slice(0, 12)}]`;
    return value.replace(ABSOLUTE_PATH, "[LOCAL_PATH]/");
  }
  return value;
}

export class ModelingDossier {
  constructor(root, identity) {
    this.root = root;
    this.identity = identity;
    this.events = [];
    this.previousHash = "0".repeat(64);
  }

  record(type, payload = {}) {
    const clean = sanitizeDossierValue(payload);
    const event = { index: this.events.length + 1, at: new Date().toISOString(), type, payload: clean, previousHash: this.previousHash };
    event.hash = dossierHash(event);
    this.events.push(event);
    this.previousHash = event.hash;
    return event;
  }

  async writeSnapshot(relativePath, value) {
    const target = path.join(this.root, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const clean = sanitizeDossierValue(value);
    const content = `${JSON.stringify(clean, null, 2)}\n`;
    await fs.writeFile(target, content);
    this.record("snapshot.written", { relativePath, sha256: dossierHash(content), bytes: Buffer.byteLength(content) });
    return { relativePath, sha256: dossierHash(content), bytes: Buffer.byteLength(content) };
  }

  markdown() {
    const rows = this.events.map((event) => `| ${event.index} | ${event.at} | ${event.type} | ${event.hash.slice(0, 12)} |`).join("\n");
    const errors = this.events.filter((event) => /fail|error|blocked/.test(event.type));
    const details = this.events.map((event) => `### ${event.index}. ${event.type}\n\n- Time: ${event.at}\n- Event hash: \`${event.hash}\`\n- Previous hash: \`${event.previousHash}\`\n\n\`\`\`json\n${JSON.stringify(event.payload, null, 2)}\n\`\`\``).join("\n\n");
    return `# MODELING DOSSIER\n\n` +
      `- Identity: \`${this.identity}\`\n- Events: ${this.events.length}\n- Ledger head: \`${this.previousHash}\`\n- Generated: ${new Date().toISOString()}\n\n` +
      `## Event ledger\n\n| # | Time | Event | Hash |\n|---:|---|---|---|\n${rows || "| 0 | - | no events | - |"}\n\n` +
      `## Failures and manufacturing blockers\n\n${errors.length ? errors.map((event) => `- ${event.type}: ${JSON.stringify(event.payload)}`).join("\n") : "- None recorded."}\n\n` +
      `## Recorded judgments, evidence and artifacts\n\n${details || "- No detailed records."}\n`;
  }

  async finalize(extraManifest = {}) {
    await fs.mkdir(this.root, { recursive: true });
    const ledger = `${this.events.map((event) => JSON.stringify(event)).join("\n")}\n`;
    await fs.mkdir(path.join(this.root, "decisions"), { recursive: true });
    await fs.writeFile(path.join(this.root, "decisions", "events.ndjson"), ledger);
    const markdown = this.markdown();
    await fs.writeFile(path.join(this.root, "MODELING-DOSSIER.md"), markdown);
    const manifest = sanitizeDossierValue({ version: "net30.product-modeling-file.v1", identity: this.identity, eventCount: this.events.length, ledgerHead: this.previousHash, ledgerHash: dossierHash(ledger), dossierHash: dossierHash(markdown), ...extraManifest });
    await fs.writeFile(path.join(this.root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    if (ledger.trim().split("\n").filter(Boolean).length !== manifest.eventCount) throw new Error("dossier_invalid: ledger event count mismatch");
    return manifest;
  }
}
