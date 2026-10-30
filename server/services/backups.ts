import crypto from "node:crypto";
import { gzipSync } from "node:zlib";
import { HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createApplicationDataExport } from "../db";
import { encryptBackupArchive } from "../security/crypto";

const GRAPH_ORIGIN = "https://graph.microsoft.com";
const GRAPH_MAX_PAGES = 20;
const GRAPH_MAX_ITEMS = 1_000;

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
  siteUrl?: string;
  siteId: string;
  driveId: string;
  folderPath: string;
};
export type BackupDestinationConfig = S3BackupConfig | SharePointBackupConfig;
export type BackupArchive = { filename: string; plaintext: Buffer; ciphertext: Buffer; checksumSha256: string; bytes: number };
export type SharePointDiscoveryCredentials = Pick<SharePointBackupConfig, "tenantId" | "clientId" | "clientSecret">;
export type SharePointDrive = { id: string; name: string; webUrl: string | null };
export type SharePointFolder = { id: string; name: string; webUrl: string | null };

type GraphCollection<T> = { value?: T[]; "@odata.nextLink"?: string };
type GraphDrive = { id?: string; name?: string; driveType?: string; webUrl?: string };
type GraphDriveItem = { id?: string; name?: string; folder?: unknown; webUrl?: string };

export function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").replace(/\.\./g, "");
}

function encodePastedUrlSegment(segment: string) {
  try {
    return encodeURIComponent(decodeURIComponent(segment));
  } catch {
    throw new Error("Use a valid HTTPS SharePoint site address with valid URL encoding.");
  }
}

function parseSharePointSiteUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Use a valid HTTPS SharePoint site address."); }
  const host = url.hostname.toLowerCase();
  // The application uses Microsoft Graph global-cloud endpoints; reject unsupported sovereign clouds rather than failing later.
  if (url.protocol !== "https:" || !/\.sharepoint\.com$/i.test(host) || url.username || url.password || url.search || url.hash) {
    throw new Error("Use the clean HTTPS address of a global Microsoft 365 SharePoint site, such as https://contoso.sharepoint.com/sites/Finance.");
  }
  const encodedSegments = url.pathname.split("/").filter(Boolean).map(encodePastedUrlSegment);
  const encodedPath = encodedSegments.join("/");
  return {
    siteUrl: `${url.protocol}//${url.host}${encodedPath ? `/${encodedPath}` : "/"}`,
    host: url.host,
    graphPath: encodedPath,
  };
}

function graphFolderPath(value: string) {
  return normalizePath(value).split("/").filter(Boolean).map(segment => encodeURIComponent(segment)).join("/");
}

function trustedGraphUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Microsoft Graph returned an invalid pagination link."); }
  if (url.protocol !== "https:" || url.origin !== GRAPH_ORIGIN || url.username || url.password || !url.pathname.startsWith("/v1.0/")) {
    throw new Error("Microsoft Graph returned an unsafe pagination link.");
  }
  return url.toString();
}

function graphUrl(path: string) {
  return `${GRAPH_ORIGIN}${path}`;
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

async function sharePointToken(config: SharePointDiscoveryCredentials) {
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

async function graphCollection<T>(initialUrl: string, token: string): Promise<T[]> {
  const all: T[] = [];
  let nextUrl: string | null = trustedGraphUrl(initialUrl);
  for (let page = 0; nextUrl && page < GRAPH_MAX_PAGES; page += 1) {
    const payload = await graphRequest(nextUrl, token).then(response => response.json()) as GraphCollection<T>;
    const values = Array.isArray(payload.value) ? payload.value : [];
    if (all.length + values.length > GRAPH_MAX_ITEMS) throw new Error("Microsoft SharePoint returned too many items. Select a more specific site or folder.");
    all.push(...values);
    nextUrl = payload["@odata.nextLink"] ? trustedGraphUrl(payload["@odata.nextLink"]) : null;
  }
  if (nextUrl) throw new Error("Microsoft SharePoint returned too many pages. Select a more specific site or folder.");
  return all;
}

function documentLibraries(items: GraphDrive[]) {
  return items
    .filter(drive => drive.id && drive.name && (drive.driveType === "documentLibrary" || !drive.driveType))
    .map(drive => ({ id: drive.id!, name: drive.name!, webUrl: drive.webUrl ?? null }));
}

async function listSiteDocumentLibraries(siteId: string, token: string) {
  const endpoint = new URL(graphUrl(`/v1.0/sites/${encodeURIComponent(siteId)}/drives`));
  endpoint.searchParams.set("$select", "id,name,driveType,webUrl");
  endpoint.searchParams.set("$top", "100");
  return documentLibraries(await graphCollection<GraphDrive>(endpoint.toString(), token));
}

async function assertDriveBelongsToSite(siteId: string, driveId: string, token: string) {
  const drives = await listSiteDocumentLibraries(siteId, token);
  if (!drives.some(drive => drive.id === driveId)) throw new Error("The selected document library does not belong to the selected SharePoint site or is no longer accessible.");
  return drives;
}

async function assertSharePointFolder(siteId: string, driveId: string, folderPath: string, token: string) {
  await assertDriveBelongsToSite(siteId, driveId, token);
  const encodedFolderPath = graphFolderPath(folderPath);
  const location = encodedFolderPath ? `root:/${encodedFolderPath}` : "root";
  const endpoint = new URL(graphUrl(`/v1.0/drives/${encodeURIComponent(driveId)}/${location}`));
  endpoint.searchParams.set("$select", "id,name,folder");
  const item = await graphRequest(endpoint.toString(), token).then(response => response.json()) as GraphDriveItem;
  if (!item.id || !item.folder) throw new Error("The selected SharePoint backup path is not an accessible folder.");
}

export async function discoverSharePointSite(input: SharePointDiscoveryCredentials & { siteUrl: string }) {
  const site = parseSharePointSiteUrl(input.siteUrl);
  const token = await sharePointToken(input);
  const siteEndpoint = site.graphPath
    ? graphUrl(`/v1.0/sites/${encodeURIComponent(site.host)}:/${site.graphPath}?$select=id,displayName,webUrl`)
    : graphUrl(`/v1.0/sites/${encodeURIComponent(site.host)}?$select=id,displayName,webUrl`);
  const resolved = await graphRequest(siteEndpoint, token).then(response => response.json()) as { id?: string; displayName?: string; webUrl?: string };
  if (!resolved.id) throw new Error("Microsoft Graph did not return a SharePoint site ID for this address.");
  const drives = await listSiteDocumentLibraries(resolved.id, token);
  if (!drives.length) throw new Error("No accessible document libraries were found. Confirm the application has SharePoint site and drive permissions.");
  return { site: { id: resolved.id, name: resolved.displayName ?? site.host, webUrl: resolved.webUrl ?? site.siteUrl }, drives };
}

export async function listSharePointFolders(input: SharePointDiscoveryCredentials & { siteId: string; driveId: string; folderPath?: string | null }) {
  const token = await sharePointToken(input);
  const folderPath = normalizePath(input.folderPath ?? "");
  await assertSharePointFolder(input.siteId, input.driveId, folderPath, token);
  const location = folderPath ? `root:/${graphFolderPath(folderPath)}:/children` : "root/children";
  const endpoint = new URL(graphUrl(`/v1.0/drives/${encodeURIComponent(input.driveId)}/${location}`));
  endpoint.searchParams.set("$select", "id,name,folder,webUrl");
  endpoint.searchParams.set("$orderby", "name");
  endpoint.searchParams.set("$top", "200");
  const folders: SharePointFolder[] = (await graphCollection<GraphDriveItem>(endpoint.toString(), token))
    .filter(item => item.id && item.name && item.folder)
    .map(item => ({ id: item.id!, name: item.name!, webUrl: item.webUrl ?? null }));
  return { folderPath, folders };
}

export function validateBackupDestination(input: BackupDestinationConfig) {
  if (input.provider === "s3") {
    if (!input.bucket.trim() || !input.accessKeyId.trim() || !input.secretAccessKey.trim()) throw new Error("S3 backup bucket, access key, and secret access key are required.");
    return { ...input, endpoint: validPublicHttpsEndpoint(input.endpoint), region: input.region.trim() || "us-east-1", bucket: input.bucket.trim(), accessKeyId: input.accessKeyId.trim(), secretAccessKey: input.secretAccessKey, prefix: normalizePath(input.prefix) };
  }
  if (!input.tenantId.trim() || !input.clientId.trim() || !input.clientSecret.trim() || !input.siteId.trim() || !input.driveId.trim()) throw new Error("SharePoint tenant, client, secret, site ID, and drive ID are required.");
  const resolvedSite = input.siteUrl?.trim() ? parseSharePointSiteUrl(input.siteUrl) : null;
  return { ...input, tenantId: input.tenantId.trim(), clientId: input.clientId.trim(), siteUrl: resolvedSite?.siteUrl, siteId: input.siteId.trim(), driveId: input.driveId.trim(), folderPath: normalizePath(input.folderPath) };
}

export async function testBackupDestination(config: BackupDestinationConfig) {
  const valid = validateBackupDestination(config);
  if (valid.provider === "s3") {
    await s3Client(valid).send(new HeadBucketCommand({ Bucket: valid.bucket }));
    return "S3-compatible bucket access verified.";
  }
  const token = await sharePointToken(valid);
  await assertSharePointFolder(valid.siteId, valid.driveId, valid.folderPath, token);
  return "SharePoint site, document library, and selected backup folder access verified.";
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
  await assertSharePointFolder(config.siteId, config.driveId, config.folderPath, token);
  const path = [normalizePath(config.folderPath), archive.filename].filter(Boolean).join("/");
  const sessionUrl = graphUrl(`/v1.0/sites/${encodeURIComponent(config.siteId)}/drives/${encodeURIComponent(config.driveId)}/root:/${graphFolderPath(path)}:/createUploadSession`);
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
