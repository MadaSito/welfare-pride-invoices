import crypto from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ENV } from "./_core/env";

function client() { if (!ENV.s3Endpoint || !ENV.s3Bucket || !ENV.s3AccessKeyId || !ENV.s3SecretAccessKey) throw new Error("Object storage is not configured. Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY."); return new S3Client({ endpoint: ENV.s3Endpoint, region: ENV.s3Region, credentials: { accessKeyId: ENV.s3AccessKeyId, secretAccessKey: ENV.s3SecretAccessKey }, forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false" }); }
function normalizeKey(key: string) { return key.replace(/^\/+/, "").replace(/\.\./g, ""); }
function uniqueKey(key: string) { const normalized = normalizeKey(key); const dot = normalized.lastIndexOf("."); const suffix = crypto.randomBytes(8).toString("hex"); return dot < 0 ? `${normalized}_${suffix}` : `${normalized.slice(0, dot)}_${suffix}${normalized.slice(dot)}`; }
export async function storagePut(relKey: string, data: Buffer | Uint8Array | string, contentType = "application/octet-stream") { const key = uniqueKey(relKey); await client().send(new PutObjectCommand({ Bucket: ENV.s3Bucket, Key: key, Body: data, ContentType: contentType })); return { key, url: ENV.s3PublicBaseUrl ? `${ENV.s3PublicBaseUrl}/${encodeURIComponent(key)}` : `/api/assets/${encodeURIComponent(key)}` }; }
export async function storageGet(relKey: string) { const key = normalizeKey(relKey); return { key, url: ENV.s3PublicBaseUrl ? `${ENV.s3PublicBaseUrl}/${encodeURIComponent(key)}` : `/api/assets/${encodeURIComponent(key)}` }; }
export async function storageGetSignedUrl(relKey: string) { const key = normalizeKey(relKey); return getSignedUrl(client(), new GetObjectCommand({ Bucket: ENV.s3Bucket, Key: key }), { expiresIn: 300 }); }
