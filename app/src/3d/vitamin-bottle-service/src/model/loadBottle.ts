import { Box3, Color, Group, Mesh, Object3D, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export type LoadedBottle = {
  readonly group: Group;
  readonly bounds: Box3;
  setCapColor: (color: string) => void;
  dispose: () => void;
};

function isMesh(node: Object3D): node is Mesh {
  return (node as Mesh).isMesh === true;
}

export async function loadBottle(
  url = `${import.meta.env.BASE_URL}models/showcase-vial.glb`,
): Promise<LoadedBottle> {
  const root = (await new GLTFLoader().loadAsync(url)).scene;
  root.name = "NET30IndependentBottle";

  root.traverse((node) => {
    if (!isMesh(node)) return;
    node.geometry.computeVertexNormals();
    node.geometry.computeBoundingBox();
    node.geometry.computeBoundingSphere();
    // The scene is re-centred after load. Keep externally-authored GLB parts
    // out of per-mesh frustum culling so the bottle cannot disappear while the
    // camera is fitted to its aggregate bounds.
    node.frustumCulled = false;
    node.castShadow = true;
    node.receiveShadow = true;
  });

  const bounds = new Box3().setFromObject(root);
  const center = bounds.getCenter(new Vector3());
  root.position.sub(center);
  root.updateMatrixWorld(true);
  bounds.setFromObject(root);

  return {
    group: root,
    bounds,
    setCapColor(color: string) {
      root.traverse((node) => {
        if (!isMesh(node) || !/cap|closure/i.test(node.name)) return;
        const material = Array.isArray(node.material) ? node.material[0] : node.material;
        if ("color" in material && material.color instanceof Color) material.color.set(color);
      });
    },
    dispose() {
      root.traverse((node) => {
        if (isMesh(node)) node.geometry.dispose();
      });
    },
  };
}
