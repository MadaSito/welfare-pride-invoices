import crypto from "node:crypto";
import { gzipSync } from "node:zlib";
import { HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createApplicationDataExport } from "../db";
import { encryptBackupArchive } from "../security/crypto";

export type S3BackupConfig = {
  provider: "s3";
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
};
export type SharePointBackupConfig = {
  provider: "sharepoint";
  tenantId: string;
  clientId: string;
  clientSecret: string;
  siteId: string;
  driveId: string;
  folderPath: string;
};
export type BackupDestinationConfig = S3BackupConfig | SharePointBackupConfig;
export type BackupArchive = { filename: string; plaintext: Buffer; ciphertext: Buffer; checksumSha256: string; bytes: number };

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").replace(/\.\./g, "");
}

function validPublicHttpsEndpoint(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Use a valid HTTPS S3 endpoint URL."); }
  const host = url.hostname.toLowerCase();
  const privateIpv4 = /^(?:127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host);
  if (url.protocol !== "https:" || host === "localhost" || host.endsWith(".local") || privateIpv4) throw new Error("Backup S3 endpoints must use a public HTTPS hostname.");
  return url.toString().replace(/\/$/, "");
}

function s3Client(config: S3BackupConfig) {
  return new S3Client({ endpoint: validPublicHttpsEndpoint(config.endpoint), region: config.region || "us-east-1", credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, forcePathStyle: true });
}

async function sharePointToken(config: SharePointBackupConfig) {
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  });
  const body = await response.json().catch(() => ({})) as { access_token?: string };
  if (!response.ok || !body.access_token) throw new Error("Microsoft SharePoint authentication failed. Confirm tenant, client, secret, and application permissions.");
  return body.access_token;
}

async function graphRequest(url: string, token: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  if (!response.ok) throw new Error(`Microsoft SharePoint request failed (${response.status}). Review site, drive, folder, and application permissions.`);
  return response;
}

export function validateBackupDestination(input: BackupDestinationConfig) {
  if (input.provider === "s3") {
    if (!input.bucket.trim() || !input.accessKeyId.trim() || !input.secretAccessKey.trim()) throw new Error("S3 backup bucket, access key, and secret access key are required.");
    return { ...input, endpoint: validPublicHttpsEndpoint(input.endpoint), region: input.region.trim() || "us-east-1", bucket: input.bucket.trim(), accessKeyId: input.accessKeyId.trim(), secretAccessKey: input.secretAccessKey, prefix: normalizePath(input.prefix) };
  }
  if (!input.tenantId.trim() || !input.clientId.trim() || !input.clientSecret.trim() || !input.siteId.trim() || !input.driveId.trim()) throw new Error("SharePoint tenant, client, secret, site ID, and drive ID are required.");
  return { ...input, tenantId: input.tenantId.trim(), clientId: input.clientId.trim(), siteId: input.siteId.trim(), driveId: input.driveId.trim(), folderPath: normalizePath(input.folderPath) };
}

export async function testBackupDestination(config: BackupDestinationConfig) {
  const valid = validateBackupDestination(config);
  if (valid.provider === "s3") {
    await s3Client(valid).send(new HeadBucketCommand({ Bucket: valid.bucket }));
    return "S3-compatible bucket access verified.";
  }
  const token = await sharePointToken(valid);
  await graphRequest(`https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(valid.siteId)}/drives/${encodeURIComponent(valid.driveId)}?$select=id,name`, token);
  return "SharePoint site and document library access verified.";
}

export async function buildBackupArchive(): Promise<BackupArchive> {
  const snapshot = await createApplicationDataExport();
  const plaintext = gzipSync(Buffer.from(JSON.stringify(snapshot), "utf8"), { level: 9 });
  const ciphertext = encryptBackupArchive(plaintext);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return { filename: `welfare-pride-invoices-${stamp}.wpbk`, plaintext, ciphertext, checksumSha256: crypto.createHash("sha256").update(ciphertext).digest("hex"), bytes: ciphertext.length };
}

async function uploadSharePoint(config: SharePointBackupConfig, archive: BackupArchive) {
  const token = await sharePointToken(config);
  const path = [normalizePath(config.folderPath), archive.filename].filter(Boolean).join("/");
  const sessionUrl = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(config.siteId)}/drives/${encodeURIComponent(config.driveId)}/root:/${path.split("/").map(encodeURIComponent).join("/")}:/createUploadSession`;
  const created = await graphRequest(sessionUrl, token, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "rename", name: archive.filename } }) });
  const payload = await created.json() as { uploadUrl?: string };
  if (!payload.uploadUrl || !payload.uploadUrl.startsWith("https://")) throw new Error("Microsoft SharePoint did not provide a secure upload session.");
  const chunkBytes = 5 * 1024 * 1024;
  for (let start = 0; start < archive.ciphertext.length; start += chunkBytes) {
    const end = Math.min(start + chunkBytes, archive.ciphertext.length) - 1;
    const chunk = archive.ciphertext.subarray(start, end + 1);
    const body = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer;
    const response = await fetch(payload.uploadUrl, { method: "PUT", headers: { "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${archive.ciphertext.length}` }, body });
    if (![200, 201, 202].includes(response.status)) throw new Error(`Microsoft SharePoint backup upload failed (${response.status}).`);
  }
  return `sharepoint://${config.siteId}/${config.driveId}/${path}`;
}

export async function uploadBackupArchive(config: BackupDestinationConfig, archive: BackupArchive) {
  const valid = validateBackupDestination(config);
  if (valid.provider === "s3") {
    const key = [normalizePath(valid.prefix), archive.filename].filter(Boolean).join("/");
    await s3Client(valid).send(new PutObjectCommand({ Bucket: valid.bucket, Key: key, Body: archive.ciphertext, ContentType: "application/octet-stream", Metadata: { format: "welfare-pride-wpbk-v1", sha256: archive.checksumSha256 } }));
    return `s3://${valid.bucket}/${key}`;
  }
  return uploadSharePoint(valid, archive);
}
