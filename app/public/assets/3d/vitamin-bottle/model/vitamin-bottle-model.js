import { createModelState } from "./config.js";
import { createGeometryFactory } from "./geometry.js";
import { createLabelTextureRenderer, createShadowTexture } from "./label-texture.js";
import {
  RAD,
  composeMatrix,
  hexToRgb01,
  mat4Identity,
  mat4LookAt,
  mat4Perspective,
  normalMatrixFromMat4,
} from "./math.js";
import { createShaderProgram } from "./shaders.js";
import {
  attachCameraControls,
  createCamera,
  resetCamera,
} from "../shared/camera-controls.js";

const LABEL_RADIUS = 1.258;
const MIN_LABEL_HEIGHT = 0.35;
const MAX_LABEL_HEIGHT = 2.25;

const BOTTLE_PROFILE = [
  [0.0, -2.18],
  [0.92, -2.18],
  [1.12, -2.16],
  [1.22, -2.07],
  [1.24, -1.9],
  [1.24, 1.1],
  [1.22, 1.26],
  [1.14, 1.38],
  [1.0, 1.49],
  [0.86, 1.6],
  [0.75, 1.74],
  [0.68, 1.92],
  [0.67, 2.24],
  [0.72, 2.29],
];

const LABEL_FIELDS = new Set([
  "labelMode",
  "renderedLabelDataUrl",
  "renderedLabelSourceId",
  "customLabelImage",
  "brand",
  "productName",
  "subtitle",
  "dose",
  "quantity",
  "accentColor",
]);

const LABEL_MODES = new Set(["blank", "rendered", "text", "custom"]);

const NUMERIC_FIELDS = new Set([
  "labelArc",
  "labelHeight",
  "labelY",
  "labelRotation",
  "glassAlpha",
  "pillCount",
]);

function material(baseColor, options = {}) {
  return {
    baseColor,
    alpha: options.alpha ?? 1,
    roughness: options.roughness ?? 0.5,
    specular: options.specular ?? 0.45,
    type: options.type ?? 0,
    texture: options.texture ?? null,
    depthWrite: options.depthWrite ?? true,
    blend: options.blend ?? false,
  };
}

function mulberry32(seed) {
  return function random() {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeStatePatch(patch) {
  const normalized = { ...patch };
  for (const key of NUMERIC_FIELDS) {
    if (!(key in normalized)) continue;
    const numberValue = Number(normalized[key]);
    if (Number.isFinite(numberValue)) normalized[key] = numberValue;
    else delete normalized[key];
  }
  if ("pillCount" in normalized) {
    normalized.pillCount = Math.max(0, Math.round(normalized.pillCount));
  }
  if ("labelMode" in normalized && !LABEL_MODES.has(normalized.labelMode)) {
    normalized.labelMode = "blank";
  }
  for (const key of ["renderedLabelDataUrl", "renderedLabelSourceId", "customLabelImage"]) {
    if (key in normalized && typeof normalized[key] !== "string") delete normalized[key];
  }
  return normalized;
}

export class VitaminBottleModel {
  constructor(canvas, options = {}) {
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new TypeError("VitaminBottleModel requires an HTMLCanvasElement.");
    }
    this.canvas = canvas;
    this.state = createModelState(normalizeStatePatch(options.state || {}));
    this.camera = createCamera(options.camera);
    this.disposed = false;
    this.animationFrame = 0;
    this.lastTime = performance.now();
    this.pills = [];

    this.gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      depth: true,
    });
    if (!this.gl) {
      throw new Error("WebGL is unavailable in this browser.");
    }

    const { program, locations } = createShaderProgram(this.gl);
    this.program = program;
    this.locations = locations;
    this.gl.useProgram(program);
    this.geometryFactory = createGeometryFactory(this.gl);
    this.labelRenderer = createLabelTextureRenderer(this.gl);
    this.shadowTexture = createShadowTexture(this.gl);
    this.createGeometry();
    this.createMaterials();
    this.rebuildPills();
    this.detachControls = options.controls === false
      ? () => {}
      : attachCameraControls(canvas, this.camera);

    this.onContextLost = (event) => {
      event.preventDefault();
      this.stop();
      this.canvas.dispatchEvent(new CustomEvent("net30-model-error", {
        detail: new Error("WebGL context was lost."),
      }));
    };
    canvas.addEventListener("webglcontextlost", this.onContextLost);

    this.ready = this.labelRenderer.refresh(this.state)
      .then(() => {
        this.canvas.dispatchEvent(new CustomEvent("net30-model-ready", {
          detail: this.getState(),
        }));
        return this;
      });

    if (options.autoStart !== false) this.start();
  }

  createGeometry() {
    const geometry = this.geometryFactory;
    this.geometries = {
      bottle: geometry.lathe(BOTTLE_PROFILE, 112),
      neck: geometry.cylinder(0.675, 0.46, 72, false, false),
      cap: geometry.ribbedCap(0.82, 0.76, 144, 48),
      capBand: geometry.cylinder(0.835, 0.1, 96, true, true),
      pill: geometry.sphere(22, 14),
      floor: geometry.plane(8),
      shadow: geometry.plane(1),
      label: geometry.curvedLabel(
        LABEL_RADIUS,
        this.state.labelHeight,
        this.state.labelArc,
        112,
      ),
    };
  }

  createMaterials() {
    this.materials = {
      floor: material("#e7e9ed", { roughness: 0.95, specular: 0.05 }),
      shadow: material("#ffffff", {
        alpha: 0.55,
        type: 3,
        texture: this.shadowTexture,
        blend: true,
        depthWrite: false,
      }),
      neck: material("#c7d4cf", {
        alpha: 0.16,
        roughness: 0.15,
        specular: 0.9,
        type: 1,
        blend: true,
        depthWrite: false,
      }),
      label: material("#ffffff", {
        alpha: 1,
        roughness: 0.55,
        specular: 0.12,
        type: 2,
        texture: this.labelRenderer.texture,
      }),
    };
  }

  rebuildPills() {
    this.pills = [];
    const random = mulberry32(915273);
    for (let index = 0; index < this.state.pillCount; index += 1) {
      const y = -1.92 + random() * 2.62;
      const radius = Math.sqrt(random()) * 0.88;
      const angle = random() * Math.PI * 2;
      const kind = random();
      const scale = kind < 0.35
        ? [0.18, 0.075, 0.31]
        : kind < 0.7
          ? [0.22, 0.095, 0.22]
          : [0.16, 0.07, 0.27];
      this.pills.push({
        translation: [Math.sin(angle) * radius, y, Math.cos(angle) * radius],
        rotation: [random() * Math.PI, random() * Math.PI, random() * Math.PI],
        scale,
        color: index % 2 ? this.state.pillColorA : this.state.pillColorB,
      });
    }
  }

  rebuildLabelGeometry() {
    this.geometryFactory.destroy(this.geometries.label);
    this.geometries.label = this.geometryFactory.curvedLabel(
      LABEL_RADIUS,
      this.state.labelHeight,
      this.state.labelArc,
      112,
    );
  }

  getState() {
    return { ...this.state };
  }

  async setRenderedLabel({ dataUrl, sourceId, pixelWidth, pixelHeight }) {
    const width = Number(pixelWidth);
    const height = Number(pixelHeight);
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,")) {
      throw new Error("렌더링된 라벨 PNG가 유효하지 않습니다.");
    }
    if (typeof sourceId !== "string" || !sourceId.trim()) {
      throw new Error("렌더링된 라벨의 SKU ID가 없습니다.");
    }
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
      throw new Error("렌더링된 라벨 크기가 유효하지 않습니다.");
    }

    const aspectRatio = width / height;
    const wrappedWidth = LABEL_RADIUS * Number(this.state.labelArc) * RAD;
    const fittedHeight = Math.min(
      MAX_LABEL_HEIGHT,
      Math.max(MIN_LABEL_HEIGHT, wrappedWidth / aspectRatio),
    );

    return this.setState({
      labelMode: "rendered",
      renderedLabelDataUrl: dataUrl,
      renderedLabelSourceId: sourceId,
      labelHeight: fittedHeight,
    });
  }

  async setState(patch, options = {}) {
    const normalized = normalizeStatePatch(patch);
    const changedKeys = Object.keys(normalized).filter(
      (key) => this.state[key] !== normalized[key],
    );
    if (changedKeys.length === 0) return this.getState();
    this.state = createModelState({ ...this.state, ...normalized });

    if (changedKeys.some((key) => key === "labelArc" || key === "labelHeight")) {
      this.rebuildLabelGeometry();
    }
    if (
      changedKeys.some((key) =>
        key === "pillCount" || key === "pillColorA" || key === "pillColorB"
      )
    ) {
      this.rebuildPills();
    }
    if (changedKeys.some((key) => LABEL_FIELDS.has(key))) {
      await this.labelRenderer.refresh(this.state);
    }
    if (options.resetCamera) resetCamera(this.camera);
    this.canvas.dispatchEvent(new CustomEvent("net30-model-change", {
      detail: { state: this.getState(), changedKeys },
    }));
    return this.getState();
  }

  async reset(stateOverrides = {}) {
    this.state = createModelState(normalizeStatePatch(stateOverrides));
    this.rebuildLabelGeometry();
    this.rebuildPills();
    resetCamera(this.camera);
    await this.labelRenderer.refresh(this.state);
    this.canvas.dispatchEvent(new CustomEvent("net30-model-change", {
      detail: { state: this.getState(), changedKeys: ["*"] },
    }));
    return this.getState();
  }

  bindGeometry(geometry) {
    const { gl, locations } = this;
    gl.bindBuffer(gl.ARRAY_BUFFER, geometry.position);
    gl.enableVertexAttribArray(locations.aPosition);
    gl.vertexAttribPointer(locations.aPosition, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, geometry.normal);
    gl.enableVertexAttribArray(locations.aNormal);
    gl.vertexAttribPointer(locations.aNormal, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, geometry.uv);
    gl.enableVertexAttribArray(locations.aUV);
    gl.vertexAttribPointer(locations.aUV, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.index);
  }

  draw(geometry, resolvedMaterial, modelMatrix, view, projection, eye) {
    const { gl, locations } = this;
    if (resolvedMaterial.blend) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      gl.disable(gl.BLEND);
    }
    gl.depthMask(Boolean(resolvedMaterial.depthWrite));
    this.bindGeometry(geometry);
    gl.uniformMatrix4fv(locations.uModel, false, modelMatrix);
    gl.uniformMatrix4fv(locations.uView, false, view);
    gl.uniformMatrix4fv(locations.uProjection, false, projection);
    gl.uniformMatrix3fv(
      locations.uNormalMatrix,
      false,
      normalMatrixFromMat4(modelMatrix),
    );
    gl.uniform3fv(locations.uBaseColor, hexToRgb01(resolvedMaterial.baseColor));
    gl.uniform3fv(locations.uCameraPos, new Float32Array(eye));
    gl.uniform3fv(locations.uLightDir, new Float32Array([-0.38, -0.86, -0.42]));
    gl.uniform1f(locations.uAlpha, resolvedMaterial.alpha);
    gl.uniform1f(locations.uRoughness, resolvedMaterial.roughness);
    gl.uniform1f(locations.uSpecular, resolvedMaterial.specular);
    gl.uniform1i(locations.uMaterialType, resolvedMaterial.type);
    if (resolvedMaterial.texture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, resolvedMaterial.texture);
      gl.uniform1i(locations.uTexture, 0);
      gl.uniform1i(locations.uUseTexture, 1);
    } else {
      gl.uniform1i(locations.uUseTexture, 0);
    }
    gl.drawElements(gl.TRIANGLES, geometry.count, gl.UNSIGNED_SHORT, 0);
  }

  resize() {
    const deviceScale = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * deviceScale));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * deviceScale));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.gl.viewport(0, 0, width, height);
    }
  }

  render(time = performance.now()) {
    if (this.disposed) return;
    this.resize();
    const deltaTime = Math.min(0.05, (time - this.lastTime) / 1000);
    this.lastTime = time;
    if (this.state.autoRotate && !this.camera.dragging) {
      this.camera.yaw += deltaTime * 0.18;
    }

    const cosinePitch = Math.cos(this.camera.pitch);
    const eye = [
      Math.sin(this.camera.yaw) * cosinePitch * this.camera.distance,
      this.camera.target[1] + Math.sin(this.camera.pitch) * this.camera.distance,
      Math.cos(this.camera.yaw) * cosinePitch * this.camera.distance,
    ];
    const view = mat4LookAt(eye, this.camera.target, [0, 1, 0]);
    const projection = mat4Perspective(
      42 * RAD,
      this.canvas.width / this.canvas.height,
      0.1,
      100,
    );
    const background = hexToRgb01(this.state.background);
    const { gl } = this;
    gl.clearColor(background[0], background[1], background[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);

    this.draw(
      this.geometries.floor,
      { ...this.materials.floor, baseColor: this.state.background },
      composeMatrix([0, -2.235, 0], [0, 0, 0], [1, 1, 1]),
      view,
      projection,
      eye,
    );
    this.draw(
      this.geometries.shadow,
      this.materials.shadow,
      composeMatrix([0, -2.225, 0], [0, 0, 0], [2.25, 1, 2.25]),
      view,
      projection,
      eye,
    );
    for (const pill of this.pills) {
      this.draw(
        this.geometries.pill,
        material(pill.color, { roughness: 0.5, specular: 0.35 }),
        composeMatrix(pill.translation, pill.rotation, pill.scale),
        view,
        projection,
        eye,
      );
    }
    this.draw(
      this.geometries.neck,
      {
        ...this.materials.neck,
        baseColor: this.state.glassColor,
        alpha: this.state.glassAlpha * 0.72,
      },
      composeMatrix([0, 2.02, 0], [0, 0, 0], [1, 1, 1]),
      view,
      projection,
      eye,
    );
    this.draw(
      this.geometries.bottle,
      material(this.state.glassColor, {
        alpha: this.state.glassAlpha,
        roughness: 0.12,
        specular: 1,
        type: 1,
        blend: true,
        depthWrite: false,
      }),
      mat4Identity(),
      view,
      projection,
      eye,
    );
    this.draw(
      this.geometries.label,
      this.materials.label,
      composeMatrix(
        [0, this.state.labelY, 0],
        [0, this.state.labelRotation * RAD, 0],
        [1, 1, 1],
      ),
      view,
      projection,
      eye,
    );
    this.draw(
      this.geometries.cap,
      material(this.state.capColor, { roughness: 0.34, specular: 0.58 }),
      composeMatrix([0, 2.57, 0], [0, 0, 0], [1, 1, 1]),
      view,
      projection,
      eye,
    );
    this.draw(
      this.geometries.capBand,
      material(this.state.capColor, { roughness: 0.42, specular: 0.38 }),
      composeMatrix([0, 2.23, 0], [0, 0, 0], [1, 1, 1]),
      view,
      projection,
      eye,
    );
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  tick = (time) => {
    this.render(time);
    if (!this.disposed) this.animationFrame = requestAnimationFrame(this.tick);
  };

  start() {
    if (this.disposed || this.animationFrame) return;
    this.lastTime = performance.now();
    this.animationFrame = requestAnimationFrame(this.tick);
  }

  stop() {
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
  }

  resetCamera() {
    resetCamera(this.camera);
  }

  capturePng(filename = "net30-vitamin-bottle.png") {
    this.render(performance.now());
    const url = this.canvas.toDataURL("image/png");
    if (filename) {
      const anchor = document.createElement("a");
      anchor.download = filename;
      anchor.href = url;
      anchor.click();
    }
    return url;
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.detachControls();
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    Object.values(this.geometries).forEach((geometry) => {
      this.geometryFactory.destroy(geometry);
    });
    this.labelRenderer.destroy();
    this.gl.deleteTexture(this.shadowTexture);
    this.gl.deleteProgram(this.program);
  }
}
