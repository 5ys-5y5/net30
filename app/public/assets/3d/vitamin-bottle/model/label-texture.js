const EDITOR_TEXTURE_WIDTH = 2048;
const EDITOR_TEXTURE_HEIGHT = 944;
const RENDERED_TEXTURE_EDGE_LIMIT = 3072;

function createTextureFromCanvas(gl, canvas) {
  const texture = gl.createTexture();
  if (!texture) throw new Error("WebGL texture allocation failed.");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    canvas,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return texture;
}

function updateTexture(gl, texture, canvas) {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    canvas,
  );
  gl.bindTexture(gl.TEXTURE_2D, null);
}

function roundRect(context, x, y, width, height, radius) {
  const resolvedRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + resolvedRadius, y);
  context.arcTo(x + width, y, x + width, y + height, resolvedRadius);
  context.arcTo(x + width, y + height, x, y + height, resolvedRadius);
  context.arcTo(x, y + height, x, y, resolvedRadius);
  context.arcTo(x, y, x + width, y, resolvedRadius);
  context.closePath();
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load the requested label texture."));
    image.src = source;
  });
}

function splitWrappedLines(context, text, maxWidth, maxLines = Number.POSITIVE_INFINITY) {
  const paragraphs = String(text || "").split(/\n+/);
  const lines = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      if (lines.length < maxLines) lines.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (context.measureText(candidate).width > maxWidth && current) {
        lines.push(current);
        current = word;
        if (lines.length >= maxLines) break;
      } else {
        current = candidate;
      }
    }
    if (lines.length >= maxLines) break;
    if (current) lines.push(current);
    if (lines.length >= maxLines) break;
  }
  return lines.slice(0, maxLines);
}

function fitText(context, text, maxWidth, startSize, minSize, weight = 800) {
  let size = startSize;
  const family = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif';
  do {
    context.font = `${weight} ${size}px ${family}`;
    if (context.measureText(String(text)).width <= maxWidth) return size;
    size -= 2;
  } while (size >= minSize);
  context.font = `${weight} ${minSize}px ${family}`;
  return minSize;
}

function clearLabel(context, canvas, color = "#ffffff") {
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = color;
  context.fillRect(0, 0, canvas.width, canvas.height);
}

function drawBlankLabel(context, canvas) {
  clearLabel(context, canvas);
  context.strokeStyle = "#e5e7eb";
  context.lineWidth = 3;
  context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
}

function resizeCanvas(canvas, width, height) {
  const nextWidth = Math.max(1, Math.round(width));
  const nextHeight = Math.max(1, Math.round(height));
  if (canvas.width === nextWidth && canvas.height === nextHeight) return;
  canvas.width = nextWidth;
  canvas.height = nextHeight;
}

function resetEditorTextureSize(canvas) {
  resizeCanvas(canvas, EDITOR_TEXTURE_WIDTH, EDITOR_TEXTURE_HEIGHT);
}

function drawImageContained(context, canvas, image) {
  clearLabel(context, canvas);
  const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  const x = (canvas.width - width) / 2;
  const y = (canvas.height - height) / 2;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, x, y, width, height);
}

function drawRenderedLabel(context, canvas, image, maxTextureEdge) {
  const sourceWidth = Math.max(1, image.naturalWidth);
  const sourceHeight = Math.max(1, image.naturalHeight);
  const scale = Math.min(1, maxTextureEdge / sourceWidth, maxTextureEdge / sourceHeight);
  resizeCanvas(canvas, sourceWidth * scale, sourceHeight * scale);
  clearLabel(context, canvas);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
}

function drawTextLabel(context, canvas, state) {
  const { width, height } = canvas;
  clearLabel(context, canvas);
  context.fillStyle = state.accentColor;
  context.fillRect(0, 0, width, 34);

  context.fillStyle = "#111827";
  context.font = '700 54px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.fillText(String(state.brand).toUpperCase(), 92, 132);
  fitText(context, state.productName, 1390, 132, 68, 900);
  context.fillText(state.productName, 88, 316);

  context.fillStyle = "#4b5563";
  context.font = '500 43px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif';
  const lines = splitWrappedLines(context, state.subtitle, 1180, 3);
  lines.forEach((line, index) => context.fillText(line, 92, 410 + index * 58));

  context.fillStyle = "#111827";
  context.font = '800 72px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.fillText(state.dose, 92, 740);
  context.fillStyle = "#6b7280";
  context.font = '700 42px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.fillText(state.quantity, 96, 812);

  context.save();
  context.translate(1640, 450);
  context.rotate(-0.32);
  context.fillStyle = state.accentColor;
  roundRect(context, -182, -68, 364, 136, 68);
  context.fill();
  context.beginPath();
  context.rect(0, -68, 182, 136);
  context.clip();
  context.fillStyle = "#fff3b5";
  roundRect(context, -182, -68, 364, 136, 68);
  context.fill();
  context.restore();

  context.fillStyle = "#111827";
  context.font = '800 34px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.textAlign = "center";
  context.fillText("VITAMIN", 1640, 637);
  context.textAlign = "left";
  context.strokeStyle = "#e5e7eb";
  context.lineWidth = 3;
  context.strokeRect(2, 2, width - 4, height - 4);
}

export function createLabelTextureRenderer(gl) {
  const canvas = document.createElement("canvas");
  canvas.width = EDITOR_TEXTURE_WIDTH;
  canvas.height = EDITOR_TEXTURE_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable.");
  drawBlankLabel(context, canvas);
  const texture = createTextureFromCanvas(gl, canvas);
  const maxTextureEdge = Math.max(
    1,
    Math.min(
      RENDERED_TEXTURE_EDGE_LIMIT,
      Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || RENDERED_TEXTURE_EDGE_LIMIT,
    ),
  );
  let refreshSequence = 0;

  const commit = () => updateTexture(gl, texture, canvas);

  async function refresh(state) {
    const sequence = ++refreshSequence;
    if (state.labelMode === "text") {
      resetEditorTextureSize(canvas);
      drawTextLabel(context, canvas, state);
      commit();
      return;
    }

    const source = state.labelMode === "rendered"
      ? state.renderedLabelDataUrl
      : state.labelMode === "custom"
        ? state.customLabelImage
        : "";

    if (!source) {
      resetEditorTextureSize(canvas);
      drawBlankLabel(context, canvas);
      commit();
      return;
    }

    const image = await loadImage(source);
    if (sequence !== refreshSequence) return;
    if (state.labelMode === "rendered") {
      drawRenderedLabel(context, canvas, image, maxTextureEdge);
    } else {
      resetEditorTextureSize(canvas);
      drawImageContained(context, canvas, image);
    }
    commit();
  }

  return {
    texture,
    canvas,
    refresh,
    destroy() {
      gl.deleteTexture(texture);
    },
  };
}

export function createShadowTexture(gl) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable.");
  const gradient = context.createRadialGradient(128, 128, 4, 128, 128, 122);
  gradient.addColorStop(0, "rgba(0,0,0,.30)");
  gradient.addColorStop(0.5, "rgba(0,0,0,.14)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  return createTextureFromCanvas(gl, canvas);
}
