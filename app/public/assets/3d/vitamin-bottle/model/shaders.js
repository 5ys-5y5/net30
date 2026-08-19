const VERTEX_SHADER_SOURCE = `
  attribute vec3 aPosition;
  attribute vec3 aNormal;
  attribute vec2 aUV;
  uniform mat4 uModel;
  uniform mat4 uView;
  uniform mat4 uProjection;
  uniform mat3 uNormalMatrix;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec2 vUV;
  void main() {
    vec4 world = uModel * vec4(aPosition, 1.0);
    vWorldPos = world.xyz;
    vNormal = normalize(uNormalMatrix * aNormal);
    vUV = aUV;
    gl_Position = uProjection * uView * world;
  }
`;

const FRAGMENT_SHADER_SOURCE = `
  precision highp float;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec2 vUV;
  uniform vec3 uBaseColor;
  uniform vec3 uCameraPos;
  uniform vec3 uLightDir;
  uniform float uAlpha;
  uniform float uRoughness;
  uniform float uSpecular;
  uniform int uMaterialType;
  uniform int uUseTexture;
  uniform sampler2D uTexture;
  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDirection = normalize(uCameraPos - vWorldPos);
    vec3 lightDirection = normalize(-uLightDir);
    vec3 halfway = normalize(lightDirection + viewDirection);
    float diffuse = max(dot(normal, lightDirection), 0.0);
    float rim = pow(1.0 - max(abs(dot(normal, viewDirection)), 0.0), 3.0);
    float shininess = mix(110.0, 10.0, clamp(uRoughness, 0.0, 1.0));
    float highlight = pow(max(dot(normal, halfway), 0.0), shininess) * uSpecular;
    vec4 texel = vec4(1.0);
    if (uUseTexture == 1) texel = texture2D(uTexture, vUV);

    if (uMaterialType == 1) {
      vec3 glass = mix(uBaseColor, vec3(1.0), 0.46);
      vec3 color = glass * (0.40 + 0.36 * diffuse)
        + vec3(1.0) * (highlight * 1.25 + rim * 0.55);
      float alpha = clamp(uAlpha + rim * 0.30 + highlight * 0.18, 0.04, 0.72);
      gl_FragColor = vec4(color, alpha);
    } else if (uMaterialType == 2) {
      if (texel.a < 0.02) discard;
      vec3 color = texel.rgb * (0.86 + 0.18 * diffuse) + vec3(highlight * 0.16);
      gl_FragColor = vec4(color, texel.a * uAlpha);
    } else if (uMaterialType == 3) {
      if (texel.a < 0.02) discard;
      gl_FragColor = vec4(texel.rgb, texel.a * uAlpha);
    } else {
      vec3 color = uBaseColor * (0.44 + 0.56 * diffuse)
        + vec3(highlight)
        + uBaseColor * rim * 0.12;
      gl_FragColor = vec4(color, uAlpha);
    }
  }
`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("WebGL shader allocation failed.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || "Unknown shader error";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

export function createShaderProgram(gl) {
  const program = gl.createProgram();
  if (!program) throw new Error("WebGL program allocation failed.");
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || "Unknown program link error";
    gl.deleteProgram(program);
    throw new Error(message);
  }

  return {
    program,
    locations: {
      aPosition: gl.getAttribLocation(program, "aPosition"),
      aNormal: gl.getAttribLocation(program, "aNormal"),
      aUV: gl.getAttribLocation(program, "aUV"),
      uModel: gl.getUniformLocation(program, "uModel"),
      uView: gl.getUniformLocation(program, "uView"),
      uProjection: gl.getUniformLocation(program, "uProjection"),
      uNormalMatrix: gl.getUniformLocation(program, "uNormalMatrix"),
      uBaseColor: gl.getUniformLocation(program, "uBaseColor"),
      uCameraPos: gl.getUniformLocation(program, "uCameraPos"),
      uLightDir: gl.getUniformLocation(program, "uLightDir"),
      uAlpha: gl.getUniformLocation(program, "uAlpha"),
      uRoughness: gl.getUniformLocation(program, "uRoughness"),
      uSpecular: gl.getUniformLocation(program, "uSpecular"),
      uMaterialType: gl.getUniformLocation(program, "uMaterialType"),
      uUseTexture: gl.getUniformLocation(program, "uUseTexture"),
      uTexture: gl.getUniformLocation(program, "uTexture"),
    },
  };
}
