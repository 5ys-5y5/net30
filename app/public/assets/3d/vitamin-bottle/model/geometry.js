import { RAD } from "./math.js";

export function createGeometryFactory(gl) {
  function makeGeometry(positions, normals, uvs, indices) {
    const maximumIndex = indices.reduce((max, value) => Math.max(max, value), 0);
    if (maximumIndex > 65535) {
      throw new Error("Model geometry exceeds WebGL 1 Uint16 index capacity.");
    }
    const geometry = {
      position: gl.createBuffer(),
      normal: gl.createBuffer(),
      uv: gl.createBuffer(),
      index: gl.createBuffer(),
      count: indices.length,
    };
    if (!geometry.position || !geometry.normal || !geometry.uv || !geometry.index) {
      throw new Error("WebGL geometry buffer allocation failed.");
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, geometry.position);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, geometry.normal);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, geometry.uv);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.index);
    gl.bufferData(
      gl.ELEMENT_ARRAY_BUFFER,
      new Uint16Array(indices),
      gl.STATIC_DRAW,
    );
    return geometry;
  }

  function destroy(geometry) {
    if (!geometry) return;
    gl.deleteBuffer(geometry.position);
    gl.deleteBuffer(geometry.normal);
    gl.deleteBuffer(geometry.uv);
    gl.deleteBuffer(geometry.index);
  }

  function lathe(profile, segments = 96) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    for (let rowIndex = 0; rowIndex < profile.length; rowIndex += 1) {
      const previous = profile[Math.max(0, rowIndex - 1)];
      const next = profile[Math.min(profile.length - 1, rowIndex + 1)];
      const deltaRadius = next[0] - previous[0];
      const deltaY = next[1] - previous[1];
      const length = Math.hypot(deltaRadius, deltaY) || 1;
      const normalRadius = deltaY / length;
      const normalY = -deltaRadius / length;
      for (let segment = 0; segment <= segments; segment += 1) {
        const u = segment / segments;
        const angle = u * Math.PI * 2;
        const sine = Math.sin(angle);
        const cosine = Math.cos(angle);
        positions.push(
          profile[rowIndex][0] * sine,
          profile[rowIndex][1],
          profile[rowIndex][0] * cosine,
        );
        normals.push(normalRadius * sine, normalY, normalRadius * cosine);
        uvs.push(u, rowIndex / (profile.length - 1));
      }
    }
    const rowLength = segments + 1;
    for (let row = 0; row < profile.length - 1; row += 1) {
      for (let segment = 0; segment < segments; segment += 1) {
        const a = row * rowLength + segment;
        const b = a + rowLength;
        const c = a + 1;
        const d = b + 1;
        indices.push(a, b, c, c, b, d);
      }
    }
    return makeGeometry(positions, normals, uvs, indices);
  }

  function cylinder(
    radius,
    height,
    segments = 64,
    capTop = true,
    capBottom = true,
  ) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    const halfHeight = height / 2;
    for (let segment = 0; segment <= segments; segment += 1) {
      const u = segment / segments;
      const angle = u * Math.PI * 2;
      const sine = Math.sin(angle);
      const cosine = Math.cos(angle);
      positions.push(
        radius * sine,
        -halfHeight,
        radius * cosine,
        radius * sine,
        halfHeight,
        radius * cosine,
      );
      normals.push(sine, 0, cosine, sine, 0, cosine);
      uvs.push(u, 0, u, 1);
    }
    for (let segment = 0; segment < segments; segment += 1) {
      const a = segment * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, c, b, d);
    }

    if (capTop) {
      const center = positions.length / 3;
      positions.push(0, halfHeight, 0);
      normals.push(0, 1, 0);
      uvs.push(0.5, 0.5);
      for (let segment = 0; segment < segments; segment += 1) {
        const angleA = (segment / segments) * Math.PI * 2;
        const angleB = ((segment + 1) / segments) * Math.PI * 2;
        const a = positions.length / 3;
        positions.push(
          radius * Math.sin(angleA),
          halfHeight,
          radius * Math.cos(angleA),
        );
        normals.push(0, 1, 0);
        uvs.push(0.5 + 0.5 * Math.sin(angleA), 0.5 + 0.5 * Math.cos(angleA));
        const b = positions.length / 3;
        positions.push(
          radius * Math.sin(angleB),
          halfHeight,
          radius * Math.cos(angleB),
        );
        normals.push(0, 1, 0);
        uvs.push(0.5 + 0.5 * Math.sin(angleB), 0.5 + 0.5 * Math.cos(angleB));
        indices.push(center, a, b);
      }
    }

    if (capBottom) {
      const center = positions.length / 3;
      positions.push(0, -halfHeight, 0);
      normals.push(0, -1, 0);
      uvs.push(0.5, 0.5);
      for (let segment = 0; segment < segments; segment += 1) {
        const angleA = ((segment + 1) / segments) * Math.PI * 2;
        const angleB = (segment / segments) * Math.PI * 2;
        const a = positions.length / 3;
        positions.push(
          radius * Math.sin(angleA),
          -halfHeight,
          radius * Math.cos(angleA),
        );
        normals.push(0, -1, 0);
        uvs.push(0.5, 0.5);
        const b = positions.length / 3;
        positions.push(
          radius * Math.sin(angleB),
          -halfHeight,
          radius * Math.cos(angleB),
        );
        normals.push(0, -1, 0);
        uvs.push(0.5, 0.5);
        indices.push(center, a, b);
      }
    }
    return makeGeometry(positions, normals, uvs, indices);
  }

  function ribbedCap(radius, height, segments = 144, ridges = 48) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    const halfHeight = height / 2;
    const radii = [];
    for (let segment = 0; segment <= segments; segment += 1) {
      const u = segment / segments;
      const angle = u * Math.PI * 2;
      const currentRadius = radius * (1 + 0.018 * Math.cos(angle * ridges));
      radii.push(currentRadius);
      const sine = Math.sin(angle);
      const cosine = Math.cos(angle);
      positions.push(
        currentRadius * sine,
        -halfHeight,
        currentRadius * cosine,
        currentRadius * sine,
        halfHeight,
        currentRadius * cosine,
      );
      normals.push(sine, 0, cosine, sine, 0, cosine);
      uvs.push(u, 0, u, 1);
    }
    for (let segment = 0; segment < segments; segment += 1) {
      const a = segment * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, c, b, d);
    }
    const top = positions.length / 3;
    positions.push(0, halfHeight, 0);
    normals.push(0, 1, 0);
    uvs.push(0.5, 0.5);
    for (let segment = 0; segment < segments; segment += 1) {
      const angleA = (segment / segments) * Math.PI * 2;
      const angleB = ((segment + 1) / segments) * Math.PI * 2;
      const a = positions.length / 3;
      positions.push(
        radii[segment] * Math.sin(angleA),
        halfHeight,
        radii[segment] * Math.cos(angleA),
      );
      normals.push(0, 1, 0);
      uvs.push(0.5 + 0.5 * Math.sin(angleA), 0.5 + 0.5 * Math.cos(angleA));
      const b = positions.length / 3;
      positions.push(
        radii[segment + 1] * Math.sin(angleB),
        halfHeight,
        radii[segment + 1] * Math.cos(angleB),
      );
      normals.push(0, 1, 0);
      uvs.push(0.5 + 0.5 * Math.sin(angleB), 0.5 + 0.5 * Math.cos(angleB));
      indices.push(top, a, b);
    }
    return makeGeometry(positions, normals, uvs, indices);
  }

  function sphere(segments = 24, rings = 14) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    for (let ring = 0; ring <= rings; ring += 1) {
      const v = ring / rings;
      const phi = v * Math.PI;
      const sinePhi = Math.sin(phi);
      const cosinePhi = Math.cos(phi);
      for (let segment = 0; segment <= segments; segment += 1) {
        const u = segment / segments;
        const angle = u * Math.PI * 2;
        const sine = Math.sin(angle);
        const cosine = Math.cos(angle);
        const x = sinePhi * sine;
        const y = cosinePhi;
        const z = sinePhi * cosine;
        positions.push(x, y, z);
        normals.push(x, y, z);
        uvs.push(u, 1 - v);
      }
    }
    const rowLength = segments + 1;
    for (let ring = 0; ring < rings; ring += 1) {
      for (let segment = 0; segment < segments; segment += 1) {
        const a = ring * rowLength + segment;
        const b = a + rowLength;
        const c = a + 1;
        const d = b + 1;
        indices.push(a, b, c, c, b, d);
      }
    }
    return makeGeometry(positions, normals, uvs, indices);
  }

  function plane(size = 1) {
    return makeGeometry(
      [
        -size, 0, -size,
        size, 0, -size,
        size, 0, size,
        -size, 0, size,
      ],
      [
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
      ],
      [0, 0, 1, 0, 1, 1, 0, 1],
      [0, 1, 2, 0, 2, 3],
    );
  }

  function curvedLabel(radius, height, degrees, segments = 96) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    const halfAngle = (degrees * RAD) / 2;
    const halfHeight = height / 2;
    for (let row = 0; row < 2; row += 1) {
      for (let segment = 0; segment <= segments; segment += 1) {
        const u = segment / segments;
        const angle = -halfAngle + u * halfAngle * 2;
        const sine = Math.sin(angle);
        const cosine = Math.cos(angle);
        positions.push(
          radius * sine,
          row ? halfHeight : -halfHeight,
          radius * cosine,
        );
        normals.push(sine, 0, cosine);
        uvs.push(u, row);
      }
    }
    const rowLength = segments + 1;
    for (let segment = 0; segment < segments; segment += 1) {
      const a = segment;
      const b = segment + 1;
      const c = rowLength + segment;
      const d = rowLength + segment + 1;
      indices.push(a, c, b, b, c, d);
    }
    return makeGeometry(positions, normals, uvs, indices);
  }

  return { lathe, cylinder, ribbedCap, sphere, plane, curvedLabel, destroy };
}
