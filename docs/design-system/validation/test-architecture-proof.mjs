import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateDesignSystem } from "./validate-design-system.mjs";

const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const testRoot = await mkdtemp(path.join(os.tmpdir(), "net30-design-proof-"));
const files = [
  "docs/design-system",
  "app/src/main.tsx",
  "app/src/modeling-studio/model-definition.ts",
];

async function fixture(name) {
  const root = path.join(testRoot, name);
  for (const file of files) {
    await cp(path.join(projectRoot, file), path.join(root, file), { recursive: true });
  }
  return root;
}

async function expectFailure(name, mutate, expected) {
  const root = await fixture(name);
  await mutate(root);
  try {
    await validateDesignSystem(root);
  } catch (error) {
    if (String(error).includes(expected)) return;
    throw new Error(`${name}: expected "${expected}", received ${String(error)}`);
  }
  throw new Error(`${name}: validator unexpectedly passed`);
}

try {
  await validateDesignSystem();
  await expectFailure("retired-page", async (root) => {
    await writeFile(path.join(root, "app/src/modeling-studio/ModelPage.tsx"), "export const ModelPage = null;\n");
  }, "must not exist");
  await expectFailure("product-style", async (root) => {
    const file = path.join(root, "app/src/modeling-studio/model-definition.ts");
    await writeFile(file, `${await readFile(file, "utf8")}\nexport const invalidStyle = { className: \"not-allowed\" };\n`);
  }, "product meaning only");
  await expectFailure("missing-token", async (root) => {
    const file = path.join(root, "docs/design-system/tokens.ts");
    await writeFile(file, (await readFile(file, "utf8")).replace('modelingFrame: "ds-modeling-frame", ', ""));
  }, "must register CLASS.modelingFrame");
  console.log("Design-system proof passed: baseline plus retired-page, product-style, and token-authority rejection cases.");
} finally {
  await rm(testRoot, { recursive: true, force: true });
}
