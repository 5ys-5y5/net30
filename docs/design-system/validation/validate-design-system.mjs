import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ARCHITECTURE } from "./architecture-manifest.mjs";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

const source = async (root, file) => readFile(path.join(root, file), "utf8");
const exists = async (root, file) => access(path.join(root, file)).then(() => true, () => false);
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function validateDesignSystem(root = repositoryRoot) {
  const failures = [];
  const designRoot = ARCHITECTURE.designRoot;

  for (const file of ARCHITECTURE.requiredDesignFiles) {
    if (!await exists(root, path.join(designRoot, file))) failures.push(`${designRoot}/${file} is required`);
  }
  for (const file of [ARCHITECTURE.applicationEntry, ARCHITECTURE.modelDefinition]) {
    if (!await exists(root, file)) failures.push(`${file} is required`);
  }
  for (const file of ARCHITECTURE.retiredModelPage) {
    if (await exists(root, file)) failures.push(`${file} must not exist; /model must use Storefront`);
  }
  if (failures.length) throw new Error(`Design-system validation failed:\n- ${failures.join("\n- ")}`);

  const [entry, definition, storefront, schema, tokens, system, templateMap] = await Promise.all([
    source(root, ARCHITECTURE.applicationEntry),
    source(root, ARCHITECTURE.modelDefinition),
    source(root, `${designRoot}/Storefront.tsx`),
    source(root, `${designRoot}/schema.ts`),
    source(root, `${designRoot}/tokens.ts`),
    source(root, `${designRoot}/system.css`),
    source(root, `${designRoot}/template-map.mjs`),
  ]);

  if (!entry.includes('import { Storefront }') || !entry.includes('<Storefront definition={definition} />')) {
    failures.push("app/src/main.tsx must render every route through Storefront");
  }
  if (/ModelPage|model-page\.css/.test(entry)) failures.push("app/src/main.tsx must not import the retired model page");
  if (/\b(?:className|style|styles|padding|margin|gap|fontSize|borderRadius)\s*:/.test(definition)) {
    failures.push("model-definition.ts may contain product meaning only, never presentation values");
  }
  if (!/presentation\?:\s*"metrics"\s*\|\s*"label"\s*\|\s*"modeling"/.test(schema) || !/modeling\?:\s*ModelingStudioDefinition/.test(schema)) {
    failures.push("schema.ts must own the typed modeling presentation contract");
  }
  if (!/function ModelingCatalogRegion\b/.test(storefront) || !/catalog\.presentation\s*===\s*"modeling"/.test(storefront)) {
    failures.push("Storefront.tsx must centrally compose the modeling presentation");
  }
  if (!/region:\s*"catalog"/.test(templateMap) || !/composition:\s*"CatalogRegion"/.test(templateMap)) {
    failures.push("template-map.mjs must keep the catalog composition in the central registry");
  }

  for (const key of ARCHITECTURE.modelingClassKeys) {
    const keyPattern = new RegExp(`\\b${escapeRegExp(key)}\\s*:\\s*"([^"]+)"`);
    const match = tokens.match(keyPattern);
    if (!match) {
      failures.push(`tokens.ts must register CLASS.${key}`);
      continue;
    }
    const className = match[1];
    if (!new RegExp(`CLASS\\.${escapeRegExp(key)}\\b`).test(storefront)) {
      failures.push(`Storefront.tsx must consume CLASS.${key}`);
    }
    if (!new RegExp(`\\.${escapeRegExp(className)}(?:\\s|\\{|:|,|\\[|>|#|\\.|$)`).test(system)) {
      failures.push(`system.css must define .${className}`);
    }
  }

  if (failures.length) throw new Error(`Design-system validation failed:\n- ${failures.join("\n- ")}`);
  return "Design-system validation passed: /model is Storefront-composed and its presentation remains centralized.";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    console.log(await validateDesignSystem());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
