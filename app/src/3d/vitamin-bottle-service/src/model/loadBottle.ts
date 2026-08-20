import {
  Box3,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  Object3D,
  Vector3,
} from "three";
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

export async function loadBottle(url = "/models/reference-vial.glb"): Promise<LoadedBottle> {
  const root = (await new GLTFLoader().loadAsync(url)).scene;
  root.name = "NET30IndependentBottle";

  const glass = new MeshPhysicalMaterial({
    name: "Borosilicate Glass 3.3",
    color: new Color("#f9fcff"),
    metalness: 0,
    roughness: 0.018,
    transmission: 1,
    thickness: 0.0032,
    ior: 1.52,
    attenuationColor: new Color("#f0f7ff"),
    attenuationDistance: 0.85,
    dispersion: 0.003,
    specularIntensity: 1,
    specularColor: new Color("#ffffff"),
    envMapIntensity: 1.2,
    clearcoat: 0.08,
    clearcoatRoughness: 0.12,
    side: DoubleSide,
    transparent: false,
    opacity: 1,
    depthWrite: true,
  });

  const cap = new MeshPhysicalMaterial({
    name: "Opaque Blue Polypropylene",
    color: new Color("#083da9"),
    metalness: 0,
    roughness: 0.46,
    clearcoat: 0.12,
    clearcoatRoughness: 0.38,
    envMapIntensity: 0.86,
    transparent: false,
    opacity: 1,
  });

  const threadGlass = glass.clone();
  threadGlass.name = "Thread Glass";
  threadGlass.thickness = 0.0012;
  threadGlass.envMapIntensity = 1.05;

  root.traverse((node) => {
    if (!isMesh(node)) return;
    node.geometry.computeVertexNormals();
    node.geometry.computeBoundingBox();
    node.geometry.computeBoundingSphere();
    if (node.name === "CapBluePP" || node.name === "CapTamperRing") {
      node.material = cap;
      node.castShadow = true;
      node.receiveShadow = true;
      node.renderOrder = 5;
    } else if (node.name.startsWith("Thread")) {
      node.material = threadGlass;
      node.castShadow = false;
      node.receiveShadow = true;
      node.renderOrder = 4;
    } else {
      node.material = glass;
      node.castShadow = false;
      node.receiveShadow = true;
      node.renderOrder = 3;
    }
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
      cap.color.set(color);
      cap.needsUpdate = true;
    },
    dispose() {
      root.traverse((node) => {
        if (isMesh(node)) node.geometry.dispose();
      });
      glass.dispose();
      threadGlass.dispose();
      cap.dispose();
    },
  };
}
