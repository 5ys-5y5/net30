import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ARCHITECTURE } from "./architecture-manifest.mjs";

const project = fileURLToPath(new URL("../../../", import.meta.url));
const testRoot = await mkdtemp(path.join(os.tmpdir(), "allowhite-architecture-proof-"));
const files = [...ARCHITECTURE.codeFiles, ...ARCHITECTURE.styleFiles, ...ARCHITECTURE.generatedFiles, "package.json", "app/design-system/package.json", "app/design-system/AGENTS.md", "app/design-system/DESIGN_ORDER.md", "app/design-system/README.md"];

async function fixture(name) {
  const target = path.join(testRoot, name);
  await mkdir(target, { recursive: true });
  for (const file of files) {
    await mkdir(path.dirname(path.join(target, file)), { recursive: true });
    await cp(path.join(project, file), path.join(target, file));
  }
  await symlink(path.join(project, "node_modules"), path.join(target, "node_modules"));
  return target;
}

async function append(root, file, value) {
  const target = path.join(root, file);
  await writeFile(target, `${await readFile(target, "utf8")}\n${value}\n`);
}

async function replace(root, file, before, after) {
  const target = path.join(root, file);
  await writeFile(target, (await readFile(target, "utf8")).replace(before, after));
}

function execute(root) {
  return spawnSync(process.execPath, ["app/design-system/validation/validate-design-system.mjs"], { cwd: root, encoding: "utf8" });
}

const baseline = await fixture("baseline");
const baselineResult = execute(baseline);
if (baselineResult.status !== 0) throw new Error(`Architecture proof baseline must pass\n${baselineResult.stdout}\n${baselineResult.stderr}`);

function alternateProduct(name, primaryCount, secondaryCount) {
  const primaryOptions = Array.from({ length: primaryCount }, (_, index) => ({ id: `primary-${index}`, code: `P${index + 1}`, name: `${name} ${index + 1}`, detail: `${name} option`, surcharge: 0, visual: { kind: "image", src: `/product-${index + 1}.png`, alt: `${name} ${index + 1}` } }));
  const secondaryOptions = Array.from({ length: secondaryCount }, (_, index) => ({ id: `secondary-${index}`, code: `S${index + 1}`, name: `Tier ${index + 1}`, role: `Role ${index + 1}`, price: 100 + index, landedCost: 40, score: 70, values: { performance: `${index + 1}` } }));
  const skus = primaryOptions.flatMap(primary => secondaryOptions.map(secondary => ({ id: `${primary.id}-${secondary.id}`, label: { id: `${primary.id}-${secondary.id}-label`, badge: "Product", title: "Label", identification: [], sections: [], ingredientsTitle: "Ingredients", ingredients: [{ id: "ingredient", name: "Ingredient", amount: "", cost: 40 }], costsTitle: "Costs", consumerPrice: secondary.price, costColumns: ["Item", "Detail", "Gauge", "Price", "Ratio"], costGroups: [{ id: "ingredient", label: "Ingredient" }, { id: "profit", label: "Profit" }], costs: [{ id: "remainder", label: "Remainder", group: "profit", amount: secondary.price - 40 }], notices: [] } })));
  return {
    regions: ["header", "hero", "catalog", "footer"], meta: { title: name, description: `${name} description` }, system: { locale: "en-US", language: "en", favicon: "/favicon.svg", topId: "top", catalogId: "catalog", traceId: "trace", principlesId: "principles" },
    brand: { name, tagline: `${name} standard`, location: "GLOBAL" }, navigation: [{ label: "Catalog", target: "catalog" }],
    labels: { primaryNavigation: "Navigation", bag: "Bag", currency: "USD", currencyMark: "$", percent: "%", dot: " / ", down: "↓", primaryChoice: "Model", secondaryChoice: "Tier", economics: "ECONOMICS", supplyRoute: "ROUTE", routeNode: "NODE", score: "INDEX", scoreSuffix: "/ 100", scoreNote: "Index note", routeAria: "Supply route", routeHint: "DRAG", distance: "Distance", economicsNote: "Economic note", vat: "Tax", platform: "Platform", landed: "Landed", contribution: "Contribution", contributionSuffix: "Before variable cost" },
    hero: { label: `${name} SYSTEM`, title: "Measured.", emphasis: "Open", tail: " standard.", copy: `${name} facts`, action: "Compare", index: "OPTIONS", range: "RANGE", left: "FORM", right: "SYSTEM" },
    catalogSection: { label: "01 / CATALOG", title: ["CONFIGURATIONS"], copy: ["Select a configuration."] }, principlesSection: { label: "02 / PRINCIPLES", title: ["PRINCIPLES"], copy: ["Facts first."] }, principles: [],
    catalog: { primaryOptions, secondaryOptions, combinations: primaryOptions.flatMap(primary => secondaryOptions.map(secondary => ({ id: `${primary.id}-${secondary.id}`, primaryId: primary.id, secondaryId: secondary.id, routeId: "route", skuId: `${primary.id}-${secondary.id}` }))), skus, routes: [{ id: "route", city: "City", country: "Country", role: "Factory", location: [0, 0] }], arcs: [], metrics: [{ key: "performance", label: "Performance" }], economics: { vatRate: 1.1, percentageScale: 100, platformRate: 0.05 }, detailPanels: [] },
  };
}

for (const [name, primaryCount, secondaryCount] of [["Computer", 2, 2], ["Supplement", 1, 3]]) {
  const root = await fixture(`portable-${name.toLowerCase()}`);
  const definition = alternateProduct(name, primaryCount, secondaryCount);
  await writeFile(path.join(root, "app/product-definition.ts"), `import type { ProductPageDefinition } from "./design-system/entry";\nexport const PRODUCT_PAGE = ${JSON.stringify(definition)} as ProductPageDefinition;\n`);
  const result = execute(root);
  if (result.status !== 0) throw new Error(`${name}: cross-category product definition must pass\n${result.stdout}\n${result.stderr}`);
}

const tokenCustomization = await fixture("central-token-customization");
await replace(tokenCustomization, "app/design-system/system.css", "--ds-line-width:.75px", "--ds-line-width:1px");
await replace(tokenCustomization, "app/design-system/system.css", "--ds-r-md:14px", "--ds-r-md:18px");
const tokenCustomizationResult = execute(tokenCustomization);
if (tokenCustomizationResult.status !== 0) throw new Error(`Central token customization must propagate without local overrides\n${tokenCustomizationResult.stdout}\n${tokenCustomizationResult.stderr}`);

const cases = [
  ["intrinsic-dom", "intrinsic DOM", async (root) => append(root, "app/design-system/Storefront.tsx", "export const ProofDom = <div/>;")],
  ["hardcoded-class", "hardcoded className", async (root) => append(root, "app/design-system/index.tsx", "export const ProofClass = () => <div className='proof'/>;")],
  ["hardcoded-ui-string", "hardcoded visible UI string", async (root) => append(root, "app/design-system/Storefront.tsx", "export const ProofText = () => <Atom>{'proof'}</Atom>;")],
  ["container-bypass", "semantic layout elements must use Container", async (root) => append(root, "app/design-system/Storefront.tsx", "export const ProofSection = () => <Atom as={ELEMENT.section} />;")],
  ["layout-class-bypass", "regulated layout classes", async (root) => append(root, "app/design-system/Storefront.tsx", "export const ProofLayout = () => <Atom className={CLASS.section} />;")],
  ["container-contract", "Container authority must apply", async (root) => replace(root, "app/design-system/index.tsx", "joinClasses(CLASS.container, className)", "className")],
  ["grid-bypass", "regulated grid classes", async (root) => append(root, "app/design-system/Storefront.tsx", "export const ProofGrid = () => <Atom className={CLASS.costItems} />;")],
  ["grid-cell-bypass", "regulated grid-cell classes", async (root) => append(root, "app/design-system/Storefront.tsx", "export const ProofGridCell = () => <Atom className={CLASS.costItem} />;")],
  ["grid-contract", "SurfaceGrid authority must apply", async (root) => replace(root, "app/design-system/index.tsx", "joinClasses(CLASS.surface, CLASS.grid, className)", "className")],
  ["panel-bypass", "regulated panel classes", async (root) => append(root, "app/design-system/Storefront.tsx", "export const ProofPanel = () => <Surface className={CLASS.costBreakdown} />;")],
  ["panel-header-bypass", "regulated panel-header classes", async (root) => append(root, "app/design-system/Storefront.tsx", "export const ProofPanelHeader = () => <Atom className={CLASS.costTitle} />;")],
  ["panel-footer-bypass", "regulated panel-footer classes", async (root) => append(root, "app/design-system/Storefront.tsx", "export const ProofPanelFooter = () => <Copy className={CLASS.costFooter} />;")],
  ["panel-contract", "Panel authority must apply", async (root) => replace(root, "app/design-system/index.tsx", "joinClasses(CLASS.surface, CLASS.panel, className)", "className")],
  ["panel-body-contract", "PanelBody authority must apply", async (root) => replace(root, "app/design-system/index.tsx", "joinClasses(CLASS.panelBody, className)", "className")],
  ["panel-structure", "Panel children must be exactly", async (root) => append(root, "app/design-system/Storefront.tsx", "export const ProofPanelStructure = () => <Panel className={CLASS.globeCard}><PanelBody /></Panel>;")],
  ["panel-layout-leak", "panel variants cannot redefine", async (root) => append(root, "app/design-system/styles.css", ".globe-card{display:flex}")],
  ["globe-interaction-bypass", "Globe drag events must be owned", async (root) => replace(root, "app/design-system/SupplyGlobe.tsx", "interaction.addEventListener(\"pointerdown\"", "canvas.addEventListener(\"pointerdown\"")],
  ["choice-bypass", "regulated choice classes", async (root) => append(root, "app/design-system/Storefront.tsx", "export const ProofChoice = () => <Atom className={CLASS.qualityPrice} />;")],
  ["choice-contract", "LabeledChoice authority must apply", async (root) => replace(root, "app/design-system/index.tsx", "joinClasses(CLASS.choice,className)", "className")],
  ["choice-slot-contract", "LabeledChoice authority must render every centralized choice slot", async (root) => replace(root, "app/design-system/index.tsx", "CLASS.choiceCode", "CLASS.label")],
  ["choice-surface-leak", "choice variants cannot redefine", async (root) => append(root, "app/design-system/styles.css", ".quality-price{border-radius:var(--ds-r-sm)}")],
  ["choice-layout-leak", "choice variants cannot redefine", async (root) => append(root, "app/design-system/styles.css", ".quality-price{display:flex}")],
  ["combination-cardinality", "map every option combination", async (root) => replace(root, "app/product-definition.ts", "combinations:primaryOptions.flatMap", "combinations:[].flatMap")],
  ["product-style-injection", "cannot override design-system geometry", async (root) => replace(root, "app/product-definition.ts", "regions:[", 'padding:"1px",regions:[')],
  ["unused-css", "has no CLASS-backed JSX consumer", async (root) => append(root, "app/design-system/styles.css", ".proof-unused-style{display:block}")],
  ["orphan-source", "not declared", async (root) => { await writeFile(path.join(root, "app/orphan.ts"), "export const orphan = true;\n"); }],
  ["archived-import", "forbidden archived import", async (root) => append(root, "app/design-system/Storefront.tsx", "import '../../delete/proof';")],
  ["unused-export", "has no semantic consumer", async (root) => append(root, "app/design-system/tokens.ts", "export const PROOF_UNUSED_EXPORT = 1;")],
  ["raw-color", "raw colors are restricted", async (root) => append(root, "app/design-system/tokens.ts", "export const PROOF_RAW_COLOR = '#abc';")],
  ["load-gate", "predev must block", async (root) => { const file = path.join(root, "package.json"); const json = JSON.parse(await readFile(file, "utf8")); json.scripts.predev = "true"; await writeFile(file, JSON.stringify(json)); }],
  ["product-content-leak", "must not contain product-specific content", async (root) => append(root, "app/design-system/Storefront.tsx", "const PROOF_PRODUCT_COPY = 'WHITE T-SHIRT';")],
  ["template-registry", "complete reusable region registry", async (root) => replace(root, "app/design-system/template-map.mjs", 'region: "hero"', 'region: "changed"')],
  ["definition-region", "unknown or duplicate template region", async (root) => replace(root, "app/product-definition.ts", 'regions:["header"', 'regions:["unknown"')],
  ["composition-binding", "bind the injected region composition", async (root) => replace(root, "app/design-system/Storefront.tsx", "data-design-order={definition.regions.join(\",\")}", "")],
  ["composition-hardcode", "composition must be driven by the injected region array", async (root) => replace(root, "app/design-system/Storefront.tsx", "definition.regions.map(region =>", '["header"].map(region =>')],
  ["consumer-bypass", "Framework adapters must consume only", async (root) => replace(root, "app/page.tsx", '"./design-system/entry"', '"./design-system/Storefront"')],
  ["external-ui-source", "must live inside app/design-system/", async (root) => { await writeFile(path.join(root, "app/external-ui.tsx"), "export const ExternalUi = () => <div/>;\n"); }],
  ["designer-contract-missing", "portable design-system contract is missing", async (root) => rm(path.join(root, "app/design-system/DESIGN_ORDER.md"))],
  ["module-gate", "Portable design-system package must expose", async (root) => { const file = path.join(root, "app/design-system/package.json"); const json = JSON.parse(await readFile(file, "utf8")); json.scripts.validate = "true"; await writeFile(file, JSON.stringify(json)); }],
  ["visual-threshold", "at least 99% content-independent fidelity", async (root) => replace(root, "app/design-system/visual-contract.mjs", "fidelityThreshold: 0.99", "fidelityThreshold: 0.5")],
  ["visual-token", "required visual token is missing", async (root) => replace(root, "app/design-system/system.css", "--ds-line:", "--ds-line-proof:")],
  ["outline-propagation", "must propagate to every service outline state", async (root) => replace(root, "app/design-system/styles.css", "var(--ds-selection-line-width)", "1.25px")],
];

try {
  for (const [name, expected, mutate] of cases) {
    const root = await fixture(name);
    await mutate(root);
    const result = execute(root);
    const output = `${result.stdout}\n${result.stderr}`;
    if (result.status === 0 || !output.includes(expected)) throw new Error(`${name}: expected rejection containing "${expected}"`);
  }
  console.log(`Architecture proof self-test passed: baseline + 2 cross-category fixtures + central token customization + ${cases.length} mutation cases.`);
} finally {
  await rm(testRoot, { recursive: true, force: true });
}
