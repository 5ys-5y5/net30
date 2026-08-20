import { Box3, Color, DoubleSide, Group, Material, Mesh, MeshStandardMaterial, Object3D, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export type LoadedBottle = {
  readonly group: Group;
  readonly bounds: Box3;
  readonly stickerSlots: Readonly<Record<string, Mesh>>;
  setCapColor: (color: string) => void;
  dispose: () => void;
};

function isMesh(node: Object3D): node is Mesh {
  return (node as Mesh).isMesh === true;
}

function normaliseMaterial(material: Material, meshName: string) {
  // Blender and CAD exporters do not always agree on winding direction. A
  // product asset must remain visible even when an upstream GLB has inverted
  // normals. The compatible material keeps the exported colour and core PBR
  // values, while discarding exporter-only renderer state.
  const source = material as Material & {
    color?: Color;
    roughness?: number; metalness?: number;
    opacity?: number; transparent?: boolean; alphaTest?: number;
  };
  const isGlass = /glass|bottle/i.test(meshName);
  const isCap = /cap|closure/i.test(meshName);
  const sourceColor = source.color && typeof source.color.getHex === "function" ? source.color.getHex() : 0xffffff;
  const isGenericWhite = sourceColor === 0xffffff;
  // Some exporters write a generic white material for every part. Only then
  // add semantic fallback colour; authored non-white materials are preserved.
  const color = isGenericWhite && isGlass ? 0xc7deeb : isGenericWhite && isCap ? 0x083da9 : sourceColor;
  const viewerMaterial = new MeshStandardMaterial({
    color,
    roughness: isGenericWhite ? (isGlass ? 0.2 : 0.48) : (source.roughness ?? (isGlass ? 0.2 : 0.48)),
    metalness: isGenericWhite ? 0 : (source.metalness ?? 0),
    opacity: source.opacity ?? 1,
    transparent: source.transparent ?? false,
    alphaTest: source.alphaTest ?? 0,
  });
  viewerMaterial.name = material.name;
  viewerMaterial.side = DoubleSide;
  viewerMaterial.needsUpdate = true;
  return viewerMaterial;
}

const bundledShowcaseUrl = `${import.meta.env.BASE_URL}models/showcase-vial.glb`;

export async function loadBottle(
  url = bundledShowcaseUrl,
): Promise<LoadedBottle> {
  const loader = new GLTFLoader();
  let sourceRoot: Group;
  try {
    sourceRoot = (await loader.loadAsync(url)).scene;
  } catch (error) {
    // The independent service also runs directly during local development,
    // where the host API proxy is intentionally unavailable. A missing chosen
    // showcase must not turn the entire 3D surface into an error screen.
    if (url === bundledShowcaseUrl) throw error;
    sourceRoot = (await loader.loadAsync(bundledShowcaseUrl)).scene;
  }
  sourceRoot.name = "NET30IndependentBottle";

  const sourceBounds = new Box3().setFromObject(sourceRoot);
  const sourceCenter = sourceBounds.getCenter(new Vector3());
  sourceRoot.position.sub(sourceCenter);
  sourceRoot.updateMatrixWorld(true);

  // Flatten an imported hierarchy into viewer-owned meshes. Some Blender/CAD
  // GLBs retain exporter-specific mesh state that loads without error but is
  // silently skipped by WebGL. Re-instancing the same geometry, transforms,
  // and compatible PBR materials removes that state without replacing the asset.
  const root = new Group();
  const stickerSlots: Record<string, Mesh> = {};
  root.name = sourceRoot.name;
  root.position.copy(sourceRoot.position);

  sourceRoot.traverse((node) => {
    if (!isMesh(node)) return;
    node.geometry.computeVertexNormals();
    node.geometry.computeBoundingBox();
    node.geometry.computeBoundingSphere();
    const material = Array.isArray(node.material)
      ? node.material.map((item) => normaliseMaterial(item, node.name))
      : normaliseMaterial(node.material, node.name);
    const displayMesh = new Mesh(node.geometry, material);
    displayMesh.name = node.name;
    displayMesh.position.copy(node.position);
    displayMesh.quaternion.copy(node.quaternion);
    displayMesh.scale.copy(node.scale);
    displayMesh.frustumCulled = false;
    displayMesh.castShadow = true;
    displayMesh.receiveShadow = true;
    const slot = node.userData?.net30_sticker_slot as { sourceGraphicId?: unknown } | undefined;
    if (typeof slot?.sourceGraphicId === "string") {
      stickerSlots[slot.sourceGraphicId] = displayMesh;
      return;
    }
    root.add(displayMesh);
  });

  const bounds = new Box3().setFromObject(root);

  return {
    group: root,
    bounds,
    stickerSlots,
    setCapColor(color: string) {
      root.traverse((node) => {
        if (!isMesh(node) || !/cap|closure/i.test(node.name)) return;
        const material = Array.isArray(node.material) ? node.material[0] : node.material;
        const editable = material as Material & { color?: Color };
        if (editable.color) editable.color.set(color);
      });
    },
    dispose() {
      root.traverse((node) => {
        if (!isMesh(node)) return;
        node.geometry.dispose();
        (Array.isArray(node.material) ? node.material : [node.material]).forEach((material) => material.dispose());
      });
    },
  };
}
