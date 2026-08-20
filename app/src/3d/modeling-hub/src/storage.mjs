import { createReadStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function configuredS3() {
  const bucket = (process.env.AWS_S3_BUCKET_NAME ?? "").trim();
  const endpoint = (process.env.AWS_ENDPOINT_URL ?? "").trim();
  const accessKeyId = (process.env.AWS_ACCESS_KEY_ID ?? "").trim();
  const secretAccessKey = (process.env.AWS_SECRET_ACCESS_KEY ?? "").trim();
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) return null;
  return { bucket, client: new S3Client({ endpoint, region: process.env.AWS_DEFAULT_REGION ?? "auto", forcePathStyle: process.env.AWS_S3_FORCE_PATH_STYLE === "true", credentials: { accessKeyId, secretAccessKey } }) };
}

function safeName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "image";
}

export function createAssetStorage(assetRoot) {
  const root = path.join(assetRoot, "uploads");
  const s3 = configuredS3();
  const metaPath = (id) => path.join(root, `${id}.json`);
  const localPath = (id) => path.join(root, `${id}.bin`);
  const load = async (id) => JSON.parse(await fs.readFile(metaPath(id), "utf8"));
  const save = async (meta) => fs.writeFile(metaPath(meta.id), `${JSON.stringify(meta, null, 2)}\n`, "utf8");

  async function initialise() { await fs.mkdir(root, { recursive: true }); }
  async function createUpload({ filename, contentType, size }) {
    if (!IMAGE_TYPES.has(contentType)) throw new Error("JPEG, PNG, WebP 이미지만 업로드할 수 있습니다.");
    if (!Number.isFinite(size) || size < 1 || size > MAX_IMAGE_BYTES) throw new Error("이미지는 파일당 10MB 이하여야 합니다.");
    const id = randomUUID();
    const key = `modeling-inputs/${id}/${safeName(filename)}`;
    const meta = { id, key, filename: safeName(filename), contentType, size, createdAt: new Date().toISOString(), uploadedAt: null };
    await save(meta);
    if (s3) {
      const uploadUrl = await getSignedUrl(s3.client, new PutObjectCommand({ Bucket: s3.bucket, Key: key, ContentType: contentType, ContentLength: size }), { expiresIn: 900 });
      return { ...meta, uploadUrl, direct: true };
    }
    return { ...meta, uploadUrl: `/api/modeling/uploads/${id}`, direct: false };
  }
  async function putLocal(id, body, contentType) {
    const meta = await load(id);
    if (meta.contentType !== contentType) throw new Error("업로드 Content-Type이 요청과 일치하지 않습니다.");
    if (body.length !== meta.size || body.length > MAX_IMAGE_BYTES) throw new Error("업로드 파일 크기가 요청과 일치하지 않습니다.");
    await fs.writeFile(localPath(id), body);
    meta.uploadedAt = new Date().toISOString();
    await save(meta);
    return meta;
  }
  async function markUploaded(id) {
    const meta = await load(id);
    meta.uploadedAt = new Date().toISOString();
    await save(meta);
    return meta;
  }
  async function imageInputs(ids) {
    const unique = [...new Set(ids)];
    if (unique.length > 4) throw new Error("모델링 입력 이미지는 최대 4장입니다.");
    return Promise.all(unique.map(async (id) => {
      const meta = await load(id);
      if (!meta.uploadedAt) throw new Error("이미지 업로드가 완료되지 않았습니다.");
      let buffer;
      if (s3) {
        const response = await s3.client.send(new GetObjectCommand({ Bucket: s3.bucket, Key: meta.key }));
        const chunks = [];
        for await (const chunk of response.Body) chunks.push(chunk);
        buffer = Buffer.concat(chunks);
      } else {
        buffer = await fs.readFile(localPath(id));
      }
      if (buffer.length > MAX_IMAGE_BYTES) throw new Error("저장된 이미지가 허용 크기를 넘었습니다.");
      return { id, filename: meta.filename, dataUrl: `data:${meta.contentType};base64,${buffer.toString("base64")}` };
    }));
  }
  async function cleanupExpired() {
    if (!existsSync(root)) return 0;
    let removed = 0;
    for (const name of await fs.readdir(root)) {
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -5);
      const meta = await load(id).catch(() => null);
      if (!meta || Date.now() - Date.parse(meta.createdAt) < TTL_MS) continue;
      if (s3 && meta.key) await s3.client.send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: meta.key })).catch(() => undefined);
      await Promise.all([fs.rm(metaPath(id), { force: true }), fs.rm(localPath(id), { force: true })]);
      removed += 1;
    }
    return removed;
  }
  async function publishResult(filePath, jobId) {
    if (!s3) return null;
    const key = `modeling-results/${jobId}/showcase-vial.glb`;
    await s3.client.send(new PutObjectCommand({ Bucket: s3.bucket, Key: key, Body: createReadStream(filePath), ContentType: "model/gltf-binary" }));
    return key;
  }
  return { initialise, createUpload, putLocal, markUploaded, imageInputs, cleanupExpired, publishResult };
}
