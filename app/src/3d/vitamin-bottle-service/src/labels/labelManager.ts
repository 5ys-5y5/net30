import {
  ClampToEdgeWrapping,
  CylinderGeometry,
  FrontSide,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshPhysicalMaterial,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from "three";
import type { LabelSurface } from "../api/contracts";

const LABEL_RADIUS = 0.02815;
const LABEL_ARC = 102 * Math.PI / 180;
const LABEL_CENTER_Y = -0.001;
const MIN_HEIGHT = 0.020;
const MAX_HEIGHT = 0.050;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function geometry(surface: LabelSurface, side: "front" | "back") {
  const aspect = surface.pixelWidth / surface.pixelHeight;
  const arcWidth = LABEL_RADIUS * LABEL_ARC;
  const height = clamp(arcWidth / Math.max(0.25, aspect), MIN_HEIGHT, MAX_HEIGHT);
  const start = side === "front" ? -LABEL_ARC / 2 : Math.PI - LABEL_ARC / 2;
  return new CylinderGeometry(LABEL_RADIUS, LABEL_RADIUS, height, 128, 1, true, start, LABEL_ARC);
}

function material(texture: Texture) {
  return new MeshPhysicalMaterial({
    map: texture,
    color: "#ffffff",
    metalness: 0,
    roughness: 0.84,
    clearcoat: 0.02,
    clearcoatRoughness: 0.76,
    envMapIntensity: 0.28,
    side: FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

function prepare(texture: Texture, anisotropy: number) {
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = Math.min(8, anisotropy);
  texture.needsUpdate = true;
  return texture;
}

export class LabelManager {
  readonly group = new Group();
  private front: Mesh | null = null;
  private back: Mesh | null = null;
  private sequence = 0;

  constructor(private readonly maxAnisotropy: number) {
    this.group.name = "NET30IndependentLabels";
  }

  async apply(frontSurface: LabelSurface, backSurface: LabelSurface) {
    if (frontSurface.sourceLabel !== "한글표시사항") {
      throw new Error("전면 라벨은 실제 한글표시사항 UI 캡처여야 합니다.");
    }
    if (backSurface.sourceLabel !== "전체 가격 구조") {
      throw new Error("후면 라벨은 실제 전체 가격 구조 UI 캡처여야 합니다.");
    }
    const sequence = ++this.sequence;
    const loader = new TextureLoader();
    const [frontTexture, backTexture] = await Promise.all([
      loader.loadAsync(frontSurface.dataUrl),
      loader.loadAsync(backSurface.dataUrl),
    ]);
    if (sequence !== this.sequence) {
      frontTexture.dispose();
      backTexture.dispose();
      return;
    }
    this.clear();
    prepare(frontTexture, this.maxAnisotropy);
    prepare(backTexture, this.maxAnisotropy);
    this.front = new Mesh(geometry(frontSurface, "front"), material(frontTexture));
    this.back = new Mesh(geometry(backSurface, "back"), material(backTexture));
    this.front.name = "LabelFront";
    this.back.name = "LabelBack";
    for (const mesh of [this.front, this.back]) {
      mesh.position.y = LABEL_CENTER_Y;
      mesh.renderOrder = 8;
      mesh.receiveShadow = true;
    }
    this.group.add(this.front, this.back);
  }

  clear() {
    for (const mesh of [this.front, this.back]) {
      if (!mesh) continue;
      this.group.remove(mesh);
      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((entry) => {
        if (entry instanceof MeshPhysicalMaterial) entry.map?.dispose();
        entry.dispose();
      });
    }
    this.front = null;
    this.back = null;
  }

  dispose() {
    this.clear();
  }
}
