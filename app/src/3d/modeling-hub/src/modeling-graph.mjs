import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const vector3 = z.object({ x: z.number(), y: z.number(), z: z.number() }).strict();
const transform = z.object({ translationMm: vector3, rotationDeg: vector3, scale: vector3 }).strict();
const profilePoint = z.object({ xMm: z.number(), yMm: z.number(), zMm: z.number() }).strict();
const material = z.object({ name: z.string().min(1).max(120), baseColor: color, roughness: z.number().min(0).max(1), metallic: z.number().min(0).max(1), transmission: z.number().min(0).max(1), ior: z.number().min(1).max(3), opacity: z.number().min(0).max(1) }).strict();

export const FEATURE_OPERATIONS = Object.freeze([
  "profile", "primitive", "revolve", "extrude", "loft", "sweep", "shell", "boolean",
  "hole", "groove", "rib", "thread", "pattern", "fillet", "chamfer", "transform", "mate",
  "uv_projection", "surface_decal", "volume", "instance_distribution",
]);
export const COMPILED_OPERATIONS = Object.freeze(["revolve", "extrude", "primitive", "surface_decal", "volume", "instance_distribution"]);
const NORMALIZED_MODIFIER_OPERATIONS = new Set(["shell", "rib", "pattern"]);
export const ANALYSIS_OPERATIONS = Object.freeze(["profile", ...COMPILED_OPERATIONS, ...NORMALIZED_MODIFIER_OPERATIONS]);

const featureParameters = z.object({
  primitive: z.enum(["box", "cylinder", "cone", "sphere", "torus"]).nullable(),
  profile: z.array(profilePoint).max(128).nullable(),
  profiles: z.array(z.array(profilePoint).max(128)).max(16).nullable(),
  dimensionsMm: vector3.nullable(),
  radiusMm: z.number().min(0).max(2000).nullable(),
  innerRadiusMm: z.number().min(0).max(2000).nullable(),
  heightMm: z.number().min(0).max(4000).nullable(),
  thicknessMm: z.number().min(0).max(200).nullable(),
  angleDeg: z.number().min(-360).max(360).nullable(),
  count: z.number().int().min(0).max(1000).nullable(),
  spacingMm: z.number().min(0).max(2000).nullable(),
  depthMm: z.number().min(0).max(1000).nullable(),
  offsetMm: z.number().min(-100).max(100).nullable(),
  operation: z.enum(["union", "cut", "intersect"]).nullable(),
  axis: z.enum(["x", "y", "z"]).nullable(),
  projection: z.enum(["planar", "cylindrical", "uv"]).nullable(),
  hostComponentKey: z.string().max(100).nullable(),
  artworkImageId: z.string().max(160).nullable(),
  artworkCrop: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().min(0).max(1), height: z.number().min(0).max(1) }).strict().nullable(),
  wrapDegrees: z.number().min(0).max(360).nullable(),
  quantity: z.number().int().min(1).max(1000).nullable(),
  distribution: z.enum(["grid", "radial", "contained_random", "surface"]).nullable(),
  interfaceKey: z.string().max(120).nullable(),
  transform: transform.nullable(),
}).strict();

const featureOutput = z.object({
  key: z.string().min(1).max(100),
  operation: z.enum(ANALYSIS_OPERATIONS),
  inputKeys: z.array(z.string().min(1).max(100)).max(32),
  parameters: featureParameters,
  rationale: z.string().max(600),
  confidence: z.number().min(0).max(1),
}).strict();

const componentOutput = z.object({
  componentKey: z.string().min(1).max(100),
  representation: z.enum(["brep_solid", "visual_surface", "volume", "instance_set"]),
  summary: z.string().max(600),
  hostComponentKey: z.string().max(100).nullable(),
  material,
  transform,
  features: z.array(featureOutput).min(1).max(96),
}).strict();

export const modelingGraphOutputSchema = z.object({
  product: z.object({ name: z.string().min(1).max(160), intendedUse: z.string().max(800), widthMm: z.number().min(1).max(2000), heightMm: z.number().min(1).max(4000), depthMm: z.number().min(1).max(2000), capacityMl: z.number().min(0).max(100000).nullable() }).strict(),
  components: z.array(componentOutput).min(1).max(30),
  interfaces: z.array(z.object({ key: z.string().min(1).max(120), componentKeys: z.array(z.string().min(1).max(100)).min(2).max(12), kind: z.enum(["mate", "contact", "clearance", "thread", "seal"]), clearanceMm: z.number().min(-20).max(100).nullable(), rationale: z.string().max(600) }).strict()).max(60),
}).strict();

export const modelingGraphSchema = z.object({
  version: z.literal("net30.modeling-graph.v1"), units: z.literal("mm"), axis: z.literal("z-up"),
  components: z.array(z.object({ id: z.string(), requestedName: z.string(), representation: z.enum(["brep_solid", "visual_surface", "volume", "instance_set", "legacy_mesh"]), rootNodeIds: z.array(z.string()), hostComponentId: z.string().nullable(), material, transform, summary: z.string() }).strict()).min(1).max(30),
  nodes: z.array(z.object({ id: z.string(), componentId: z.string(), operation: z.enum(FEATURE_OPERATIONS), inputNodeIds: z.array(z.string()), parameters: featureParameters, rationale: z.string(), confidence: z.number().min(0).max(1) }).strict()).min(1).max(2000),
  interfaces: z.array(z.object({ id: z.string(), componentIds: z.array(z.string()).min(2), kind: z.enum(["mate", "contact", "clearance", "thread", "seal"]), clearanceMm: z.number().nullable(), rationale: z.string() }).strict()).max(60),
  evidence: z.array(z.object({ id: z.string(), kind: z.enum(["user", "official", "image", "inference", "existing_asset"]), label: z.string(), imageId: z.string().nullable() }).strict()).max(120),
}).strict();

export const modelingPatchSchema = z.object({
  version: z.literal("net30.modeling-patch.v1"), baseGraphHash: z.string().length(64),
  scope: z.object({ stage: z.enum(["assembly", "component_structure", "shape_dimensions", "material_surface", "interfaces", "prebuild", "result_review"]), componentIds: z.array(z.string()).max(30) }).strict(),
  changes: z.array(z.discriminatedUnion("op", [
    z.object({ op: z.literal("set_parameter"), nodeId: z.string(), field: z.enum(Object.keys(featureParameters.shape)), expectedValueHash: z.string().length(64), value: z.union([z.string(), z.number(), z.boolean(), z.null(), vector3, transform, z.array(profilePoint), z.array(z.array(profilePoint))]), rationale: z.string().max(600) }).strict(),
    z.object({ op: z.literal("replace_material"), componentId: z.string(), expectedValueHash: z.string().length(64), value: material, rationale: z.string().max(600) }).strict(),
    z.object({ op: z.literal("set_transform"), componentId: z.string(), expectedValueHash: z.string().length(64), value: transform, rationale: z.string().max(600) }).strict(),
    z.object({ op: z.literal("add_node"), componentId: z.string(), afterNodeId: z.string().nullable(), value: featureOutput, rationale: z.string().max(600) }).strict(),
    z.object({ op: z.literal("remove_node"), nodeId: z.string(), expectedValueHash: z.string().length(64), rationale: z.string().max(600) }).strict(),
  ])).min(1).max(120),
}).strict();

export function valueHash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function graphHash(graph) { return valueHash(modelingGraphSchema.parse(graph)); }
export function modelingGraphJsonSchema() { return z.toJSONSchema(modelingGraphOutputSchema, { target: "draft-7" }); }
export function modelingPatchJsonSchema() { return z.toJSONSchema(modelingPatchSchema, { target: "draft-7" }); }

function defaultTransform() { return { translationMm: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }; }
function profileFor(kind, width, height) {
  const radius = width / 2;
  if (kind === "closure") return [{ xMm: radius, yMm: 0, zMm: 0 }, { xMm: radius, yMm: 0, zMm: height * .86 }, { xMm: radius * .92, yMm: 0, zMm: height }];
  return [{ xMm: radius * .82, yMm: 0, zMm: 0 }, { xMm: radius, yMm: 0, zMm: height * .06 }, { xMm: radius, yMm: 0, zMm: height * .62 }, { xMm: radius * .92, yMm: 0, zMm: height * .74 }, { xMm: radius * .64, yMm: 0, zMm: height * .84 }, { xMm: radius * .64, yMm: 0, zMm: height }];
}

export function fixtureGraphOutput(payload) {
  const names = payload.requestedComponents; const componentKeys = names.map((_, index) => `component-${index + 1}`);
  const bodyIndex = names.findIndex((name) => /병|용기|bottle|container/i.test(name)); const bodyKey = componentKeys[Math.max(0, bodyIndex)];
  return modelingGraphOutputSchema.parse({
    product: { name: payload.product.name ?? "제품", intendedUse: "이미지와 프롬프트를 바탕으로 승인할 제품", widthMm: 56, heightMm: 105, depthMm: 56, capacityMl: 100 },
    components: names.map((name, index) => {
      const key = componentKeys[index]; const closure = /뚜껑|캡|cap|lid/i.test(name); const ring = /링|liner|라이너/i.test(name); const print = /인쇄|프린트|눈금|로고|print|decal|label/i.test(name); const content = /내용|액체|분말|정제|캡슐/i.test(name);
      const representation = print ? "visual_surface" : content ? "instance_set" : "brep_solid";
      const op = print ? "surface_decal" : content ? "instance_distribution" : ring ? "extrude" : "revolve";
      const materialValue = print ? { name: "이미지에서 추출한 인쇄 잉크", baseColor: "#f4f4f0", roughness: .35, metallic: 0, transmission: 0, ior: 1.45, opacity: 1 } : closure || ring ? { name: "Polypropylene", baseColor: "#083da9", roughness: .34, metallic: 0, transmission: 0, ior: 1.49, opacity: 1 } : { name: "Borosilicate glass", baseColor: "#d7e8f6", roughness: .08, metallic: 0, transmission: .82, ior: 1.52, opacity: .32 };
      const parameters = { primitive: content ? "sphere" : null, profile: op === "revolve" ? profileFor(closure ? "closure" : "body", closure ? 54 : 56, closure ? 25 : 100) : null, profiles: null, dimensionsMm: ring ? { x: 42, y: 42, z: 7 } : content ? { x: 8, y: 8, z: 16 } : null, radiusMm: ring ? 21 : null, innerRadiusMm: ring ? 18 : null, heightMm: ring ? 7 : null, thicknessMm: print ? .08 : closure ? 2 : 2.2, angleDeg: op === "revolve" ? 360 : null, count: closure ? 32 : content ? 30 : null, spacingMm: null, depthMm: closure ? 1.2 : null, offsetMm: print ? .15 : null, operation: null, axis: "z", projection: print ? "cylindrical" : null, hostComponentKey: print ? bodyKey : null, artworkImageId: print ? (payload.imageIds?.[0] ?? null) : null, artworkCrop: print ? { x: .08, y: .42, width: .84, height: .46 } : null, wrapDegrees: print ? 118 : null, quantity: content ? 30 : null, distribution: content ? "contained_random" : null, interfaceKey: closure || ring ? "closure-main" : null, transform: defaultTransform() };
      return { componentKey: key, representation, summary: `${name}의 이미지 기반 형상 그래프`, hostComponentKey: print ? bodyKey : null, material: materialValue, transform: defaultTransform(), features: [{ key: `${key}-root`, operation: op, inputKeys: [], parameters, rationale: `${name}의 시각적 실루엣과 재질을 표현합니다.`, confidence: .72 }] };
    }),
    interfaces: componentKeys.length > 1 ? [{ key: "closure-main", componentKeys: componentKeys.slice(0, Math.min(3, componentKeys.length)), kind: "mate", clearanceMm: .25, rationale: "공통 조립 축과 결합 간극" }] : [],
  });
}

export function canonicalizeGraph(output, requestedNames, imageIds = []) {
  const parsed = modelingGraphOutputSchema.parse(output);
  if (parsed.components.length !== requestedNames.length) throw new Error("analysis_incomplete: 입력한 컴포넌트 수와 모델링 그래프가 일치하지 않습니다.");
  const keyToId = new Map(); parsed.components.forEach((item, index) => keyToId.set(item.componentKey, `cmp-${randomUUID().slice(0, 12)}-${index + 1}`));
  if (keyToId.size !== parsed.components.length) throw new Error("analysis_incomplete: 모델링 그래프의 컴포넌트 키가 중복되었습니다.");
  /* `profile` is a declarative geometry source, not an independently emitted
   * solid. Structured output models naturally separate it from `revolve` or
   * `extrude`, so normalize that valid graph form into the compiler's canonical
   * embedded-profile representation instead of rejecting the component name. */
  const normalizedComponents = parsed.components.map((component) => {
    const byKey = new Map(component.features.map((feature) => [feature.key, feature]));
    let features = component.features.filter((feature) => feature.operation !== "profile").map((feature) => {
      if (feature.parameters.profile?.length) return feature;
      const source = feature.inputKeys.map((key) => byKey.get(key)).find((candidate) => candidate?.operation === "profile" && candidate.parameters.profile?.length);
      return source ? { ...feature, inputKeys: feature.inputKeys.filter((key) => key !== source.key), parameters: { ...feature.parameters, profile: source.parameters.profile } } : feature;
    });
    const normalizedByKey = new Map(features.map((feature) => [feature.key, structuredClone(feature)]));
    const findCompiledSource = (feature, seen = new Set()) => {
      if (!feature || seen.has(feature.key)) return null; seen.add(feature.key);
      if (COMPILED_OPERATIONS.includes(feature.operation)) return feature;
      for (const key of feature.inputKeys) { const source = findCompiledSource(normalizedByKey.get(key), seen); if (source) return source; }
      return null;
    };
    for (const modifier of features.filter((feature) => NORMALIZED_MODIFIER_OPERATIONS.has(feature.operation))) {
      const source = findCompiledSource(modifier);
      if (!source) throw new Error(`unsupported_operation: ${component.componentKey}.${modifier.operation}에 적용할 생성 연산이 없습니다.`);
      for (const key of ["thicknessMm", "count", "spacingMm", "depthMm", "offsetMm"]) if (modifier.parameters[key] !== null) source.parameters[key] = modifier.parameters[key];
    }
    features = [...normalizedByKey.values()].filter((feature) => !NORMALIZED_MODIFIER_OPERATIONS.has(feature.operation)).map((feature) => ({ ...feature, inputKeys: feature.inputKeys.filter((key) => normalizedByKey.has(key) && !NORMALIZED_MODIFIER_OPERATIONS.has(normalizedByKey.get(key).operation)) }));
    if (!features.length) throw new Error(`unsupported_operation: ${component.componentKey}.profile에는 revolve·extrude 같은 생성 연산이 필요합니다.`);
    const featureHostKeys = [...new Set(features.map((feature) => feature.parameters.hostComponentKey).filter(Boolean))];
    if (featureHostKeys.length > 1 || (component.hostComponentKey && featureHostKeys.length && component.hostComponentKey !== featureHostKeys[0])) throw new Error(`graph_invalid: ${component.componentKey}의 부착 대상 참조가 충돌합니다.`);
    return { ...component, hostComponentKey: component.hostComponentKey ?? featureHostKeys[0] ?? null, features };
  });
  const nodeKeyToId = new Map(); for (const component of normalizedComponents) for (const feature of component.features) { if (nodeKeyToId.has(feature.key)) throw new Error("analysis_incomplete: feature key가 중복되었습니다."); nodeKeyToId.set(feature.key, `node-${randomUUID().slice(0, 12)}`); }
  const components = normalizedComponents.map((item, index) => ({ id: keyToId.get(item.componentKey), requestedName: requestedNames[index], representation: item.representation, rootNodeIds: item.features.map((feature) => nodeKeyToId.get(feature.key)), hostComponentId: item.hostComponentKey ? keyToId.get(item.hostComponentKey) ?? null : null, material: item.material, transform: item.transform, summary: item.summary }));
  const nodes = normalizedComponents.flatMap((component) => component.features.map((feature) => ({ id: nodeKeyToId.get(feature.key), componentId: keyToId.get(component.componentKey), operation: feature.operation, inputNodeIds: feature.inputKeys.map((key) => nodeKeyToId.get(key)).filter(Boolean), parameters: { ...feature.parameters, hostComponentKey: feature.parameters.hostComponentKey ? keyToId.get(feature.parameters.hostComponentKey) ?? null : null }, rationale: feature.rationale, confidence: feature.confidence })));
  const graph = modelingGraphSchema.parse({ version: "net30.modeling-graph.v1", units: "mm", axis: "z-up", components, nodes, interfaces: parsed.interfaces.map((item) => ({ id: `interface-${randomUUID().slice(0, 10)}`, componentIds: item.componentKeys.map((key) => keyToId.get(key)).filter(Boolean), kind: item.kind, clearanceMm: item.clearanceMm, rationale: item.rationale })), evidence: [{ id: `evidence-${randomUUID().slice(0, 10)}`, kind: imageIds.length ? "image" : "user", label: imageIds.length ? "사용자 모델링 입력 이미지" : "사용자 프롬프트", imageId: imageIds[0] ?? null }] });
  validateGraph(graph); return { product: parsed.product, graph, graphHash: graphHash(graph) };
}

export function validateGraph(graph) {
  const parsed = modelingGraphSchema.parse(graph); const components = new Set(parsed.components.map((item) => item.id)); const nodes = new Map(parsed.nodes.map((item) => [item.id, item]));
  for (const component of parsed.components) {
    if (component.hostComponentId && !components.has(component.hostComponentId)) throw new Error(`graph_invalid: ${component.id}의 host component가 없습니다.`);
    if (component.representation === "visual_surface" && !component.hostComponentId) throw new Error(`graph_invalid: ${component.requestedName}에 부착 대상 표면이 필요합니다.`);
    for (const id of component.rootNodeIds) if (!nodes.has(id)) throw new Error(`graph_invalid: root node ${id}가 없습니다.`);
  }
  for (const node of parsed.nodes) { if (!COMPILED_OPERATIONS.includes(node.operation)) throw new Error(`unsupported_operation: ${node.id}.${node.operation}`); if (!components.has(node.componentId)) throw new Error(`graph_invalid: node ${node.id}의 component가 없습니다.`); for (const input of node.inputNodeIds) if (!nodes.has(input)) throw new Error(`graph_invalid: node ${node.id}의 input ${input}이 없습니다.`); }
  const visiting = new Set(); const visited = new Set(); const visit = (id) => { if (visiting.has(id)) throw new Error(`graph_invalid: 순환 feature 참조 ${id}`); if (visited.has(id)) return; visiting.add(id); for (const input of nodes.get(id)?.inputNodeIds ?? []) visit(input); visiting.delete(id); visited.add(id); }; for (const id of nodes.keys()) visit(id);
  return parsed;
}

export function applyModelingPatch(graph, patch) {
  const current = structuredClone(validateGraph(graph)); const parsed = modelingPatchSchema.parse(patch); if (parsed.baseGraphHash !== graphHash(current)) throw new Error("revision_conflict: 모델링 그래프가 변경되었습니다."); const allowed = new Set(parsed.scope.componentIds);
  for (const change of parsed.changes) {
    if (change.op === "set_parameter") { const node = current.nodes.find((item) => item.id === change.nodeId); if (!node || (allowed.size && !allowed.has(node.componentId))) throw new Error("patch_scope_violation: 선택 범위 밖의 node입니다."); if (valueHash(node.parameters[change.field]) !== change.expectedValueHash) throw new Error("revision_conflict: node 값이 변경되었습니다."); node.parameters[change.field] = change.value; }
    else if (change.op === "replace_material" || change.op === "set_transform") { const component = current.components.find((item) => item.id === change.componentId); if (!component || (allowed.size && !allowed.has(component.id))) throw new Error("patch_scope_violation: 선택 범위 밖의 component입니다."); const key = change.op === "replace_material" ? "material" : "transform"; if (valueHash(component[key]) !== change.expectedValueHash) throw new Error("revision_conflict: component 값이 변경되었습니다."); component[key] = change.value; }
    else if (change.op === "remove_node") { const index = current.nodes.findIndex((item) => item.id === change.nodeId); const node = current.nodes[index]; if (!node || (allowed.size && !allowed.has(node.componentId))) throw new Error("patch_scope_violation: 선택 범위 밖의 node입니다."); if (valueHash(node) !== change.expectedValueHash) throw new Error("revision_conflict: node가 변경되었습니다."); current.nodes.splice(index, 1); const component = current.components.find((item) => item.id === node.componentId); component.rootNodeIds = component.rootNodeIds.filter((id) => id !== node.id); }
    else if (change.op === "add_node") { const component = current.components.find((item) => item.id === change.componentId); if (!component || (allowed.size && !allowed.has(component.id))) throw new Error("patch_scope_violation: 선택 범위 밖의 component입니다."); const id = `node-${randomUUID().slice(0, 12)}`; current.nodes.push({ id, componentId: component.id, operation: change.value.operation, inputNodeIds: change.value.inputKeys.map((key) => current.nodes.find((node) => node.id === key)?.id).filter(Boolean), parameters: change.value.parameters, rationale: change.rationale, confidence: change.value.confidence }); component.rootNodeIds.push(id); }
  }
  validateGraph(current); return { graph: current, graphHash: graphHash(current) };
}

export function graphSketchPlan(product, graph) {
  const width = 1000, height = 680; const views = ["front", "side", "isometric"];
  const components = graph.components.map((component, index) => {
    const node = graph.nodes.find((item) => component.rootNodeIds.includes(item.id)); const profile = node?.parameters.profile ?? null; const dimensions = node?.parameters.dimensionsMm ?? { x: product.widthMm * .8, y: product.depthMm * .8, z: product.heightMm * .6 }; const columnWidth = width / views.length; const originX = index % 3 * columnWidth + columnWidth / 2; const baseY = 560 - Math.floor(index / 3) * 190;
    const points = profile?.length ? [...profile.map((point) => ({ x: originX + point.xMm * 3.3, y: baseY - point.zMm * 3.3 })), ...[...profile].reverse().map((point) => ({ x: originX - point.xMm * 3.3, y: baseY - point.zMm * 3.3 }))] : [{ x: originX - dimensions.x * 1.5, y: baseY }, { x: originX + dimensions.x * 1.5, y: baseY }, { x: originX + dimensions.x * 1.5, y: baseY - dimensions.z * 3 }, { x: originX - dimensions.x * 1.5, y: baseY - dimensions.z * 3 }];
    return { id: component.id, label: component.requestedName, representation: component.representation, nodeIds: component.rootNodeIds, points, color: component.material.baseColor, note: component.summary };
  });
  return { version: "net30.graph-sketch.v1", width, height, title: `${product.name} 실형상 그래프 검토`, views, components, annotations: [{ label: "현재 ModelingGraph의 형상·재질·결합값을 직접 투영한 검토 보기입니다.", x: 36, y: 42 }] };
}
