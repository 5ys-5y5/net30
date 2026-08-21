import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const vector3 = z.object({ x: z.number(), y: z.number(), z: z.number() }).strict();
const transform = z.object({ translationMm: vector3, rotationDeg: vector3, scale: vector3 }).strict();
const profilePoint = z.object({ xMm: z.number(), yMm: z.number(), zMm: z.number() }).strict();
const curvePoint = z.object({ xMm: z.number(), zMm: z.number() }).strict();
const curveSegment = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("line"), points: z.tuple([curvePoint, curvePoint]), periodic: z.boolean() }).strict(),
  z.object({ kind: z.literal("arc"), points: z.array(curvePoint).length(3), periodic: z.boolean() }).strict(),
  z.object({ kind: z.literal("bezier"), points: z.array(curvePoint).length(4), periodic: z.boolean() }).strict(),
  z.object({ kind: z.literal("nurbs"), poles: z.array(curvePoint).min(2).max(64), degree: z.number().int().min(1).max(5), weights: z.array(z.number().positive()).min(2).max(64), knots: z.array(z.number()).min(2).max(96), multiplicities: z.array(z.number().int().min(1).max(6)).min(2).max(96), periodic: z.boolean() }).strict(),
]);
const material = z.object({ name: z.string().min(1).max(120), baseColor: color, roughness: z.number().min(0).max(1), metallic: z.number().min(0).max(1), transmission: z.number().min(0).max(1), ior: z.number().min(1).max(3), opacity: z.number().min(0).max(1) }).strict();

export const FEATURE_OPERATIONS = Object.freeze([
  "profile", "primitive", "revolve", "extrude", "loft", "sweep", "shell", "boolean",
  "hole", "groove", "rib", "thread", "pattern", "fillet", "chamfer", "transform", "mate",
  "uv_projection", "surface_decal", "surface_artwork", "volume", "instance_distribution",
]);
export const COMPILED_OPERATIONS = Object.freeze(["revolve", "extrude", "primitive", "shell", "boolean", "rib", "pattern", "transform", "mate", "surface_decal", "surface_artwork", "volume", "instance_distribution"]);
const NORMALIZED_MODIFIER_OPERATIONS = new Set();
export const ANALYSIS_OPERATIONS = Object.freeze(["profile", ...COMPILED_OPERATIONS]);

const featureParameters = z.object({
  primitive: z.enum(["box", "cylinder", "cone", "sphere", "torus"]).nullable(),
  profile: z.array(profilePoint).max(128).nullable(),
  curveSegments: z.array(curveSegment).max(64).nullable(),
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

const featureOutputBase = {
  key: z.string().min(1).max(100),
  parameters: featureParameters,
  rationale: z.string().max(600),
  confidence: z.number().min(0).max(1),
};
const featureKey = z.array(z.string().min(1).max(100));
// This schema is intentionally topological, not merely syntactic.  Constrained
// decoding must not be able to emit an extrude that consumes a shell, a pattern
// without its host solid, or a Boolean that has only one operand. Continuous
// profile values remain evidence/fitter inputs, while graph wiring is decided
// here as a discrete, compiler-supported CAD contract.
// OpenAI Structured Outputs permits `anyOf` but rejects JSON Schema `oneOf`.
// Zod's ordinary union emits the former while retaining the same exhaustive
// operation/input-cardinality validation when the response is parsed.
const featureOutput = z.union([
  ...["profile", "primitive", "revolve", "extrude", "surface_decal", "surface_artwork", "volume", "instance_distribution"].map((operation) => z.object({ ...featureOutputBase, operation: z.literal(operation), inputKeys: featureKey.max(0) }).strict()),
  ...["shell", "rib", "transform", "mate"].map((operation) => z.object({ ...featureOutputBase, operation: z.literal(operation), inputKeys: featureKey.min(1).max(1) }).strict()),
  z.object({ ...featureOutputBase, operation: z.literal("pattern"), inputKeys: featureKey.min(2).max(2) }).strict(),
  z.object({ ...featureOutputBase, operation: z.literal("boolean"), inputKeys: featureKey.min(2).max(32) }).strict(),
]);

const componentOutput = z.object({
  componentKey: z.string().min(1).max(100),
  representation: z.enum(["brep_solid", "visual_surface", "volume", "instance_set"]),
  summary: z.string().max(600),
  hostComponentKey: z.string().max(100).nullable(),
  material,
  transform,
  features: z.array(featureOutput).min(1).max(96),
}).strict();

// A topology repair must not regenerate product-wide identities or unrelated
// components. Keeping this strict response to one component prevents a local
// Boolean/rib repair from changing an approved sibling's graph.
export const modelingComponentRepairOutputSchema = z.object({ component: componentOutput }).strict();

export const modelingGraphOutputSchema = z.object({
  product: z.object({ name: z.string().min(1).max(160), intendedUse: z.string().max(800), widthMm: z.number().min(1).max(2000), heightMm: z.number().min(1).max(4000), depthMm: z.number().min(1).max(2000), capacityMl: z.number().min(0).max(100000).nullable() }).strict(),
  components: z.array(componentOutput).min(1).max(30),
  interfaces: z.array(z.object({ key: z.string().min(1).max(120), componentKeys: z.array(z.string().min(1).max(100)).min(2).max(12), kind: z.enum(["mate", "contact", "clearance", "thread", "seal"]), clearanceMm: z.number().min(-20).max(100).nullable(), rationale: z.string().max(600) }).strict()).max(60),
}).strict();

export const modelingGraphSchema = z.object({
  version: z.enum(["net30.modeling-graph.v1", "net30.modeling-graph.v2"]), units: z.literal("mm"), axis: z.literal("z-up"),
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

/** Additive migration for revisions saved before declared curve support.
 * This only writes the explicit `null` meaning that earlier snapshots did not
 * contain. It must not invent a new curve while a user is refining an old
 * B-Rep asset. */
export function normaliseGraphCompatibility(graph) {
  const next = structuredClone(graph);
  for (const node of next?.nodes ?? []) if (node?.parameters && node.parameters.curveSegments === undefined) node.parameters.curveSegments = null;
  return next;
}

export function graphHash(graph) { return valueHash(modelingGraphSchema.parse(normaliseGraphCompatibility(graph))); }
export function modelingGraphJsonSchema() { return z.toJSONSchema(modelingGraphOutputSchema, { target: "draft-7" }); }
export function modelingComponentRepairJsonSchema() { return z.toJSONSchema(modelingComponentRepairOutputSchema, { target: "draft-7" }); }
export function modelingPatchJsonSchema() { return z.toJSONSchema(modelingPatchSchema, { target: "draft-7" }); }

function defaultTransform() { return { translationMm: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }; }
function profileFor(kind, width, height) {
  const radius = width / 2;
  if (kind === "closure") return [{ xMm: 0, yMm: 0, zMm: 0 }, { xMm: radius, yMm: 0, zMm: 0 }, { xMm: radius, yMm: 0, zMm: height * .86 }, { xMm: radius * .92, yMm: 0, zMm: height }, { xMm: 0, yMm: 0, zMm: height }];
  return [{ xMm: 0, yMm: 0, zMm: 0 }, { xMm: radius * .82, yMm: 0, zMm: 0 }, { xMm: radius, yMm: 0, zMm: height * .06 }, { xMm: radius, yMm: 0, zMm: height * .62 }, { xMm: radius * .92, yMm: 0, zMm: height * .74 }, { xMm: radius * .64, yMm: 0, zMm: height * .84 }, { xMm: radius * .64, yMm: 0, zMm: height }, { xMm: 0, yMm: 0, zMm: height }];
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
      const parameters = { primitive: content ? "sphere" : null, profile: op === "revolve" ? profileFor(closure ? "closure" : "body", closure ? 54 : 56, closure ? 25 : 100) : null, curveSegments: null, profiles: null, dimensionsMm: ring ? { x: 42, y: 42, z: 7 } : content ? { x: 8, y: 8, z: 16 } : null, radiusMm: ring ? 21 : null, innerRadiusMm: ring ? 18 : null, heightMm: ring ? 7 : null, thicknessMm: print ? .08 : closure ? 2 : 2.2, angleDeg: op === "revolve" ? 360 : null, count: closure ? 32 : content ? 30 : null, spacingMm: null, depthMm: closure ? 1.2 : null, offsetMm: print ? .15 : null, operation: null, axis: "z", projection: print ? "cylindrical" : null, hostComponentKey: print ? bodyKey : null, artworkImageId: print ? (payload.imageIds?.[0] ?? null) : null, artworkCrop: print ? { x: .08, y: .42, width: .84, height: .46 } : null, wrapDegrees: print ? 118 : null, quantity: content ? 30 : null, distribution: content ? "contained_random" : null, interfaceKey: closure || ring ? "closure-main" : null, transform: defaultTransform() };
      return { componentKey: key, representation, summary: `${name}의 이미지 기반 형상 그래프`, hostComponentKey: print ? bodyKey : null, material: materialValue, transform: defaultTransform(), features: [{ key: `${key}-root`, operation: op, inputKeys: [], parameters, rationale: `${name}의 시각적 실루엣과 재질을 표현합니다.`, confidence: .72 }] };
    }),
    interfaces: componentKeys.length > 1 ? [{ key: "closure-main", componentKeys: componentKeys.slice(0, Math.min(3, componentKeys.length)), kind: "mate", clearanceMm: .25, rationale: "공통 조립 축과 결합 간극" }] : [],
  });
}

export function canonicalizeGraph(output, requestedNames, imageIds = []) {
  // Existing immutable Vision responses predate v3's declared curve field.
  // They did not say "no curve" incorrectly; the field simply did not exist.
  // Normalize that one additive omission before strict parsing so a stored
  // draft can be refined without re-running expensive multimodal analysis.
  const compatibleOutput = structuredClone(output);
  for (const component of compatibleOutput?.components ?? []) for (const feature of component?.features ?? []) {
    if (feature?.parameters && feature.parameters.curveSegments === undefined) feature.parameters.curveSegments = null;
  }
  const parsed = modelingGraphOutputSchema.parse(compatibleOutput);
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
    features = features.map((feature) => {
      const rawProfile = feature.parameters.profile;
      if (!rawProfile?.length) return feature;
      /* The vision schema carries a three-axis point for reuse by sweep/loft,
       * while an axisymmetric profile only has radius and one axial ordinate.
       * Models may put that ordinate in yMm or zMm. Canonical B-Rep input is
       * always XZ; select the varying ordinate once and persist it explicitly. */
      const ySpan = Math.max(...rawProfile.map((point) => point.yMm)) - Math.min(...rawProfile.map((point) => point.yMm));
      const zSpan = Math.max(...rawProfile.map((point) => point.zMm)) - Math.min(...rawProfile.map((point) => point.zMm));
      const profile = rawProfile.map((point) => ({ ...point, yMm: 0, zMm: zSpan >= ySpan ? point.zMm : point.yMm }));
      return { ...feature, parameters: { ...feature.parameters, profile } };
    });
    // Vision may consistently choose Y as an axisymmetric component's vertical
    // ordinate. Profiles were already normalized into XZ above, but a mouth
    // cutter or groove transform expressed in that same source coordinate
    // system must move with it. Leaving `translation.y` untouched placed a
    // correct bottle-mouth cutter at the local datum, where it cut the base
    // instead of the neck. This is a component-coordinate conversion, not a
    // product-name rule or an inferred geometric alteration.
    const profileAxisWasY = component.features.some((feature) => {
      const profile = feature.parameters.profile ?? []; if (profile.length < 2) return false;
      const ySpan = Math.max(...profile.map((point) => point.yMm)) - Math.min(...profile.map((point) => point.yMm));
      const zSpan = Math.max(...profile.map((point) => point.zMm)) - Math.min(...profile.map((point) => point.zMm));
      return ySpan > zSpan + 1e-6;
    });
    if (profileAxisWasY) features = features.map((feature) => {
      const params = feature.parameters ?? {}; const translation = params.transform?.translationMm;
      if (!translation || Math.abs(Number(translation.z ?? 0)) > 1e-6 || Math.abs(Number(translation.y ?? 0)) <= 1e-6) return params.axis === "y" ? { ...feature, parameters: { ...params, axis: "z" } } : feature;
      return { ...feature, parameters: { ...params, axis: params.axis === "y" ? "z" : params.axis, transform: { ...params.transform, translationMm: { ...translation, y: 0, z: translation.y } } }, rationale: `${feature.rationale} (Y축 axial transform을 XZ 좌표계로 정규화함)` };
    });
    const componentZ = Number(component.transform?.translationMm?.z ?? 0);
    features = features.map((feature) => {
      const profile = feature.parameters.profile;
      if (!profile?.length || Math.abs(componentZ) < 1e-6) return feature;
      const minZ = Math.min(...profile.map((point) => point.zMm));
      const maxZ = Math.max(...profile.map((point) => point.zMm));
      const centreZ = (minZ + maxZ) / 2;
      /* Vision sometimes reports an absolute assembly-height profile as well
       * as the same component transform. Convert that profile to component-
       * local coordinates so the transform is applied exactly once. */
      if (Math.abs(centreZ - componentZ) > Math.max(10, (maxZ - minZ) * 2)) return feature;
      return { ...feature, parameters: { ...feature.parameters, profile: profile.map((point) => ({ ...point, zMm: point.zMm - componentZ })) }, rationale: `${feature.rationale} (절대 높이 프로필을 component-local 좌표로 정규화함)` };
    });
    /* Structured output occasionally omits the edge from a modifier or a
     * legacy inline boolean to the immediately preceding solid. Feature order
     * is part of the component command sequence, so this edge is deterministic
     * and can be repaired locally without re-running every OpenAI component. */
    let precedingSolidKey = null;
    const componentGeneratorKey = features.find((candidate) => ["revolve", "extrude", "primitive", "loft", "sweep"].includes(candidate.operation))?.key ?? null;
    features = features.map((feature) => {
      const inlineBoolean = ["cut", "union", "intersect"].includes(feature.parameters?.operation);
      const needsBase = ["rib", "pattern", "shell", "transform", "mate"].includes(feature.operation) || inlineBoolean;
      const deterministicBase = precedingSolidKey ?? componentGeneratorKey;
      let repaired = needsBase && !feature.inputKeys.length && deterministicBase && deterministicBase !== feature.key
        ? { ...feature, inputKeys: [deterministicBase], rationale: `${feature.rationale} (서버가 같은 구성요소의 생성 B-Rep source 연결을 복구함)` }
        : feature;
      /* Some models label the first generating solid as `union`. There is no
       * operand before it, so this means "start the result with this solid",
       * not a missing dependency. Only later inline booleans need a base. */
      if (inlineBoolean && !precedingSolidKey && !repaired.inputKeys.length && feature.parameters.operation === "union") repaired = { ...feature, parameters: { ...feature.parameters, operation: null }, rationale: `${feature.rationale} (첫 B-Rep solid로 정규화함)` };
      const repairedNeedsBase = ["rib", "pattern", "shell", "transform", "mate"].includes(repaired.operation) || ["cut", "union", "intersect"].includes(repaired.parameters?.operation);
      if (repairedNeedsBase && !repaired.inputKeys.length) throw new Error(`graph_repair_required: ${component.componentKey}.${feature.operation}.inputKeys`);
      if (repaired.operation === "boolean" && repaired.inputKeys.length < 2) throw new Error(`graph_repair_required: ${component.componentKey}.boolean.inputKeys`);
      if (["revolve", "extrude", "primitive", "boolean", "rib", "pattern", "shell", "transform", "mate"].includes(repaired.operation)) precedingSolidKey = repaired.key;
      return repaired;
    });
    if (!features.length) throw new Error(`unsupported_operation: ${component.componentKey}.profile에는 revolve·extrude 같은 생성 연산이 필요합니다.`);
    /* A cavity cut that starts above the datum but reaches the full height of
     * its host primitive has neither a declared opening nor an approved roof
     * thickness. OCCT may reject its coplanar boolean, but more importantly it
     * is ambiguous manufacturing topology. Repair only this component instead
     * of changing the cutter by an unapproved magic epsilon. */
    for (const feature of features) {
      if (feature.parameters.operation !== "cut" || feature.operation !== "revolve" || !feature.parameters.profile?.length) continue;
      const base = feature.inputKeys.map((key) => byKey.get(key)).find((candidate) => ["primitive", "extrude"].includes(candidate?.operation));
      const baseHeight = Number(base?.parameters?.heightMm ?? base?.parameters?.dimensionsMm?.z ?? 0);
      const zValues = feature.parameters.profile.map((point) => point.zMm);
      if (baseHeight > 0 && Math.min(...zValues) > .01 && Math.max(...zValues) >= baseHeight - .01) {
        throw new Error(`graph_repair_required: ${component.componentKey}.boolean.cavityBoundary`);
      }
    }
    for (const feature of features) {
      if (feature.operation !== "revolve" || !feature.parameters.profile?.length) continue;
      const profile = feature.parameters.profile;
      // A B-Rep revolve must start from an actual closed section, not a
      // decorative three-point stroke. The compiler closes the supplied wire
      // but cannot manufacture a missing second boundary or non-zero area.
      // Catch the issue here so only this component receives an LLM repair.
      const area2 = profile.reduce((sum, point, index) => {
        const next = profile[(index + 1) % profile.length];
        return sum + point.xMm * next.zMm - next.xMm * point.zMm;
      }, 0);
      if (profile.length < 4 || Math.abs(area2) < .001) throw new Error(`graph_repair_required: ${component.componentKey}.revolve.closedProfile`);
    }
    /* Validate the topology which the static OCCT interpreter can actually
     * preserve. Treating a complete cap as the seed of a radial `pattern`, or
     * feeding a pattern back into a new `revolve`, looked valid as JSON but
     * produced multiple disconnected solids. Do not approximate it: repair
     * just this component and require an explicit base + rib + pattern chain.
     */
    const currentFeatures = new Map(features.map((feature) => [feature.key, feature]));
    const interpolateRadius = (profile, zMm) => {
      const visible = profile.filter((point) => point.xMm > 1e-6).sort((left, right) => left.zMm - right.zMm);
      if (visible.length < 2) return null;
      if (zMm <= visible[0].zMm) return visible[0].xMm;
      if (zMm >= visible.at(-1).zMm) return visible.at(-1).xMm;
      for (let index = 1; index < visible.length; index += 1) {
        const after = visible[index]; if (after.zMm < zMm) continue;
        const before = visible[index - 1]; const ratio = (zMm - before.zMm) / Math.max(1e-9, after.zMm - before.zMm);
        return before.xMm + (after.xMm - before.xMm) * ratio;
      }
      return null;
    };
    const outerRevolveFor = (key, seen = new Set()) => {
      if (seen.has(key)) return null; seen.add(key);
      const feature = currentFeatures.get(key); if (!feature) return null;
      const candidates = feature.operation === "revolve" && feature.parameters.profile?.length ? [feature] : feature.inputKeys.flatMap((input) => outerRevolveFor(input, seen) ?? []);
      return candidates.sort((left, right) => (Math.max(...right.parameters.profile.map((point) => point.zMm)) - Math.min(...right.parameters.profile.map((point) => point.zMm))) - (Math.max(...left.parameters.profile.map((point) => point.zMm)) - Math.min(...left.parameters.profile.map((point) => point.zMm))))[0] ?? null;
    };
    const radialAxialEnvelope = (key, seen = new Set()) => {
      if (seen.has(key)) return null; seen.add(key);
      const feature = currentFeatures.get(key); if (!feature) return null;
      const params = feature.parameters ?? {}; const translation = params.transform?.translationMm ?? { x: 0, y: 0, z: 0 };
      const inputs = feature.inputKeys.map((input) => radialAxialEnvelope(input, seen)).filter(Boolean);
      if (feature.operation === "revolve") {
        const profile = params.profile ?? []; if (!profile.length) return null;
        return { radius: Math.max(...profile.map((point) => Math.abs(point.xMm))) + Math.hypot(translation.x ?? 0, translation.y ?? 0), zMin: Math.min(...profile.map((point) => point.zMm)) + (translation.z ?? 0), zMax: Math.max(...profile.map((point) => point.zMm)) + (translation.z ?? 0) };
      }
      if (["primitive", "extrude"].includes(feature.operation)) {
        const dimensions = params.dimensionsMm; const radius = Number(params.radiusMm ?? (dimensions ? Math.max(dimensions.x, dimensions.y) / 2 : 0)); const height = Number(params.heightMm ?? dimensions?.z ?? 0);
        return Number.isFinite(radius) && Number.isFinite(height) ? { radius: radius + Math.hypot(translation.x ?? 0, translation.y ?? 0), zMin: translation.z ?? 0, zMax: (translation.z ?? 0) + height } : null;
      }
      if (feature.operation === "rib") {
        const base = inputs[0]; if (!base) return null; const depth = Number(params.depthMm ?? params.thicknessMm ?? 0); const height = Number(params.heightMm ?? 0); const z = Number(params.transform?.translationMm?.z ?? 0);
        return { radius: base.radius + Math.max(0, depth) * .65, zMin: z, zMax: z + height };
      }
      if (feature.operation === "boolean") {
        if (!inputs.length) return null;
        if (params.operation === "cut") return inputs[0];
        return { radius: Math.max(...inputs.map((item) => item.radius)), zMin: Math.min(...inputs.map((item) => item.zMin)), zMax: Math.max(...inputs.map((item) => item.zMax)) };
      }
      if (inputs.length) return { radius: Math.max(...inputs.map((item) => item.radius)), zMin: Math.min(...inputs.map((item) => item.zMin)), zMax: Math.max(...inputs.map((item) => item.zMax)) };
      return null;
    };
    for (const feature of features) {
      if (feature.inputKeys.some((key) => !currentFeatures.has(key))) throw new Error(`graph_repair_required: ${component.componentKey}.${feature.operation}.inputKeys`);
      if (["profile", "primitive", "revolve", "extrude"].includes(feature.operation) && feature.inputKeys.length) throw new Error(`graph_repair_required: ${component.componentKey}.${feature.operation}.topology`);
      if (feature.operation === "rib") {
        if (feature.inputKeys.length !== 1) throw new Error(`graph_repair_required: ${component.componentKey}.rib.inputKeys`);
        const followingPattern = features.find((candidate) => candidate.operation === "pattern" && candidate.inputKeys.at(-1) === feature.key);
        const params = feature.parameters;
        const missing = [
          (params.count ?? followingPattern?.parameters.count) === null ? "count" : null,
          (params.spacingMm ?? params.thicknessMm) === null ? "spacingMm" : null,
          (params.depthMm ?? params.thicknessMm) === null ? "depthMm" : null,
          params.heightMm === null ? "heightMm" : null,
        ].filter(Boolean);
        if (missing.length) throw new Error(`graph_repair_required: ${component.componentKey}.rib.${missing.join("+")}`);
      }
      if (feature.operation === "pattern") {
        const [baseKey, seedKey] = feature.inputKeys;
        const seed = currentFeatures.get(seedKey)?.operation;
        // A repeated feature may be a dedicated rib or a transformed plate,
        // hole boss, latch or other generated industrial feature. The graph
        // still requires explicit base + seed ordering; OCCT later proves the
        // patterned result fuses into one intended component solid.
        if (feature.inputKeys.length !== 2 || !["rib", "primitive", "extrude", "revolve", "transform"].includes(seed) || !baseKey) throw new Error(`graph_repair_required: ${component.componentKey}.pattern.baseAndSeed`);
      }
      if (feature.operation === "boolean" && feature.parameters.operation === "cut" && feature.inputKeys.length >= 2) {
        const outer = outerRevolveFor(feature.inputKeys[0]); const cutter = currentFeatures.get(feature.inputKeys[1]);
        if (outer?.parameters.profile?.length && cutter?.operation === "revolve" && cutter.parameters.profile?.length) {
          const crossing = cutter.parameters.profile.filter((point) => point.xMm > 1e-6).some((point) => {
            const radius = interpolateRadius(outer.parameters.profile, point.zMm);
            return radius !== null && point.xMm >= radius - .01;
          });
          // A cutter crossing the outer profile splits a vessel into separate
          // B-Reps.  Do not quietly turn it into a fixed cylinder or apply an
          // invented wall thickness: the component repair call receives this
          // exact topology error and must return a contained cavity/profile.
          if (crossing) throw new Error(`graph_repair_required: ${component.componentKey}.boolean.cavityWithinOuter`);
        }
        const baseEnvelope = radialAxialEnvelope(feature.inputKeys[0]);
        const escapingCutter = feature.inputKeys.slice(1).map((key) => radialAxialEnvelope(key)).find((item) => {
          if (!item || !baseEnvelope || item.radius > baseEnvelope.radius + .01) return item;
          const exitsLower = item.zMin < baseEnvelope.zMin - .01;
          const exitsUpper = item.zMax > baseEnvelope.zMax + .01;
          // A vessel mouth is intentionally made by a contained cutter that
          // leaves exactly one datum boundary.  Rejecting it as an "escaping"
          // cutter forced the LLM to retry a physically valid opening as if it
          // were a reversed Boolean.  It is still safe only when it enters the
          // body from the opposite, interior side at a smaller radius; a cutter
          // crossing both ends or beginning outside the host remains invalid.
          const exitCount = (exitsLower ? 1 : 0) + (exitsUpper ? 1 : 0);
          if (exitCount === 0) {
            // A fully contained concentric bore is still a valid B-Rep
            // feature (for example a pouring ring or a sealed internal
            // passage). It is not an open vessel mouth, so manufacturing
            // evidence must later establish how it is made, but geometry
            // validation must not replace it with a fabricated shell or
            // reject it before OCCT can verify the actual Boolean.
            return outer?.operation === "revolve" && cutter?.operation === "revolve" ? null : item;
          }
          if (exitCount !== 1) return item;
          if (!outer?.parameters.profile?.length) return item;
          const entryZ = exitsUpper ? Math.max(baseEnvelope.zMin, item.zMin) : Math.min(baseEnvelope.zMax, item.zMax);
          const hostRadius = interpolateRadius(outer.parameters.profile, entryZ);
          return hostRadius === null || item.radius >= hostRadius - .01 ? item : null;
        });
        // Boolean cut semantics are ordered.  A planner sometimes reverses a
        // vessel's outer/inner profiles, which compiles without a syntax error
        // but removes the intended solid and leaves disconnected remnants.
        if (escapingCutter) throw new Error(`graph_repair_required: ${component.componentKey}.boolean.cutContainment`);
      }
    }
    /* A manufacturing component has exactly one terminal B-Rep root.  Several
     * unconnected roots look harmless in a JSON plan but compile to a compound
     * (or a void OCCT fuse): for example an outer cap, a rib array, and two
     * independently authored sealing rings.  Require the planner to express
     * their intended union/cut explicitly.  The caller repairs only this
     * component, rather than silently treating a disconnected compound as a
     * production solid or re-running every other component analysis. */
    const referencedFeatureKeys = new Set(features.flatMap((feature) => feature.inputKeys));
    const terminalBrepRoots = features.filter((feature) =>
      !referencedFeatureKeys.has(feature.key) &&
      !["surface_decal", "surface_artwork", "volume", "instance_distribution"].includes(feature.operation),
    );
    if (component.representation === "brep_solid" && terminalBrepRoots.length !== 1) {
      throw new Error(`graph_repair_required: ${component.componentKey}.rootTopology`);
    }
    const selfHosted = component.hostComponentKey === component.componentKey || features.some((feature) => feature.parameters.hostComponentKey === component.componentKey);
    const hasSurfaceAttachment = features.some((feature) => ["surface_decal", "surface_artwork"].includes(feature.operation));
    const normalizedComponentHostKey = selfHosted && component.representation === "brep_solid" && !hasSurfaceAttachment ? null : component.hostComponentKey;
    if (selfHosted && component.representation === "brep_solid" && !hasSurfaceAttachment) {
      // A solid cannot be mounted on its own external host. Some VLM repairs
      // echo the component key in a nullable host field even though no
      // attached-surface feature exists. It has no geometric meaning, so make
      // the safe canonical value explicit rather than spending another remote
      // repair call or letting a cyclic relationship reach the assembly.
      features = features.map((feature) => feature.parameters.hostComponentKey === component.componentKey
        ? { ...feature, parameters: { ...feature.parameters, hostComponentKey: null } }
        : feature);
    } else if (selfHosted) {
      throw new Error(`graph_repair_required: ${component.componentKey}.hostComponentKey`);
    }
    const featureHostKeys = [...new Set(features.map((feature) => feature.parameters.hostComponentKey).filter(Boolean))];
    if (featureHostKeys.length > 1 || (normalizedComponentHostKey && featureHostKeys.length && normalizedComponentHostKey !== featureHostKeys[0])) throw new Error(`graph_invalid: ${component.componentKey}의 부착 대상 참조가 충돌합니다.`);
    return { ...component, hostComponentKey: normalizedComponentHostKey ?? featureHostKeys[0] ?? null, features };
  });
  const extent = (component) => {
    const ranges = component.features.flatMap((feature) => {
      const profile = feature.parameters.profile;
      if (profile?.length) return [{ min: Math.min(...profile.map((point) => point.zMm)), max: Math.max(...profile.map((point) => point.zMm)) }];
      if (!["primitive", "extrude"].includes(feature.operation)) return [];
      const height = Number(feature.parameters.heightMm ?? feature.parameters.dimensionsMm?.z ?? 0);
      if (!(height > 0)) return [];
      // All component-local generating features share the z=0 datum plane.
      // Do not treat primitive height as centred: the B-Rep compiler exports
      // a 24 mm cap from z=0 to z=24 just like its revolve profile.
      const origin = Number(feature.parameters.transform?.translationMm?.z ?? 0);
      return [{ min: origin, max: origin + height }];
    });
    if (!ranges.length) return null;
    const min = Math.min(...ranges.map((item) => item.min)); const max = Math.max(...ranges.map((item) => item.max));
    return { min, max, span: max - min };
  };
  const baseComponent = [...normalizedComponents].filter((item) => item.representation === "brep_solid").sort((a, b) => (extent(b)?.span ?? 0) - (extent(a)?.span ?? 0))[0];
  const baseRange = extent(baseComponent);
  const unplacedAccessoryRanges = normalizedComponents
    .filter((item) => item !== baseComponent && item.representation === "brep_solid" && Math.abs(Number(item.transform?.translationMm?.z ?? 0)) < 1e-6)
    .map((item) => extent(item))
    .filter(Boolean);
  // A Vision plan may correctly identify independent child B-Reps but omit
  // its mate rows.  Keep local geometry untouched and give every unplaced,
  // concentric child the same provisional datum below the tallest child.
  // This is a reviewable assembly inference from component envelopes—not a
  // label-based cap/ring rule—and prevents all children from being exported
  // at z=0 while the explicit interface contract remains unresolved.
  const inferredAssemblyDatum = baseRange && unplacedAccessoryRanges.length
    ? Math.max(baseRange.min, baseRange.max - Math.max(...unplacedAccessoryRanges.map((range) => range.span)))
    : null;
  const threadHeight = Math.max(0, ...parsed.interfaces.filter((item) => item.kind === "thread" && item.componentKeys.includes(baseComponent?.componentKey)).flatMap((item) => item.componentKeys.filter((key) => key !== baseComponent.componentKey).map((key) => extent(normalizedComponents.find((component) => component.componentKey === key))?.span ?? 0)));
  const placedComponents = normalizedComponents.map((component) => {
    const range = extent(component); const translation = component.transform?.translationMm; const relation = parsed.interfaces.find((item) => item.componentKeys.includes(component.componentKey) && item.componentKeys.includes(baseComponent?.componentKey)); const linkedToBase = Boolean(relation);
    if (!range || component === baseComponent || Math.abs(translation?.z ?? 0) > 1e-6 || range.min > 5 || range.span > (baseRange?.span ?? Infinity) * .5) return component;
    if (!linkedToBase && inferredAssemblyDatum !== null) {
      const z = Math.max(0, inferredAssemblyDatum - range.min);
      return { ...component, transform: { ...component.transform, translationMm: { ...component.transform.translationMm, z } }, summary: `${component.summary} (명시 mate가 없어 최대 자녀 높이의 공통 조립 datum z=${z.toFixed(3)} mm를 제안함; 제조 조립 승인 필요)` };
    }
    if (!linkedToBase) return component;
    const targetTop = relation.kind === "thread" ? parsed.product.heightMm : Math.max(0, parsed.product.heightMm - threadHeight);
    const z = Math.max(0, targetTop - range.max);
    return { ...component, transform: { ...component.transform, translationMm: { ...component.transform.translationMm, z } }, summary: `${component.summary} (${relation.kind} 인터페이스 기준으로 z=${z.toFixed(3)} mm 배치)` };
  });
  const nodeKeyToId = new Map(); for (const component of placedComponents) for (const feature of component.features) { if (nodeKeyToId.has(feature.key)) throw new Error("analysis_incomplete: feature key가 중복되었습니다."); nodeKeyToId.set(feature.key, `node-${randomUUID().slice(0, 12)}`); }
  const components = placedComponents.map((item, index) => { const referenced = new Set(item.features.flatMap((feature) => feature.inputKeys)); const roots = item.features.filter((feature) => !referenced.has(feature.key) && !["surface_decal", "surface_artwork", "volume", "instance_distribution"].includes(feature.operation)); return { id: keyToId.get(item.componentKey), requestedName: requestedNames[index], representation: item.representation, rootNodeIds: (roots.length ? roots : item.features).map((feature) => nodeKeyToId.get(feature.key)), hostComponentId: item.hostComponentKey ? keyToId.get(item.hostComponentKey) ?? null : null, material: item.material, transform: item.transform, summary: item.summary }; });
  const nodes = placedComponents.flatMap((component) => component.features.map((feature) => ({ id: nodeKeyToId.get(feature.key), componentId: keyToId.get(component.componentKey), operation: feature.operation, inputNodeIds: feature.inputKeys.map((key) => nodeKeyToId.get(key)).filter(Boolean), parameters: { ...feature.parameters, hostComponentKey: feature.parameters.hostComponentKey ? keyToId.get(feature.parameters.hostComponentKey) ?? null : null }, rationale: feature.rationale, confidence: feature.confidence })));
  const graph = modelingGraphSchema.parse({ version: "net30.modeling-graph.v2", units: "mm", axis: "z-up", components, nodes, interfaces: parsed.interfaces.map((item) => ({ id: `interface-${randomUUID().slice(0, 10)}`, componentIds: item.componentKeys.map((key) => keyToId.get(key)).filter(Boolean), kind: item.kind, clearanceMm: item.clearanceMm, rationale: item.rationale })), evidence: [{ id: `evidence-${randomUUID().slice(0, 10)}`, kind: imageIds.length ? "image" : "user", label: imageIds.length ? "사용자 모델링 입력 이미지" : "사용자 프롬프트", imageId: imageIds[0] ?? null }] });
  validateGraph(graph); return { product: parsed.product, graph, graphHash: graphHash(graph) };
}

export function validateGraph(graph) {
  const parsed = modelingGraphSchema.parse(normaliseGraphCompatibility(graph)); const components = new Set(parsed.components.map((item) => item.id)); const nodes = new Map(parsed.nodes.map((item) => [item.id, item]));
  for (const component of parsed.components) {
    if (component.hostComponentId === component.id) throw new Error(`graph_invalid: ${component.id}은 자기 자신을 host로 사용할 수 없습니다.`);
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
  const width = 1000, height = 680; const views = [{ id: "front", label: "정면" }, { id: "side", label: "측면" }, { id: "section", label: "단면" }, { id: "isometric", label: "등각" }, { id: "exploded", label: "분해" }];
  const scale = Math.min((width - 180) / Math.max(1, product.widthMm), (height - 120) / Math.max(1, product.heightMm));
  const originX = width / 2; const baseY = height - 46;
  const project = (xMm, zMm) => ({ x: originX + xMm * scale, y: baseY - zMm * scale });
  const components = graph.components.map((component, componentIndex) => {
    const componentNodes = graph.nodes.filter((node) => node.componentId === component.id);
    const transform = component.transform?.translationMm ?? { x: 0, y: 0, z: 0 };
    const profileNode = componentNodes.find((node) => node.parameters.profile?.length);
    const primitiveNode = componentNodes.find((node) => ["primitive", "extrude"].includes(node.operation));
    let worldPoints = [];
    if (profileNode) {
      const nodeTranslation = profileNode.parameters.transform?.translationMm ?? { x: 0, y: 0, z: 0 };
      const side = profileNode.parameters.profile.map((point) => ({ xMm: point.xMm + transform.x + nodeTranslation.x, zMm: point.zMm + transform.z + nodeTranslation.z }));
      worldPoints = [...side, ...[...side].reverse().map((point) => ({ xMm: 2 * transform.x - point.xMm, zMm: point.zMm }))];
    } else if (primitiveNode) {
      const params = primitiveNode.parameters; const nodeTranslation = params.transform?.translationMm ?? { x: 0, y: 0, z: 0 };
      const radius = Number(params.radiusMm ?? params.dimensionsMm?.x / 2 ?? product.widthMm * .25);
      const nodeHeight = Number(params.heightMm ?? params.dimensionsMm?.z ?? product.heightMm * .25);
      const cx = transform.x + nodeTranslation.x; const cz = transform.z + nodeTranslation.z;
      worldPoints = [{ xMm: cx - radius, zMm: cz - nodeHeight / 2 }, { xMm: cx + radius, zMm: cz - nodeHeight / 2 }, { xMm: cx + radius, zMm: cz + nodeHeight / 2 }, { xMm: cx - radius, zMm: cz + nodeHeight / 2 }];
    } else {
      const host = graph.components.find((item) => item.id === component.hostComponentId);
      const hostZ = host?.transform.translationMm.z ?? 0; const artwork = componentNodes.find((node) => ["surface_decal", "surface_artwork"].includes(node.operation));
      const artworkHeight = Number(artwork?.parameters.heightMm ?? product.heightMm * .35); const radius = product.widthMm * .48;
      worldPoints = [{ xMm: -radius, zMm: hostZ + product.heightMm * .25 }, { xMm: radius, zMm: hostZ + product.heightMm * .25 }, { xMm: radius, zMm: hostZ + product.heightMm * .25 + artworkHeight }, { xMm: -radius, zMm: hostZ + product.heightMm * .25 + artworkHeight }];
    }
    const front = worldPoints.map((point) => project(point.xMm, point.zMm));
    // Axisymmetric profiles share front/side geometry.  The alternate views
    // still derive from the same graph coordinates (rather than a decorative
    // AI image), and make the assembly transform/part relationship visible.
    const side = worldPoints.map((point) => project(-point.xMm, point.zMm));
    const section = worldPoints.map((point) => project(point.xMm * .72, point.zMm));
    const isometric = worldPoints.map((point) => ({ x: originX + (point.xMm + point.zMm * .28) * scale, y: baseY - point.zMm * scale * .82 }));
    const explodedOffset = (componentIndex - (graph.components.length - 1) / 2) * Math.max(35, product.widthMm * .85);
    const exploded = worldPoints.map((point) => project(point.xMm + explodedOffset, point.zMm));
    return { id: component.id, label: component.requestedName, representation: component.representation, nodeIds: componentNodes.map((node) => node.id), points: front, views: { front, side, section, isometric, exploded }, color: component.material.baseColor, note: component.summary };
  });
  return { version: "net30.graph-sketch.v3", graphHash: graphHash(graph), width, height, title: `${product.name} 조립 좌표 실형상 그래프 검토`, views, components, annotations: [{ label: "승인 대상 ModelingGraph의 동일 조립 좌표·재질·노드 경계를 투영한 검토 보기입니다.", x: 36, y: 42 }] };
}
