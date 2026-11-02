import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ENV } from "./_core/env";

export type StoredAsset = { data: Buffer; contentType: string };

function client() {
  if (!ENV.s3Endpoint || !ENV.s3Bucket || !ENV.s3AccessKeyId || !ENV.s3SecretAccessKey) {
    throw new Error("Object storage is not configured. Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY, or select protected local storage.");
  }
  return new S3Client({ endpoint: ENV.s3Endpoint, region: ENV.s3Region, credentials: { accessKeyId: ENV.s3AccessKeyId, secretAccessKey: ENV.s3SecretAccessKey }, forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false" });
}

function normalizeKey(key: string) {
  const normalized = key.replace(/\\/g, "/").replace(/\0/g, "").split("/").filter(part => part && part !== "." && part !== "..").join("/");
  if (!normalized) throw new Error("Storage key is invalid.");
  return normalized;
}

function uniqueKey(key: string) {
  const normalized = normalizeKey(key);
  const dot = normalized.lastIndexOf(".");
  const suffix = crypto.randomBytes(8).toString("hex");
  return dot < 0 ? `${normalized}_${suffix}` : `${normalized.slice(0, dot)}_${suffix}${normalized.slice(dot)}`;
}

function contentTypeForKey(key: string) {
  const extension = path.extname(key).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}

function localStorageRoot() {
  return path.resolve(ENV.localStoragePath || path.join(process.cwd(), "data", "storage"));
}

function localPathForKey(key: string) {
  const root = localStorageRoot();
  const target = path.resolve(root, normalizeKey(key));
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error("Storage path is invalid.");
  return target;
}

function protectedUrl(key: string) {
  return `/api/assets/${encodeURIComponent(key)}`;
}

export async function storagePut(relKey: string, data: Buffer | Uint8Array | string, contentType = "application/octet-stream") {
  const key = uniqueKey(relKey);
  if (ENV.storageDriver === "local") {
    const target = localPathForKey(key);
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fs.writeFile(target, data, { mode: 0o600 });
    return { key, url: protectedUrl(key), contentType };
  }
  await client().send(new PutObjectCommand({ Bucket: ENV.s3Bucket, Key: key, Body: data, ContentType: contentType }));
  return { key, url: ENV.s3PublicBaseUrl ? `${ENV.s3PublicBaseUrl}/${encodeURIComponent(key)}` : protectedUrl(key), contentType };
}

export async function storageGet(relKey: string) {
  const key = normalizeKey(relKey);
  return { key, url: ENV.storageDriver === "s3" && ENV.s3PublicBaseUrl ? `${ENV.s3PublicBaseUrl}/${encodeURIComponent(key)}` : protectedUrl(key) };
}

export async function storageRead(relKey: string): Promise<StoredAsset | null> {
  const key = normalizeKey(relKey);
  if (ENV.storageDriver === "local") {
    try {
      return { data: await fs.readFile(localPathForKey(key)), contentType: contentTypeForKey(key) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  const signedUrl = await getSignedUrl(client(), new GetObjectCommand({ Bucket: ENV.s3Bucket, Key: key }), { expiresIn: 300 });
  const response = await fetch(signedUrl);
  if (!response.ok) return null;
  return { data: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get("content-type") || contentTypeForKey(key) };
}
