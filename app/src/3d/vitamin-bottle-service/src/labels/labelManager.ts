import {
  ClampToEdgeWrapping,
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

  async apply(frontSurface: LabelSurface, backSurface: LabelSurface, slots: Readonly<Record<string, Mesh>>) {
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
    const frontSlot = slots["korean-product-information"];
    const backSlot = slots["full-price-structure"];
    if (!frontSlot || !backSlot) throw new Error("이 GLB에는 승인된 HTML 스티커 슬롯이 없습니다. 하드코딩된 원통 라벨을 덧씌우지 않았습니다.");
    this.clear();
    prepare(frontTexture, this.maxAnisotropy);
    prepare(backTexture, this.maxAnisotropy);
    this.front = new Mesh(frontSlot.geometry.clone(), material(frontTexture));
    this.back = new Mesh(backSlot.geometry.clone(), material(backTexture));
    this.front.name = "LabelFront";
    this.back.name = "LabelBack";
    for (const [mesh, slot] of [[this.front, frontSlot], [this.back, backSlot]] as const) {
      mesh.position.copy(slot.position); mesh.quaternion.copy(slot.quaternion); mesh.scale.copy(slot.scale);
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
