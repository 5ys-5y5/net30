import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { ARCHITECTURE } from "./architecture-manifest.mjs";
import { REQUIRED_CONSUMER_IMPORTS, TEMPLATE_REGISTRY } from "../template-map.mjs";
import { VISUAL_CONTRACT } from "../visual-contract.mjs";

const rootPath = fileURLToPath(new URL("../../../", import.meta.url));
const normalize = (value) => value.split(path.sep).join("/");
const absolute = (file) => path.join(rootPath, file);
const source = (file) => readFile(absolute(file), "utf8");
const codeExtensions = /\.(?:[cm]?[jt]sx?)$/;

async function repositoryFiles() {
  const ignored = /^(?:\.git|\.next|\.vinext|\.wrangler|delete|dist|node_modules)(?:\/|$)/;
  return (await readdir(rootPath, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => normalize(path.relative(rootPath, path.join(entry.parentPath, entry.name))))
    .filter((file) => !ignored.test(file));
}

function parse(file, text) {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : file.endsWith(".mjs") ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
}

function importsOf(ast) {
  const imports = [];
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) imports.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return imports;
}

function resolveLocal(from, specifier, declaredFiles) {
  if (!specifier.startsWith(".")) return undefined;
  const base = normalize(path.normalize(path.join(path.dirname(from), specifier)));
  const candidates = [base, ...[".ts", ".tsx", ".mjs", ".css", ".json"].map((extension) => `${base}${extension}`), ...[".ts", ".tsx", ".mjs"].map((extension) => `${base}/index${extension}`)];
  return candidates.find((candidate) => declaredFiles.has(candidate));
}

export async function validateDesignSystem() {
  const failures = [];
  if (process.env.DESIGN_VALIDATION_TEST_FAIL === "1") failures.push("Injected validation failure");

  const files = await repositoryFiles();
  for (const required of ["app/design-system/AGENTS.md", "app/design-system/DESIGN_ORDER.md", "app/design-system/README.md", "app/design-system/package.json"]) if (!files.includes(required)) failures.push(`${required}: portable design-system contract is missing`);
  const declared = new Set([...ARCHITECTURE.codeFiles, ...ARCHITECTURE.styleFiles, ...ARCHITECTURE.generatedFiles]);
  const actualSourceFiles = files.filter((file) => codeExtensions.test(file) || file.endsWith(".css"));
  for (const file of actualSourceFiles) if (!declared.has(file)) failures.push(`${file}: active source is not declared in architecture-manifest.mjs`);
  for (const file of declared) if (!files.includes(file)) failures.push(`${file}: declared architecture file is missing`);
  for (const file of actualSourceFiles.filter((file) => file.startsWith("app/"))) if (!file.startsWith(ARCHITECTURE.moduleRoot) && !ARCHITECTURE.consumerEntrypoints.includes(file)) failures.push(`${file}: UI, SKU, content, and styles must live inside ${ARCHITECTURE.moduleRoot}`);

  const texts = new Map(await Promise.all([...ARCHITECTURE.codeFiles, ...ARCHITECTURE.styleFiles].map(async (file) => [file, await source(file)])));
  const asts = new Map(ARCHITECTURE.codeFiles.map((file) => [file, parse(file, texts.get(file))]));

  const registeredRegions = TEMPLATE_REGISTRY.map(({ region }) => region);
  if (new Set(registeredRegions).size !== registeredRegions.length || registeredRegions.join(",") !== "header,hero,catalog,principles,footer") failures.push("template-map.mjs must define the complete reusable region registry");
  if (!/data-design-order=\{definition\.regions\.join\("[,]"\)\}/.test(texts.get("app/design-system/Storefront.tsx") ?? "")) failures.push("Storefront must bind the injected region composition to the rendered page");
  const atomAuthority = texts.get("app/design-system/index.tsx") ?? "";
  const compositionAuthorities = ["app/design-system/Storefront.tsx", "app/design-system/SupplyGlobe.tsx", "app/design-system/index.tsx"].map((file) => texts.get(file) ?? "").join("\n");
  for (const item of TEMPLATE_REGISTRY) {
    if (!new RegExp(`(?:export\\s+)?(?:function|const)\\s+${item.composition}\\b`).test(compositionAuthorities)) failures.push(`template-map.mjs: composition ${item.composition} has no centralized implementation`);
    for (const atom of item.atoms) if (!new RegExp(`(?:export\\s+function|export\\s+const)\\s+${atom}\\b`).test(atomAuthority)) failures.push(`template-map.mjs: atom ${atom} has no centralized implementation`);
  }
  const pageImports = importsOf(asts.get("app/page.tsx")).filter((specifier) => specifier.startsWith("."));
  const layoutImports = importsOf(asts.get("app/layout.tsx")).filter((specifier) => specifier.startsWith("."));
  if (pageImports.sort().join(",") !== [...REQUIRED_CONSUMER_IMPORTS.page].sort().join(",") || layoutImports.sort().join(",") !== [...REQUIRED_CONSUMER_IMPORTS.layout].sort().join(",")) failures.push("Framework adapters must consume only the template entry, stylesheet, and injected product definition");
  const entrySource = texts.get("app/design-system/entry.ts") ?? "";
  if (!/export\s+\{[^}]*\bStorefront\b/.test(entrySource) || !/export\s+type\s+\{[^}]*\bProductPageDefinition\b/.test(entrySource)) failures.push("entry.ts must expose the renderer and injected product-definition contract");

  const storefrontSource = texts.get("app/design-system/Storefront.tsx") ?? "";
  if (!/definition\.regions\.map\(region\s*=>/.test(storefrontSource) || !/registry\[region\]/.test(storefrontSource)) failures.push("Storefront composition must be driven by the injected region array and centralized registry");
  const productSource = texts.get(ARCHITECTURE.productAuthority) ?? "";
  const compiledProduct = ts.transpileModule(productSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const { PRODUCT_PAGE: productPage } = await import(`data:text/javascript;base64,${Buffer.from(compiledProduct).toString("base64")}`);
  const catalog = productPage?.catalog;
  if (!productPage || !catalog || !catalog.primaryOptions?.length || !catalog.secondaryOptions?.length) failures.push("Injected product definition must provide non-empty option dimensions");
  if (productPage) {
    if (!productPage.regions?.length || new Set(productPage.regions).size !== productPage.regions.length || productPage.regions.some((region) => !registeredRegions.includes(region))) failures.push("Injected product definition contains an unknown or duplicate template region");
    const combinationIds = new Set(catalog.combinations.map((item) => item.id));
    if (combinationIds.size !== catalog.combinations.length) failures.push("Injected product combination IDs must be unique");
    if (catalog.combinations.length !== catalog.primaryOptions.length * catalog.secondaryOptions.length) failures.push("Injected product definition must map every option combination exactly once");
    for (const primary of catalog.primaryOptions) for (const secondary of catalog.secondaryOptions) {
      const matches = catalog.combinations.filter((item) => item.primaryId === primary.id && item.secondaryId === secondary.id);
      if (matches.length !== 1) failures.push(`Injected product definition must map ${primary.id} × ${secondary.id} exactly once`);
    }
    for (const item of catalog.combinations) if (!catalog.routes.some((route) => route.id === item.routeId)) failures.push(`Product combination ${item.id} references a missing route`);
    for (const item of catalog.combinations) if (!catalog.skus?.some((sku) => sku.id === item.skuId)) failures.push(`Product combination ${item.id} references a missing SKU`);
    for (const sku of catalog.skus ?? []) {
      const label = sku.label;
      const displayed = [...(label?.ingredients ?? []).map((item) => item.cost), ...(label?.costs ?? []).map((item) => item.amount)].reduce((sum, value) => sum + value, 0);
      if (!label || displayed !== label.consumerPrice) failures.push(`SKU ${sku.id} price receipt must reconcile exactly to its consumer price`);
    }
    for (const secondary of catalog.secondaryOptions) for (const metric of catalog.metrics) if (!(metric.key in secondary.values)) failures.push(`Secondary option ${secondary.id} is missing metric ${metric.key}`);
    const forbiddenDesignKeys = new Set(["className", "style", "styles", "color", "background", "border", "borderRadius", "padding", "margin", "gap", "font", "fontSize", "lineHeight", "letterSpacing", "width", "height", "display", "grid", "radius", "strokeWidth"]);
    const inspectProductData = (value, trail = "PRODUCT_PAGE") => {
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        if (forbiddenDesignKeys.has(key)) failures.push(`${trail}.${key}: injected product data cannot override design-system geometry or styling`);
        inspectProductData(child, `${trail}.${key}`);
      }
    };
    inspectProductData(productPage);
  }
  if (/\b(?:ALL-O-WHITE|WHITE T-SHIRT|클래식 크루|데일리|에센셜|시그니처)\b/.test([...texts].filter(([file]) => file.startsWith(ARCHITECTURE.moduleRoot) && !file.startsWith(`${ARCHITECTURE.moduleRoot}validation/`)).map(([, text]) => text).join("\n"))) failures.push("Portable design-system runtime must not contain product-specific content");
  if (!/selectCombination\(catalog,\s*primaryIndex,\s*secondaryIndex\)/.test(storefrontSource)) failures.push("Storefront must resolve injected product combinations through the centralized selector");

  const edges = new Map(ARCHITECTURE.codeFiles.map((file) => [file, []]));
  const graphFiles = new Set([...ARCHITECTURE.codeFiles, ...ARCHITECTURE.styleFiles]);
  for (const [file, ast] of asts) {
    for (const specifier of importsOf(ast)) {
      if (ARCHITECTURE.forbiddenImportSegments.some((segment) => specifier.split("/").includes(segment))) failures.push(`${file}: forbidden archived import ${specifier}`);
      const resolved = resolveLocal(file, specifier, graphFiles);
      if (resolved) edges.get(file).push(resolved);
    }
  }
  for (const file of ARCHITECTURE.styleFiles) {
    for (const match of texts.get(file).matchAll(/@import\s+["']([^"']+)["']/g)) {
      const resolved = resolveLocal(file, match[1], graphFiles);
      if (resolved) edges.set(file, [...(edges.get(file) ?? []), resolved]);
    }
  }
  const reached = new Set();
  const visitGraph = (file) => { if (reached.has(file)) return; reached.add(file); for (const dependency of edges.get(file) ?? []) visitGraph(dependency); };
  ARCHITECTURE.graphRoots.forEach(visitGraph);
  for (const file of graphFiles) if (!reached.has(file)) failures.push(`${file}: active source is unreachable from every runtime/tooling entry point`);

  const domAuthorities = new Set(ARCHITECTURE.domAuthorities);
  const compositionFiles = new Set(ARCHITECTURE.compositionFiles);
  const containerLayoutClasses = new Set(ARCHITECTURE.containerLayoutClasses);
  const gridLayoutClasses = new Set(ARCHITECTURE.gridLayoutClasses);
  const gridCellClasses = new Set(ARCHITECTURE.gridCellClasses);
  const panelClasses = new Set(ARCHITECTURE.panelClasses);
  const panelHeaderClasses = new Set(ARCHITECTURE.panelHeaderClasses);
  const panelFooterClasses = new Set(ARCHITECTURE.panelFooterClasses);
  const choiceClasses = new Set(ARCHITECTURE.choiceClasses);
  const tokenAst = asts.get("app/design-system/tokens.ts");
  const classRegistry = new Map();
  tokenAst?.statements.forEach((statement) => {
    if (!ts.isVariableStatement(statement)) return;
    const declaration = statement.declarationList.declarations[0];
    if (!declaration || !ts.isIdentifier(declaration.name) || declaration.name.text !== "CLASS" || !declaration.initializer) return;
    const initializer = ts.isAsExpression(declaration.initializer) ? declaration.initializer.expression : declaration.initializer;
    if (!ts.isObjectLiteralExpression(initializer)) return;
    initializer.properties.forEach((property) => {
      if (ts.isPropertyAssignment(property) && property.name && ts.isStringLiteral(property.initializer)) classRegistry.set(property.name.getText(tokenAst), property.initializer.text);
    });
  });
  if (classRegistry.size === 0) failures.push("tokens.ts must define the centralized CLASS registry");
  const containerSource = texts.get(ARCHITECTURE.containerAuthority) ?? "";
  if (!/export\s+function\s+Container\b/.test(containerSource) || !/joinClasses\(CLASS\.container,\s*className\)/.test(containerSource)) failures.push("Container authority must apply the centralized CLASS.container contract");
  const systemCss = texts.get(ARCHITECTURE.colorAuthority) ?? "";
  if (VISUAL_CONTRACT.fidelityThreshold < 0.99 || !VISUAL_CONTRACT.contentExcludedFromScore || VISUAL_CONTRACT.tokenAuthority !== ARCHITECTURE.colorAuthority || VISUAL_CONTRACT.compositionAuthority !== "app/design-system/styles.css") failures.push("Visual contract must guarantee at least 99% content-independent fidelity from centralized authorities");
  const compositionCssAuthority = texts.get("app/design-system/styles.css") ?? "";
  for (const token of VISUAL_CONTRACT.requiredTokens) {
    if (!systemCss.includes(`${token}:`)) failures.push(`${token}: required visual token is missing from the centralized authority`);
    if (new RegExp(`${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`).test(compositionCssAuthority)) failures.push(`${token}: visual token declarations must remain inside the centralized token authority`);
  }
  if (!/--ds-line\s*:\s*var\(--ds-line-width\)\s+solid/.test(systemCss) || !/--ds-selection-line-width\s*:\s*calc\(var\(--ds-line-width\)/.test(systemCss) || !/box-shadow\s*:\s*inset 0 0 0 var\(--ds-selection-line-width\)/.test(texts.get("app/design-system/styles.css") ?? "")) failures.push("Changing the centralized line-width token must propagate to every service outline state");
  if (!(texts.get("app/design-system/styles.css") ?? "").startsWith('@import "./system.css";')) failures.push("Composition styles must import the visual token authority directly");
  if (!/--ds-page-gutter\s*:/.test(systemCss) || !/\.ds-container\s*\{[^}]*margin-inline\s*:\s*var\(--ds-page-gutter\)/.test(systemCss)) failures.push("Container gutter must be centralized in the design-system authority");
  const gridSource = texts.get(ARCHITECTURE.gridAuthority) ?? "";
  if (!/export\s+function\s+SurfaceGrid\b/.test(gridSource) || !/joinClasses\(CLASS\.surface,\s*CLASS\.grid,\s*className\)/.test(gridSource)) failures.push("SurfaceGrid authority must apply the centralized surface and grid contracts");
  if (!/export\s+function\s+GridCell\b/.test(gridSource) || !/joinClasses\(CLASS\.gridCell,\s*className\)/.test(gridSource)) failures.push("GridCell authority must apply the centralized grid-cell contract");
  const componentCss = texts.get("app/design-system/styles.css") ?? "";
  const panelSource = texts.get(ARCHITECTURE.panelAuthority) ?? "";
  if (!/export\s+function\s+Panel\b/.test(panelSource) || !/joinClasses\(CLASS\.surface,\s*CLASS\.panel,\s*className\)/.test(panelSource)) failures.push("Panel authority must apply the centralized surface and panel contracts");
  if (!/export\s+function\s+PanelHeader\b/.test(panelSource) || !/joinClasses\(CLASS\.panelHeader,\s*className\)/.test(panelSource)) failures.push("PanelHeader authority must apply the centralized panel-header contract");
  if (!/export\s+function\s+PanelBody\b/.test(panelSource) || !/joinClasses\(CLASS\.panelBody,\s*className\)/.test(panelSource)) failures.push("PanelBody authority must apply the centralized panel-body contract");
  if (!/export\s+function\s+PanelFooter\b/.test(panelSource) || !/joinClasses\(CLASS\.panelFooter,\s*className\)/.test(panelSource)) failures.push("PanelFooter authority must apply the centralized panel-footer contract");
  if (!/\.ds-panel\s*\{[^}]*(?:display\s*:\s*grid)[^}]*(?:grid-template-rows\s*:)[^}]*(?:overflow\s*:)/.test(systemCss)) failures.push("Panel must centrally own its three-row layout and overflow contract");
  if (!/\.ds-panel-body\s*\{[^}]*(?:display\s*:)[^}]*(?:align-items\s*:)/.test(systemCss)) failures.push("PanelBody must centrally own inner alignment");
  const globeSource = texts.get("app/design-system/SupplyGlobe.tsx") ?? "";
  if (!/GlobeInteraction\s+ref=\{interactionRef\}/.test(globeSource) || /canvas\.addEventListener\("pointer/.test(globeSource) || !/interaction\.addEventListener\("pointerdown"/.test(globeSource)) failures.push("Globe drag events must be owned by the centralized interaction surface");
  if (!/\.ds-globe-interaction\s*\{[^}]*(?:width\s*:\s*100%)[^}]*(?:height\s*:\s*100%)[^}]*(?:touch-action\s*:\s*none)/.test(systemCss)) failures.push("Globe interaction surface must centrally fill PanelBody");
  for (const key of panelClasses) {
    const className = classRegistry.get(key);
    if (!className) continue;
    const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const match of componentCss.matchAll(new RegExp(`\\.${escaped}\\s*\\{([^}]*)\\}`, "g"))) {
      if (/(?:^|;)\s*(?:display|grid-template(?:-rows|-columns)?|place-items|align-items|align-content|justify-items|justify-content|overflow|padding)\s*:/.test(match[1])) failures.push(`${className}: panel variants cannot redefine centralized panel layout properties`);
    }
  }
  const choiceSource = texts.get(ARCHITECTURE.choiceAuthority) ?? "";
  if (!/export\s+function\s+LabeledChoice\b/.test(choiceSource) || !/joinClasses\(CLASS\.choice,\s*className\)/.test(choiceSource)) failures.push("LabeledChoice authority must apply the centralized choice-surface contract");
  if (!["choiceCode", "choiceVisual", "choiceContent"].every((slot) => new RegExp(`CLASS\\.${slot}`).test(choiceSource))) failures.push("LabeledChoice authority must render every centralized choice slot");
  if (!/\.ds-choice\s*\{[^}]*(?:border\s*:)[^}]*(?:border-radius\s*:\s*var\(--ds-r-md\))[^}]*(?:background\s*:)/.test(systemCss)) failures.push("Choice surface must centrally own border, medium radius, and background");
  if (!/\.ds-choice\s*\{[^}]*(?:padding\s*:)[^}]*(?:display\s*:\s*grid)[^}]*(?:grid-template-columns\s*:)[^}]*(?:align-items\s*:)/.test(systemCss) || !/\.ds-choice-content\s*\{[^}]*(?:display\s*:\s*flex)[^}]*(?:justify-content\s*:)[^}]*(?:align-items\s*:)/.test(systemCss) || !/\.ds-choice-visual\s*\{[^}]*(?:display\s*:\s*grid)[^}]*(?:place-items\s*:\s*center)/.test(systemCss)) failures.push("Choice layout and alignment must be owned by centralized choice slots");
  for (const key of choiceClasses) {
    const className = classRegistry.get(key);
    if (!className) continue;
    const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const match of componentCss.matchAll(new RegExp(`\\.${escaped}\\s*\\{([^}]*)\\}`, "g"))) {
      if (/(?:^|;)\s*(?:border(?:-radius)?|background|cursor|text-align|display|grid-template(?:-rows|-columns)?|grid-column|grid-row|align-items|align-self|justify-content|justify-self|place-items|padding|gap|min-height)\s*:/.test(match[1])) failures.push(`${className}: choice variants cannot redefine centralized choice surface or layout properties`);
    }
  }
  const usedClasses = new Set();
  const usedClassKeys = new Set();
  for (const [file, ast] of asts) {
    const visit = (node) => {
      if (ts.isJsxAttribute(node) && node.name.text === "className" && node.initializer && (ts.isStringLiteral(node.initializer) || (ts.isJsxExpression(node.initializer) && node.initializer.expression && (ts.isStringLiteralLike(node.initializer.expression) || ts.isTemplateExpression(node.initializer.expression))))) failures.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}: hardcoded className is forbidden; use CLASS tokens`);
      if (compositionFiles.has(file) && ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) failures.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}: hardcoded JSX attribute is forbidden in composition; use a centralized token`);
      if (compositionFiles.has(file) && ts.isJsxExpression(node) && node.expression && ts.isStringLiteralLike(node.expression)) failures.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}: hardcoded visible UI string is forbidden in composition; inject product-definition data`);
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "CLASS") {
        const key = node.name.text;
        usedClassKeys.add(key);
        if (classRegistry.has(key)) usedClasses.add(classRegistry.get(key));
        else failures.push(`${file}: CLASS.${key} is not registered in tokens.ts`);
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tagName = ts.isIdentifier(node.tagName) ? node.tagName.text : node.tagName.getText(ast);
        const classAttribute = node.attributes.properties.find((property) => ts.isJsxAttribute(property) && property.name.text === "className");
        const layoutKeys = [];
        const gridKeys = [];
        const gridCellKeys = [];
        const panelKeys = [];
        const panelHeaderKeys = [];
        const panelFooterKeys = [];
        const choiceKeys = [];
        if (classAttribute?.initializer) {
          const collectLayoutKeys = (child) => {
            if (ts.isPropertyAccessExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === "CLASS" && containerLayoutClasses.has(child.name.text)) layoutKeys.push(child.name.text);
            if (ts.isPropertyAccessExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === "CLASS" && gridLayoutClasses.has(child.name.text)) gridKeys.push(child.name.text);
            if (ts.isPropertyAccessExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === "CLASS" && gridCellClasses.has(child.name.text)) gridCellKeys.push(child.name.text);
            if (ts.isPropertyAccessExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === "CLASS" && panelClasses.has(child.name.text)) panelKeys.push(child.name.text);
            if (ts.isPropertyAccessExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === "CLASS" && panelHeaderClasses.has(child.name.text)) panelHeaderKeys.push(child.name.text);
            if (ts.isPropertyAccessExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === "CLASS" && panelFooterClasses.has(child.name.text)) panelFooterKeys.push(child.name.text);
            if (ts.isPropertyAccessExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === "CLASS" && choiceClasses.has(child.name.text)) choiceKeys.push(child.name.text);
            ts.forEachChild(child, collectLayoutKeys);
          };
          collectLayoutKeys(classAttribute.initializer);
        }
        if (layoutKeys.length && tagName !== "Container") failures.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}: regulated layout classes ${layoutKeys.join(", ")} must use Container`);
        if (tagName === "Container" && layoutKeys.length === 0) failures.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}: Container must declare a regulated layout class`);
        if (gridKeys.length && tagName !== "SurfaceGrid") failures.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}: regulated grid classes ${gridKeys.join(", ")} must use SurfaceGrid`);
        if (tagName === "SurfaceGrid" && gridKeys.length === 0) failures.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}: SurfaceGrid must declare a regulated grid class`);
        if (gridCellKeys.length && tagName !== "GridCell") failures.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}: regulated grid-cell classes ${gridCellKeys.join(", ")} must use GridCell`);
        if (tagName === "GridCell" && gridCellKeys.length === 0) failures.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}: GridCell must declare a regulated grid-cell class`);
        if (panelKeys.length && tagName !== "Panel") failures.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}: regulated panel classes ${panelKeys.join(", ")} must use Panel`);
        if (tagName === "Panel" && panelKeys.length === 0) failures.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}: Panel must declare a regulated panel class`);
        if (tagName === "Panel" && ts.isJsxElement(node.parent) && node.parent.openingElement === node) {
          const structure = node.parent.children.filter((child) => ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)).map((child) => ts.isJsxElement(child) ? child.openingElement.tagName.getText(ast) : child.tagName.getText(ast));
          if (structure.join(",") !== "PanelHeader,PanelBody,PanelFooter") failures.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}: Panel children must be exactly PanelHeader, PanelBody, PanelFooter`);
        }
        if (panelHeaderKeys.length && tagName !== "PanelHeader") failures.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}: regulated panel-header classes ${panelHeaderKeys.join(", ")} must use PanelHeader`);
        if (panelFooterKeys.length && tagName !== "PanelFooter") failures.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}: regulated panel-footer classes ${panelFooterKeys.join(", ")} must use PanelFooter`);
        if (choiceKeys.length && tagName !== "LabeledChoice") failures.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}: regulated choice classes ${choiceKeys.join(", ")} must use LabeledChoice`);
        if (tagName === "LabeledChoice" && choiceKeys.length === 0) failures.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}: LabeledChoice must declare a regulated choice class`);
        if (compositionFiles.has(file) && tagName === "Atom") {
          const asAttribute = node.attributes.properties.find((property) => ts.isJsxAttribute(property) && property.name.text === "as");
          const asText = asAttribute?.initializer?.getText(ast) ?? "";
          if (/ELEMENT\.(?:nav|section|footer)\b/.test(asText)) failures.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}: semantic layout elements must use Container`);
        }
      }
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName) && /^[a-z]/.test(node.tagName.text) && !domAuthorities.has(file)) failures.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}: intrinsic DOM is restricted to ${ARCHITECTURE.domAuthorities.join(", ")}`);
      if (ts.isJsxText(node) && node.text.trim()) failures.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}: visible JSX text must come from injected product-definition data`);
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }

  const colorPattern = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i;
  for (const [file, text] of texts) if (file.startsWith(ARCHITECTURE.moduleRoot) && !file.startsWith(`${ARCHITECTURE.moduleRoot}validation/`) && file !== ARCHITECTURE.colorAuthority && colorPattern.test(text)) failures.push(`${file}: raw colors are restricted to ${ARCHITECTURE.colorAuthority}`);
  for (const [file, text] of texts) if (file.startsWith(ARCHITECTURE.moduleRoot) && !file.startsWith(`${ARCHITECTURE.moduleRoot}validation/`) && /ALLOWHITE/.test(text)) failures.push(`${file}: legacy brand spelling is forbidden`);

  const cssText = ARCHITECTURE.styleFiles.map((file) => texts.get(file)).join("\n").replace(/\/\*[\s\S]*?\*\//g, "").replace(/@import[^;]+;/g, "");
  const declaredClasses = new Set([...cssText.matchAll(/\.([a-z][\w-]*)/g)].map((match) => match[1]));
  for (const key of classRegistry.keys()) if (!usedClassKeys.has(key)) failures.push(`CLASS.${key} is registered but has no component consumer`);
  for (const className of declaredClasses) if (!usedClasses.has(className)) failures.push(`CSS class .${className} has no CLASS-backed JSX consumer`);
  for (const className of usedClasses) if (!declaredClasses.has(className)) failures.push(`CLASS-backed JSX class ${className} has no CSS definition`);

  const typedFiles = ARCHITECTURE.codeFiles.filter((file) => /\.tsx?$/.test(file)).map(absolute);
  const program = ts.createProgram(typedFiles, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX, strict: true, skipLibCheck: true });
  const checker = program.getTypeChecker();
  const programSources = program.getSourceFiles().filter((file) => file.fileName.startsWith(rootPath));
  const canonical = (symbol) => symbol && (symbol.flags & ts.SymbolFlags.Alias) ? checker.getAliasedSymbol(symbol) : symbol;
  for (const file of ARCHITECTURE.codeFiles.filter((name) => name.startsWith("app/design-system/") && /\.tsx?$/.test(name))) {
    const sourceFile = program.getSourceFile(absolute(file));
    if (!sourceFile) continue;
    for (const statement of sourceFile.statements) {
      const exported = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
      const name = (ts.isFunctionDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) ? statement.name : ts.isVariableStatement(statement) ? statement.declarationList.declarations[0]?.name : undefined;
      if (!exported || !name || !ts.isIdentifier(name)) continue;
      const target = canonical(checker.getSymbolAtLocation(name));
      let references = 0;
      const count = (node) => { if (ts.isIdentifier(node) && canonical(checker.getSymbolAtLocation(node)) === target) references += 1; ts.forEachChild(node, count); };
      programSources.forEach(count);
      if (references < 2) failures.push(`${file}: exported symbol ${name.text} has no semantic consumer`);
    }
  }

  const packageJson = JSON.parse(await source("package.json"));
  for (const name of ["predev", "prebuild", "prestart"]) if (packageJson.scripts?.[name] !== "npm run validate:design") failures.push(`${name} must block on validate:design`);
  if (packageJson.scripts?.["validate:design"] !== "node app/design-system/validation/validate-design-system.mjs" || packageJson.scripts?.["test:architecture"] !== "node app/design-system/validation/test-architecture-proof.mjs") failures.push("Root lifecycle commands must delegate to the portable design-system validators");
  const modulePackage = JSON.parse(await source("app/design-system/package.json"));
  if (modulePackage.scripts?.validate !== "node validation/validate-design-system.mjs" || modulePackage.scripts?.proof !== "node validation/test-architecture-proof.mjs") failures.push("Portable design-system package must expose validate and proof commands");
  if (!(texts.get("vite.config.ts") ?? "").includes("./app/design-system/validation/validate-design-system.mjs") || !(texts.get("vite.config.ts") ?? "").includes("await validateDesignSystem()")) failures.push("vite.config.ts must invoke the portable design-system validator before creating the server configuration");

  if (failures.length) throw new Error(`Architecture proof failed:\n- ${[...new Set(failures)].join("\n- ")}`);
  return `Architecture proof passed: ${graphFiles.size} active sources are declared and reachable; DOM, content, colors, exports, and CSS consumers satisfy the manifest.`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { console.log(await validateDesignSystem()); }
  catch (error) { console.error(error.message); process.exit(1); }
}
