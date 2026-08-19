export const RAD = Math.PI / 180;

export const clamp = (value, min, max) =>
  Math.min(max, Math.max(min, value));

export function mat4Identity() {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

export function mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += a[k * 4 + row] * b[column * 4 + k];
      }
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

export function mat4Translation(x, y, z) {
  const matrix = mat4Identity();
  matrix[12] = x;
  matrix[13] = y;
  matrix[14] = z;
  return matrix;
}

export function mat4Scale(x, y, z) {
  const matrix = mat4Identity();
  matrix[0] = x;
  matrix[5] = y;
  matrix[10] = z;
  return matrix;
}

export function mat4RotationX(angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return new Float32Array([
    1, 0, 0, 0,
    0, cosine, sine, 0,
    0, -sine, cosine, 0,
    0, 0, 0, 1,
  ]);
}

export function mat4RotationY(angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return new Float32Array([
    cosine, 0, -sine, 0,
    0, 1, 0, 0,
    sine, 0, cosine, 0,
    0, 0, 0, 1,
  ]);
}

export function mat4RotationZ(angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return new Float32Array([
    cosine, sine, 0, 0,
    -sine, cosine, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

export function composeMatrix(translation, rotation, scale) {
  let matrix = mat4Translation(
    translation[0],
    translation[1],
    translation[2],
  );
  matrix = mat4Multiply(matrix, mat4RotationY(rotation[1]));
  matrix = mat4Multiply(matrix, mat4RotationX(rotation[0]));
  matrix = mat4Multiply(matrix, mat4RotationZ(rotation[2]));
  return mat4Multiply(matrix, mat4Scale(scale[0], scale[1], scale[2]));
}

export function mat4Perspective(fieldOfView, aspect, near, far) {
  const f = 1 / Math.tan(fieldOfView / 2);
  const nearFar = 1 / (near - far);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nearFar;
  out[11] = -1;
  out[14] = 2 * far * near * nearFar;
  return out;
}

function vec3Normalize(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return vector.map((value) => value / length);
}

function vec3Cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function vec3Subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function mat4LookAt(eye, center, up) {
  const z = vec3Normalize(vec3Subtract(eye, center));
  const x = vec3Normalize(vec3Cross(up, z));
  const y = vec3Cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]),
    -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]),
    -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]),
    1,
  ]);
}

export function normalMatrixFromMat4(matrix) {
  const a00 = matrix[0];
  const a01 = matrix[4];
  const a02 = matrix[8];
  const a10 = matrix[1];
  const a11 = matrix[5];
  const a12 = matrix[9];
  const a20 = matrix[2];
  const a21 = matrix[6];
  const a22 = matrix[10];

  const b01 = a22 * a11 - a12 * a21;
  const b11 = -a22 * a10 + a12 * a20;
  const b21 = a21 * a10 - a11 * a20;
  let determinant = a00 * b01 + a01 * b11 + a02 * b21;
  if (!determinant) {
    return new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  }
  determinant = 1 / determinant;
  return new Float32Array([
    b01 * determinant,
    (-a22 * a01 + a02 * a21) * determinant,
    (a12 * a01 - a02 * a11) * determinant,
    b11 * determinant,
    (a22 * a00 - a02 * a20) * determinant,
    (-a12 * a00 + a02 * a10) * determinant,
    b21 * determinant,
    (-a21 * a00 + a01 * a20) * determinant,
    (a11 * a00 - a01 * a10) * determinant,
  ]);
}

export function hexToRgb01(hex) {
  const clean = String(hex || "#000000").replace("#", "");
  const normalized = clean.length === 3
    ? clean.split("").map((character) => character + character).join("")
    : clean.padEnd(6, "0").slice(0, 6);
  const value = Number.parseInt(normalized, 16);
  if (!Number.isFinite(value)) return [0, 0, 0];
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  ];
}
