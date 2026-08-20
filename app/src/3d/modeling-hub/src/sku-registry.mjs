import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const registryPath = [
  path.resolve(moduleDir, "../../../modeling-studio/sku-registry.json"),
  path.resolve(moduleDir, "../sku-registry.json"),
].find(existsSync);
if (!registryPath) throw new Error("SKU registry를 찾을 수 없습니다.");
const registry = JSON.parse(readFileSync(registryPath, "utf8"));

export const SKU_REGISTRY = Object.freeze(registry.skus.map((item) => Object.freeze({ id: item.id, label: item.label })));
export const SKU_IDS = new Set(SKU_REGISTRY.map((item) => item.id));

export function isKnownSku(value) {
  return typeof value === "string" && SKU_IDS.has(value);
}
