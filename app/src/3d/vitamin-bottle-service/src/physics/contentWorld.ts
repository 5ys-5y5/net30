import {
  CapsuleGeometry,
  Color,
  DynamicDrawUsage,
  Euler,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  MeshPhysicalMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three";
import type { VitaminVariantConfig } from "../api/contracts";

const STEP = 1 / 60;
const CENTER_Y = 0.056;
const INNER_RADIUS = 0.0256;
const BOTTOM_Y = 0.0045 - CENTER_Y;
const TOP_Y = 0.0900 - CENTER_Y;

type Seed = {
  readonly variantIndex: number;
  readonly variant: VitaminVariantConfig;
  readonly position: Vector3;
  readonly rotation: Quaternion;
  readonly color: Color;
};

type Batch = {
  readonly variant: VitaminVariantConfig;
  readonly mesh: InstancedMesh;
  readonly bodyIndices: readonly number[];
};

function mulberry32(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSeeds(variants: readonly VitaminVariantConfig[]): Seed[] {
  const random = mulberry32(0x4e455433);
  const queue: Array<{ variant: VitaminVariantConfig; variantIndex: number }> = [];
  variants.forEach((variant, variantIndex) => {
    for (let i = 0; i < variant.count; i += 1) queue.push({ variant, variantIndex });
  });
  for (let i = queue.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  const maxRadius = Math.max(...variants.map((entry) => entry.radius));
  const spacing = Math.max(0.0078, maxRadius * 1.78);
  const rowSpacing = spacing * 0.866;
  const layerSpacing = Math.max(0.0042, Math.max(...variants.map((entry) => entry.halfHeight * 1.85)));
  const usable = INNER_RADIUS - maxRadius * 1.05;
  const cells: Vector3[] = [];
  let layer = 0;
  for (let y = BOTTOM_Y + 0.004; y < TOP_Y - 0.004 && cells.length < queue.length; y += layerSpacing) {
    let row = 0;
    for (let z = -usable; z <= usable && cells.length < queue.length; z += rowSpacing) {
      const xOffset = (row + layer) % 2 ? spacing * 0.5 : 0;
      for (let x = -usable; x <= usable && cells.length < queue.length; x += spacing) {
        const px = x + xOffset;
        if (Math.hypot(px, z) > usable) continue;
        cells.push(new Vector3(
          px + (random() - 0.5) * 0.0005,
          y + (random() - 0.5) * 0.0003,
          z + (random() - 0.5) * 0.0005,
        ));
      }
      row += 1;
    }
    layer += 1;
  }
  if (cells.length < queue.length) {
    throw new Error(`병 내부 배치 공간 부족: ${queue.length}개 중 ${cells.length}개만 배치 가능`);
  }
  return queue.map(({ variant, variantIndex }, index) => ({
    variant,
    variantIndex,
    position: cells[index],
    rotation: new Quaternion().setFromEuler(new Euler(
      random() * Math.PI,
      random() * Math.PI * 2,
      random() * Math.PI,
    )),
    color: new Color(variant.colors[index % variant.colors.length]),
  }));
}

function geometryFor(variant: VitaminVariantConfig) {
  if (variant.shape === "round-tablet") {
    const profile = [
      new Vector2(0, -variant.halfHeight),
      new Vector2(variant.radius * 0.72, -variant.halfHeight * 0.92),
      new Vector2(variant.radius, -variant.halfHeight * 0.35),
      new Vector2(variant.radius, variant.halfHeight * 0.35),
      new Vector2(variant.radius * 0.72, variant.halfHeight * 0.92),
      new Vector2(0, variant.halfHeight),
    ];
    return new LatheGeometry(profile, 32);
  }
  if (variant.shape === "softgel") {
    const geometry = new SphereGeometry(1, 24, 16);
    geometry.scale(variant.radius, variant.halfHeight + variant.radius, variant.radius);
    return geometry;
  }
  return new CapsuleGeometry(variant.radius, variant.halfHeight * 2, 8, 18);
}

function materialFor(variant: VitaminVariantConfig) {
  return new MeshPhysicalMaterial({
    color: "#ffffff",
    vertexColors: true,
    metalness: 0,
    roughness: variant.shape === "softgel" ? 0.15 : 0.38,
    clearcoat: variant.shape === "softgel" ? 0.75 : 0.2,
    clearcoatRoughness: variant.shape === "softgel" ? 0.12 : 0.34,
    transmission: variant.shape === "softgel" ? 0.16 : 0,
    thickness: variant.shape === "softgel" ? 0.002 : 0,
  });
}

function createColliderMesh(segments = 64) {
  // Closed concave surface of the bottle cavity, centered to match the render model.
  const profile = [
    [0.0208, 0.0045],
    [0.0238, 0.0054],
    [0.0257, 0.0072],
    [0.0260, 0.0100],
    [0.0260, 0.0250],
    [0.0260, 0.0420],
    [0.0257, 0.0540],
    [0.0244, 0.0600],
    [0.0217, 0.0660],
    [0.0185, 0.0705],
    [0.0154, 0.0745],
    [0.0134, 0.0780],
    [0.0130, 0.0800],
    [0.0130, 0.0900],
  ] as const;
  const vertices: number[] = [];
  for (const [radius, absoluteY] of profile) {
    const y = absoluteY - CENTER_Y;
    for (let i = 0; i < segments; i += 1) {
      const angle = i / segments * Math.PI * 2;
      vertices.push(radius * Math.cos(angle), y, radius * Math.sin(angle));
    }
  }
  const indices: number[] = [];
  for (let row = 0; row < profile.length - 1; row += 1) {
    for (let i = 0; i < segments; i += 1) {
      const next = (i + 1) % segments;
      const a = row * segments + i;
      const b = row * segments + next;
      const c = (row + 1) * segments + i;
      const d = (row + 1) * segments + next;
      indices.push(a, b, c, b, d, c);
    }
  }
  // Bottom and cap closure are supplied as cylinders for robust collision.
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}

export class ContentWorld {
  readonly meshes: readonly InstancedMesh[];
  private readonly world: any;
  private readonly bottleBody: any;
  private readonly bodies: readonly any[];
  private readonly batches: readonly Batch[];
  private accumulator = 0;
  private previousYaw = 0;
  private disposed = false;

  private constructor(world: any, bottleBody: any, bodies: readonly any[], batches: readonly Batch[]) {
    this.world = world;
    this.bottleBody = bottleBody;
    this.bodies = bodies;
    this.batches = batches;
    this.meshes = batches.map((entry) => entry.mesh);
  }

  static async create(variants: readonly VitaminVariantConfig[], maxAnisotropy: number) {
    if (variants.length === 0) throw new Error("비타민 구성은 하나 이상이어야 합니다.");
    const RAPIER = (await import("@dimforge/rapier3d-compat")).default;
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = STEP;
    const bottleBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0, 0),
    );
    const cavity = createColliderMesh();
    world.createCollider(
      RAPIER.ColliderDesc.trimesh(cavity.vertices, cavity.indices)
        .setFriction(0.84)
        .setRestitution(0.015),
      bottleBody,
    );
    world.createCollider(
      RAPIER.ColliderDesc.cylinder(0.0032, 0.0207)
        .setTranslation(0, BOTTOM_Y - 0.001, 0)
        .setFriction(0.9)
        .setRestitution(0.01),
      bottleBody,
    );
    world.createCollider(
      RAPIER.ColliderDesc.cylinder(0.0024, 0.0129)
        .setTranslation(0, TOP_Y + 0.001, 0)
        .setFriction(0.78)
        .setRestitution(0.01),
      bottleBody,
    );

    const seeds = makeSeeds(variants);
    const bodies: any[] = [];
    const batchData = variants.map((variant, variantIndex) => {
      const indices = seeds.map((seed, index) => seed.variantIndex === variantIndex ? index : -1).filter((index) => index >= 0);
      const mesh = new InstancedMesh(geometryFor(variant), materialFor(variant), indices.length);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.name = `VitaminBatch:${variant.id}`;
      return { variant, mesh, bodyIndices: indices } satisfies Batch;
    });

    const indexWithinBatch = new Map<number, number>();
    batchData.forEach((batch) => batch.bodyIndices.forEach((seedIndex, localIndex) => indexWithinBatch.set(seedIndex, localIndex)));
    seeds.forEach((seed, index) => {
      const desc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(seed.position.x, seed.position.y, seed.position.z)
        .setRotation({ x: seed.rotation.x, y: seed.rotation.y, z: seed.rotation.z, w: seed.rotation.w })
        .setLinearDamping(0.32)
        .setAngularDamping(0.44)
        .setCanSleep(true)
        .setCcdEnabled(true)
        .setAdditionalSolverIterations(4);
      const body = world.createRigidBody(desc);
      const collider = seed.variant.shape === "round-tablet"
        ? RAPIER.ColliderDesc.roundCylinder(seed.variant.halfHeight * 0.72, seed.variant.radius * 0.86, 0.00025)
        : RAPIER.ColliderDesc.capsule(seed.variant.halfHeight * 0.65, seed.variant.radius * 0.84);
      world.createCollider(
        collider
          .setMass(seed.variant.mass)
          .setFriction(seed.variant.friction)
          .setRestitution(seed.variant.restitution)
          .setContactSkin(0.00006),
        body,
      );
      bodies.push(body);
      const batch = batchData[seed.variantIndex];
      const localIndex = indexWithinBatch.get(index)!;
      batch.mesh.setColorAt(localIndex, seed.color);
    });
    batchData.forEach((batch) => {
      if (batch.mesh.instanceColor) batch.mesh.instanceColor.needsUpdate = true;
    });

    for (let i = 0; i < 150; i += 1) world.step();
    const result = new ContentWorld(world, bottleBody, bodies, batchData);
    result.sync();
    return result;
  }

  step(delta: number, yaw: number) {
    if (this.disposed) return;
    this.accumulator += Math.min(0.05, Math.max(0, delta));
    if (Math.abs(yaw - this.previousYaw) > 0.00025) this.bodies.forEach((body) => body.wakeUp());
    while (this.accumulator >= STEP) {
      const half = yaw * 0.5;
      this.bottleBody.setNextKinematicRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) });
      this.world.step();
      this.accumulator -= STEP;
    }
    this.previousYaw = yaw;
    this.sync();
  }

  private sync() {
    const helper = new Object3D();
    for (const batch of this.batches) {
      batch.bodyIndices.forEach((bodyIndex, localIndex) => {
        const body = this.bodies[bodyIndex];
        const t = body.translation();
        const r = body.rotation();
        helper.position.set(t.x, t.y, t.z);
        helper.quaternion.set(r.x, r.y, r.z, r.w);
        helper.scale.set(1, 1, 1);
        helper.updateMatrix();
        batch.mesh.setMatrixAt(localIndex, helper.matrix);
      });
      batch.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  isActive() {
    return this.bodies.some((body) => !body.isSleeping());
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.batches.forEach((batch) => {
      batch.mesh.geometry.dispose();
      const materials = Array.isArray(batch.mesh.material) ? batch.mesh.material : [batch.mesh.material];
      materials.forEach((entry) => entry.dispose());
    });
    if (typeof this.world.free === "function") this.world.free();
  }
}
