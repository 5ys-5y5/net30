import { clamp } from "../model/math.js";

export const DEFAULT_CAMERA = Object.freeze({
  yaw: 0,
  pitch: 0.1,
  distance: 8.2,
  target: [0, 0.18, 0],
});

export function createCamera(overrides = {}) {
  return {
    ...DEFAULT_CAMERA,
    ...overrides,
    target: Array.isArray(overrides.target)
      ? [...overrides.target]
      : [...DEFAULT_CAMERA.target],
    dragging: false,
    lastX: 0,
    lastY: 0,
  };
}

export function resetCamera(camera) {
  camera.yaw = DEFAULT_CAMERA.yaw;
  camera.pitch = DEFAULT_CAMERA.pitch;
  camera.distance = DEFAULT_CAMERA.distance;
  camera.target = [...DEFAULT_CAMERA.target];
  camera.dragging = false;
}

export function attachCameraControls(canvas, camera) {
  const activePointers = new Map();
  let pinchDistance = 0;

  const pointerDistance = () => {
    const points = [...activePointers.values()];
    return points.length < 2
      ? 0
      : Math.hypot(
          points[0][0] - points[1][0],
          points[0][1] - points[1][1],
        );
  };

  const onPointerDown = (event) => {
    activePointers.set(event.pointerId, [event.clientX, event.clientY]);
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is optional on older browsers.
    }
    if (activePointers.size === 1) {
      camera.dragging = true;
      camera.lastX = event.clientX;
      camera.lastY = event.clientY;
    } else if (activePointers.size === 2) {
      camera.dragging = false;
      pinchDistance = pointerDistance();
    }
  };

  const onPointerMove = (event) => {
    if (!activePointers.has(event.pointerId)) return;
    activePointers.set(event.pointerId, [event.clientX, event.clientY]);
    if (activePointers.size >= 2) {
      const distance = pointerDistance();
      if (distance > 0 && pinchDistance > 0) {
        camera.distance = clamp(
          camera.distance * (pinchDistance / distance),
          4.7,
          12.5,
        );
      }
      pinchDistance = distance;
      return;
    }
    if (!camera.dragging) return;
    const deltaX = event.clientX - camera.lastX;
    const deltaY = event.clientY - camera.lastY;
    camera.lastX = event.clientX;
    camera.lastY = event.clientY;
    camera.yaw -= deltaX * 0.008;
    camera.pitch = clamp(camera.pitch + deltaY * 0.008, -0.65, 0.85);
  };

  const endPointer = (event) => {
    activePointers.delete(event.pointerId);
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture is optional on older browsers.
    }
    if (activePointers.size === 1) {
      const [point] = activePointers.values();
      camera.dragging = true;
      camera.lastX = point[0];
      camera.lastY = point[1];
    } else {
      camera.dragging = false;
    }
  };

  const onWheel = (event) => {
    event.preventDefault();
    camera.distance = clamp(
      camera.distance * Math.exp(event.deltaY * 0.001),
      4.7,
      12.5,
    );
  };

  const onDoubleClick = () => resetCamera(camera);

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("dblclick", onDoubleClick);

  return () => {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", endPointer);
    canvas.removeEventListener("pointercancel", endPointer);
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("dblclick", onDoubleClick);
  };
}
