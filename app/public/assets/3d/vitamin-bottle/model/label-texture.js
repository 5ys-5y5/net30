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

function fitImage(context, image, x, y, width, height) {
  const scale = Math.min(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  context.drawImage(
    image,
    x + (width - drawWidth) / 2,
    y + (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load label image: ${source}`));
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
  if (lines.length > maxLines) return lines.slice(0, maxLines);
  return lines;
}

function fitText(context, text, maxWidth, startSize, minSize, weight = 800) {
  let size = startSize;
  const family = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif';
  do {
    context.font = `${weight} ${size}px ${family}`;
    if (context.measureText(String(text)).width <= maxWidth) return size;
    size -= 2;
  } while (size >= minSize);
  return minSize;
}

function drawTextLabel(context, canvas, state) {
  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = state.accentColor;
  context.fillRect(0, 0, width, 34);

  context.fillStyle = "#111827";
  context.font = '700 44px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.fillText(String(state.brand).toUpperCase(), 78, 105);
  fitText(context, state.productName, 1080, 106, 56, 900);
  context.fillText(state.productName, 74, 242);

  context.fillStyle = "#4b5563";
  context.font = '500 35px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif';
  const lines = splitWrappedLines(context, state.subtitle, 920, 3);
  lines.forEach((line, index) => context.fillText(line, 78, 320 + index * 49));

  context.fillStyle = "#111827";
  context.font = '800 58px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.fillText(state.dose, 78, 585);
  context.fillStyle = "#6b7280";
  context.font = '700 33px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.fillText(state.quantity, 82, 645);

  context.save();
  context.translate(1290, 360);
  context.rotate(-0.32);
  context.fillStyle = state.accentColor;
  roundRect(context, -145, -54, 290, 108, 54);
  context.fill();
  context.beginPath();
  context.rect(0, -54, 145, 108);
  context.clip();
  context.fillStyle = "#fff3b5";
  roundRect(context, -145, -54, 290, 108, 54);
  context.fill();
  context.restore();
  context.fillStyle = "#111827";
  context.font = '800 27px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.textAlign = "center";
  context.fillText("VITAMIN", 1290, 508);
  context.textAlign = "left";
  context.strokeStyle = "#e5e7eb";
  context.lineWidth = 3;
  context.strokeRect(2, 2, width - 4, height - 4);
}

function extractPriceRows(lines) {
  const expanded = [];
  for (const rawLine of Array.isArray(lines) ? lines : []) {
    String(rawLine).split("\n").forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      expanded.push({ text: trimmed, detail: index > 0 });
    });
  }
  return expanded;
}

function drawSkuLabel(context, canvas, state) {
  const { width, height } = canvas;
  const accent = state.accentColor || "#111827";
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = accent;
  context.fillRect(0, 0, width, 26);

  const leftX = 58;
  const splitX = 815;
  context.strokeStyle = "#d1d5db";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(splitX, 64);
  context.lineTo(splitX, height - 52);
  context.stroke();

  context.fillStyle = "#111827";
  context.font = '800 40px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif';
  context.fillText(String(state.brand || "NET30"), leftX, 92);
  fitText(context, state.productName, 680, 78, 46, 900);
  const titleLines = splitWrappedLines(context, state.productName, 680, 2);
  titleLines.forEach((line, index) => context.fillText(line, leftX, 188 + index * 82));

  context.fillStyle = "#4b5563";
  context.font = '600 29px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif';
  splitWrappedLines(context, state.subtitle, 680, 2).forEach((line, index) => {
    context.fillText(line, leftX, 352 + index * 40);
  });

  context.fillStyle = "#111827";
  context.font = '800 34px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif';
  context.fillText(state.dose || "", leftX, 475);
  context.fillStyle = "#6b7280";
  context.font = '700 26px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif';
  context.fillText(state.quantity || "", leftX, 520);

  const legalLines = (state.koreanLabelLines || []).filter(Boolean).slice(0, 5);
  context.fillStyle = "#374151";
  context.font = '500 21px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif';
  legalLines.forEach((line, index) => {
    const clipped = String(line).length > 58 ? `${String(line).slice(0, 57)}…` : String(line);
    context.fillText(clipped, leftX, 582 + index * 29);
  });

  const rightX = splitX + 42;
  const rightWidth = width - rightX - 48;
  context.fillStyle = "#111827";
  context.font = '900 45px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif';
  context.fillText("전체 가격 구조", rightX, 92);

  const priceRows = extractPriceRows(state.priceStructureLines);
  let y = 140;
  let renderedRows = 0;
  for (const row of priceRows) {
    if (y > height - 46 || renderedRows >= 13) break;
    if (row.detail) {
      context.fillStyle = "#6b7280";
      context.font = '500 18px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif';
      const clipped = row.text.length > 62 ? `${row.text.slice(0, 61)}…` : row.text;
      context.fillText(`· ${clipped}`, rightX + 16, y);
      y += 25;
      continue;
    }
    const separatorIndex = row.text.indexOf(":");
    const name = separatorIndex >= 0 ? row.text.slice(0, separatorIndex).trim() : row.text;
    const amount = separatorIndex >= 0 ? row.text.slice(separatorIndex + 1).trim() : "";
    const isTotal = /총 소비자가|소비자가/.test(name);
    context.fillStyle = "#111827";
    context.font = `${isTotal ? 900 : 700} ${isTotal ? 31 : 24}px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif`;
    context.fillText(name, rightX, y);
    context.textAlign = "right";
    fitText(context, amount, rightWidth * 0.62, isTotal ? 31 : 24, 18, isTotal ? 900 : 700);
    context.fillText(amount, rightX + rightWidth, y);
    context.textAlign = "left";
    context.strokeStyle = isTotal ? "#111827" : "#e5e7eb";
    context.lineWidth = isTotal ? 3 : 1.5;
    context.beginPath();
    context.moveTo(rightX, y + 14);
    context.lineTo(rightX + rightWidth, y + 14);
    context.stroke();
    y += isTotal ? 58 : 46;
    renderedRows += 1;
  }

  context.strokeStyle = "#111827";
  context.lineWidth = 3;
  context.strokeRect(2, 2, width - 4, height - 4);
}

export function createLabelTextureRenderer(gl, providedLabelUrl) {
  const canvas = document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = 740;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable.");
  const texture = createTextureFromCanvas(gl, canvas);
  let refreshSequence = 0;

  const commit = () => updateTexture(gl, texture, canvas);

  async function refresh(state) {
    const sequence = ++refreshSequence;
    if (state.labelMode === "text") {
      drawTextLabel(context, canvas, state);
      commit();
      return;
    }
    if (state.labelMode === "sku") {
      drawSkuLabel(context, canvas, state);
      commit();
      return;
    }

    const requested = state.labelMode === "custom" && state.customLabelImage
      ? state.customLabelImage
      : providedLabelUrl;
    try {
      const image = await loadImage(requested);
      if (sequence !== refreshSequence) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      fitImage(context, image, 12, 12, canvas.width - 24, canvas.height - 24);
      commit();
    } catch (error) {
      if (requested !== providedLabelUrl) {
        const fallback = await loadImage(providedLabelUrl);
        if (sequence !== refreshSequence) return;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        fitImage(context, fallback, 12, 12, canvas.width - 24, canvas.height - 24);
        commit();
        return;
      }
      throw error;
    }
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
