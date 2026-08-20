import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  PCFSoftShadowMap,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { LabelSurface, ProductConfig } from "../api/contracts";
import { LabelManager } from "../labels/labelManager";
import { loadBottle, type LoadedBottle } from "../model/loadBottle";
import { DEFAULT_CONTENTS } from "../model/presets";
import { ContentWorld } from "../physics/contentWorld";

export type BottleViewerOptions = {
  readonly onStatus?: (message: string) => void;
  readonly fit?: { readonly zoom?: number; readonly offsetY?: number; readonly scaleX?: number; readonly scaleY?: number };
};

type ControlState = {
  yaw: number;
  targetYaw: number;
  velocity: number;
  zoom: number;
  targetZoom: number;
  dragging: boolean;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export class BottleViewer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: OrthographicCamera;
  readonly modelRoot = new Group();
  readonly labelManager: LabelManager;
  private readonly onStatus: (message: string) => void;
  private readonly fit: NonNullable<BottleViewerOptions["fit"]>;
  private readonly controls: ControlState;
  private readonly resizeObserver: ResizeObserver;
  private bottle: LoadedBottle | null = null;
  private contents: ContentWorld | null = null;
  private presentationShell: Group | null = null;
  private presentationCap: Mesh | null = null;
  private environment: WebGLRenderTarget | null = null;
  private frame = 0;
  private lastTime = performance.now();
  private disposed = false;
  private renderRequested = true;
  private pointerId: number | null = null;
  private pointerX = 0;
  private lastPointerTime = 0;

  constructor(readonly canvas: HTMLCanvasElement, options: BottleViewerOptions) {
    this.fit = options.fit ?? {};
    this.onStatus = options.onStatus ?? (() => undefined);
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
      // Rendering is demand-driven, so retain the finished frame after the
      // browser has composited it instead of clearing static previews.
      preserveDrawingBuffer: true,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.setClearColor(0xffffff, 1);
    this.renderer.transmissionResolutionScale = 0.78;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));

    const aspect = Math.max(1, canvas.clientWidth) / Math.max(1, canvas.clientHeight);
    const halfHeight = 0.132 / 2;
    this.camera = new OrthographicCamera(-halfHeight * aspect, halfHeight * aspect, halfHeight, -halfHeight, 0.01, 2);
    this.camera.position.set(0, 0, 0.34);
    this.camera.lookAt(0, 0, 0);
    this.camera.zoom = this.fit.zoom ?? 0.84;
    this.camera.updateProjectionMatrix();

    this.controls = {
      yaw: 0,
      targetYaw: 0,
      velocity: 0,
      zoom: this.camera.zoom,
      targetZoom: this.camera.zoom,
      dragging: false,
    };

    this.scene.background = new Color(0xffffff);
    this.scene.add(this.modelRoot);
    this.labelManager = new LabelManager(this.renderer.capabilities.getMaxAnisotropy());
    this.modelRoot.add(this.labelManager.group);
    this.createStudio();
    this.attachControls();
    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
      this.requestRender();
    });
    this.resizeObserver.observe(canvas);
  }

  private createStudio() {
    const pmrem = new PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.environment.texture;
    room.dispose();
    pmrem.dispose();

    const key = new DirectionalLight(0xffffff, 2.75);
    key.position.set(-0.18, 0.24, 0.26);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -0.1;
    key.shadow.camera.right = 0.1;
    key.shadow.camera.top = 0.13;
    key.shadow.camera.bottom = -0.13;
    key.shadow.camera.near = 0.05;
    key.shadow.camera.far = 0.8;
    key.shadow.bias = -0.00008;
    this.scene.add(key);

    const fill = new DirectionalLight(0xddeaff, 0.95);
    fill.position.set(0.22, 0.1, 0.18);
    this.scene.add(fill, new AmbientLight(0xffffff, 0.48));

    const floor = new Mesh(
      new PlaneGeometry(0.42, 0.42),
      new MeshStandardMaterial({ color: 0xffffff, roughness: 0.97, metalness: 0 }),
    );
    floor.name = "StudioFloor";
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.058;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  async initialize(config: ProductConfig) {
    this.onStatus("고품질 GLB 병 모델 로딩");
    // The independent service owns this URL through its Vite base (/3d/).
    this.bottle = await loadBottle();
    if (this.disposed) {
      this.bottle.dispose();
      return;
    }
    const scaleX = this.fit.scaleX ?? 1;
    const scaleY = this.fit.scaleY ?? 1;
    this.bottle.group.scale.set(scaleX, scaleY, scaleX);
    this.bottle.group.position.y += this.fit.offsetY ?? 0;
    this.bottle.group.updateMatrixWorld(true);
    this.modelRoot.add(this.bottle.group);
    this.bottle.setCapColor(config.capColor ?? "#083da9");
    this.fitCamera(this.bottle.bounds);
    this.installPresentationShell(this.bottle.bounds, config.capColor ?? "#083da9");
    this.onStatus("비타민 중력 엔진 초기화");
    this.contents = await ContentWorld.create(config.contents ?? DEFAULT_CONTENTS, this.renderer.capabilities.getMaxAnisotropy());
    this.contents.meshes.forEach((mesh) => this.scene.add(mesh));
    this.onStatus("PBR·라벨 API·물리 준비 완료");
    this.resize();
    this.requestRender();
    void this.renderer.compileAsync(this.scene, this.camera).catch(() => undefined);
  }

  private fitCamera(bounds: Box3) {
    const size = bounds.getSize(new Vector3());
    const fitHeight = size.y / 0.132;
    const desiredPixelFraction = 0.82;
    const computed = desiredPixelFraction / fitHeight;
    this.controls.zoom = clamp(this.fit.zoom ?? computed, 0.3, 2.4);
    this.controls.targetZoom = this.controls.zoom;
    this.camera.zoom = this.controls.zoom;
    this.camera.updateProjectionMatrix();
  }

  private installPresentationShell(bounds: Box3, capColor: string) {
    this.presentationShell?.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      node.geometry.dispose();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((material) => material.dispose());
    });
    if (this.presentationShell) this.scene.remove(this.presentationShell);

    const size = bounds.getSize(new Vector3());
    const radius = Math.max(size.x, size.z) / 2;
    const bodyHeight = size.y * 0.76;
    const capHeight = size.y * 0.24;
    const body = new Mesh(
      new CylinderGeometry(radius, radius * 0.97, bodyHeight, 64, 1, true),
      new MeshBasicMaterial({
        color: "#5b9dd3", transparent: true, opacity: 0.62, side: DoubleSide, depthWrite: false,
      }),
    );
    const cap = new Mesh(
      new CylinderGeometry(radius * 0.93, radius * 0.95, capHeight, 64),
      new MeshBasicMaterial({ color: capColor }),
    );
    const shell = new Group();
    shell.name = "NET30RuntimeBottleShell";
    body.name = "NET30RuntimeGlassShell";
    cap.name = "NET30RuntimeCap";
    body.position.y = bounds.min.y + bodyHeight / 2;
    cap.position.y = bounds.max.y - capHeight / 2;
    body.renderOrder = 2;
    cap.renderOrder = 7;
    shell.add(body, cap);
    this.presentationShell = shell;
    this.presentationCap = cap;
    this.scene.add(shell);
  }

  async configure(config: ProductConfig) {
    this.bottle?.setCapColor(config.capColor ?? "#083da9");
    if (this.presentationCap?.material instanceof MeshBasicMaterial) {
      this.presentationCap.material.color.set(config.capColor ?? "#083da9");
    }
    this.contents?.meshes.forEach((mesh) => this.scene.remove(mesh));
    this.contents?.dispose();
    this.contents = await ContentWorld.create(config.contents ?? DEFAULT_CONTENTS, this.renderer.capabilities.getMaxAnisotropy());
    this.contents.meshes.forEach((mesh) => this.scene.add(mesh));
    this.requestRender();
  }

  async applyLabels(front: LabelSurface, back: LabelSurface) {
    await this.labelManager.apply(front, back);
    this.requestRender();
  }

  setView(payload: { yaw?: number; zoom?: number; reset?: boolean }) {
    if (payload.reset) {
      this.controls.targetYaw = 0;
      this.controls.velocity = 0;
      this.controls.targetZoom = 0.84;
    }
    if (typeof payload.yaw === "number" && Number.isFinite(payload.yaw)) {
      this.controls.targetYaw = payload.yaw;
    }
    if (typeof payload.zoom === "number" && Number.isFinite(payload.zoom)) {
      this.controls.targetZoom = clamp(payload.zoom, 0.35, 3);
    }
    this.requestRender();
  }

  private attachControls() {
    const onPointerDown = (event: PointerEvent) => {
      this.pointerId = event.pointerId;
      this.pointerX = event.clientX;
      this.lastPointerTime = performance.now();
      this.controls.dragging = true;
      this.canvas.setPointerCapture(event.pointerId);
      this.requestRender();
    };
    const onPointerMove = (event: PointerEvent) => {
      if (this.pointerId !== event.pointerId) return;
      const now = performance.now();
      const dx = event.clientX - this.pointerX;
      const dt = Math.max(8, now - this.lastPointerTime) / 1000;
      this.pointerX = event.clientX;
      this.lastPointerTime = now;
      this.controls.targetYaw -= dx * 0.008;
      this.controls.velocity = -dx * 0.008 / dt;
      this.requestRender();
    };
    const finishPointer = (event: PointerEvent) => {
      if (this.pointerId !== event.pointerId) return;
      this.pointerId = null;
      this.controls.dragging = false;
      try { this.canvas.releasePointerCapture(event.pointerId); } catch { /* no-op */ }
      this.requestRender();
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      this.controls.targetZoom = clamp(
        this.controls.targetZoom * Math.exp(-event.deltaY * 0.001),
        0.35,
        3,
      );
      this.requestRender();
    };
    const onDoubleClick = () => this.setView({ reset: true });
    this.canvas.addEventListener("pointerdown", onPointerDown);
    this.canvas.addEventListener("pointermove", onPointerMove);
    this.canvas.addEventListener("pointerup", finishPointer);
    this.canvas.addEventListener("pointercancel", finishPointer);
    this.canvas.addEventListener("wheel", onWheel, { passive: false });
    this.canvas.addEventListener("dblclick", onDoubleClick);
    (this as unknown as { detachControls: () => void }).detachControls = () => {
      this.canvas.removeEventListener("pointerdown", onPointerDown);
      this.canvas.removeEventListener("pointermove", onPointerMove);
      this.canvas.removeEventListener("pointerup", finishPointer);
      this.canvas.removeEventListener("pointercancel", finishPointer);
      this.canvas.removeEventListener("wheel", onWheel);
      this.canvas.removeEventListener("dblclick", onDoubleClick);
    };
  }

  private detachControls() { /* assigned in attachControls */ }

  requestRender() {
    if (this.disposed) return;
    this.renderRequested = true;
    if (!this.frame) {
      this.lastTime = performance.now();
      this.frame = requestAnimationFrame(this.tick);
    }
  }

  private tick = (time: number) => {
    this.frame = 0;
    if (this.disposed) return;
    const delta = Math.min(0.05, Math.max(0.001, (time - this.lastTime) / 1000));
    this.lastTime = time;

    if (!this.controls.dragging) {
      this.controls.targetYaw += this.controls.velocity * delta;
      this.controls.velocity *= Math.exp(-7.5 * delta);
      if (Math.abs(this.controls.velocity) < 0.002) this.controls.velocity = 0;
    }
    const yawDiff = this.controls.targetYaw - this.controls.yaw;
    this.controls.yaw += yawDiff * Math.min(1, 18 * delta);
    const zoomDiff = this.controls.targetZoom - this.controls.zoom;
    this.controls.zoom += zoomDiff * Math.min(1, 16 * delta);
    this.modelRoot.rotation.y = this.controls.yaw;
    if (this.presentationShell) this.presentationShell.rotation.y = this.controls.yaw;
    this.camera.zoom = this.controls.zoom;
    this.camera.updateProjectionMatrix();
    this.contents?.step(delta, this.controls.yaw);

    if (this.renderRequested || Math.abs(yawDiff) > 0.0001 || Math.abs(zoomDiff) > 0.0001 || this.contents?.isActive()) {
      this.renderRequested = false;
      this.renderer.render(this.scene, this.camera);
    }
    if (this.controls.dragging || this.controls.velocity !== 0 || Math.abs(yawDiff) > 0.0001 || Math.abs(zoomDiff) > 0.0001 || this.contents?.isActive()) {
      this.frame = requestAnimationFrame(this.tick);
    }
  };

  private resize() {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, width * height > 1_200_000 ? 1.35 : 1.75));
    this.renderer.setSize(width, height, false);
    const halfHeight = 0.132 / 2;
    const aspect = width / height;
    this.camera.left = -halfHeight * aspect;
    this.camera.right = halfHeight * aspect;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
  }

  captureDataUrl() {
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL("image/png");
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.detachControls();
    this.contents?.dispose();
    this.bottle?.dispose();
    this.presentationShell?.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      node.geometry.dispose();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((material) => material.dispose());
    });
    this.presentationShell?.removeFromParent();
    this.presentationShell = null;
    this.presentationCap = null;
    this.labelManager.dispose();
    this.environment?.dispose();
    this.scene.traverse((node) => {
      if (node instanceof Mesh && node.name === "StudioFloor") {
        node.geometry.dispose();
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach((entry) => entry.dispose());
      }
    });
    this.renderer.dispose();
  }
}
