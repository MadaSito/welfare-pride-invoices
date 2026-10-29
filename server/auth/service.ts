import crypto from "node:crypto";
import { parse as parseCookies } from "cookie";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Request, Response } from "express";
import { authLoginTransactions, companies, companyMembers, userRecoveryCodes, userSessions, users, type User } from "../../drizzle/schema";
import { getDb } from "../db";
import { ENV } from "../_core/env";
import { getSessionCookieOptions } from "../_core/cookies";
import { decryptConfig, encryptConfig } from "../security/crypto";

const SESSION_COOKIE = "wp_invoice_session";
const CSRF_COOKIE = "wp_invoice_csrf";
const DAY = 86_400_000;
const SESSION_DAYS = 12;
const PENDING_MINUTES = 15;
const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export type SessionStage = "full" | "password_change" | "mfa_setup" | "mfa_verify";
export type AuthMethod = "local" | "entra";
export type AuthSession = { id: number; user: User; csrfToken: string; stage: SessionStage; authMethod: AuthMethod };

const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const token = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
const normalEmail = (email: string) => email.trim().toLowerCase();

export function generateTemporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  return Array.from({ length: 22 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
}

export async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const key = crypto.scryptSync(password, salt, 64, { N: 16_384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string | null) {
  if (!encoded) return false;
  const [scheme, n, r, p, salt, value] = encoded.split("$");
  if (scheme !== "scrypt" || !salt || !value) return false;
  const key = crypto.scryptSync(password, salt, 64, { N: Number(n), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(key, Buffer.from(value, "base64url"));
}

function base32Encode(input: Buffer) {
  let bits = 0; let value = 0; let output = "";
  for (const byte of input) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { output += base32Alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) output += base32Alphabet[(value << (5 - bits)) & 31];
  return output;
}
function base32Decode(value: string) {
  let bits = 0; let current = 0; const out: number[] = [];
  for (const char of value.replace(/[=\s-]/g, "").toUpperCase()) { const idx = base32Alphabet.indexOf(char); if (idx < 0) throw new Error("Invalid authenticator secret"); current = (current << 5) | idx; bits += 5; if (bits >= 8) { out.push((current >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
function totpCode(secret: string, at = Date.now()) {
  const counter = Math.floor(at / 30_000); const counterBuffer = Buffer.alloc(8); counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", base32Decode(secret)).update(counterBuffer).digest(); const offset = digest[digest.length - 1] & 15;
  const value = ((digest[offset] & 127) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(value % 1_000_000).padStart(6, "0");
}
export function verifyTotp(secret: string, code: string) { return [-30_000, 0, 30_000].some(offset => crypto.timingSafeEqual(Buffer.from(totpCode(secret, Date.now() + offset)), Buffer.from(code.trim()))); }

async function dbRequired() { const db = await getDb(); if (!db) throw new Error("Database is unavailable"); return db; }

async function createSession(user: User, stage: SessionStage, authMethod: AuthMethod, req: Request, res: Response) {
  const db = await dbRequired(); const raw = token(); const csrf = token(); const pending = stage !== "full";
  const expiresAt = new Date(Date.now() + (pending ? PENDING_MINUTES * 60_000 : SESSION_DAYS * DAY));
  await db.insert(userSessions).values({ tokenHash: hash(raw), csrfHash: hash(csrf), userId: user.id, sessionVersion: user.sessionVersion, stage, authMethod, expiresAt });
  const options = getSessionCookieOptions(req);
  res.cookie(SESSION_COOKIE, raw, { ...options, maxAge: expiresAt.getTime() - Date.now() });
  res.cookie(CSRF_COOKIE, csrf, { ...options, httpOnly: false, maxAge: expiresAt.getTime() - Date.now() });
  return { stage, expiresAt };
}

export function clearSessionCookies(req: Request, res: Response) { const options = getSessionCookieOptions(req); res.clearCookie(SESSION_COOKIE, options); res.clearCookie(CSRF_COOKIE, { ...options, httpOnly: false }); }

export async function authenticateRequest(req: Request): Promise<AuthSession | null> {
  const raw = parseCookies(req.headers.cookie ?? "")[SESSION_COOKIE]; if (!raw) return null;
  const db = await dbRequired(); const now = new Date();
  const row = (await db.select({ session: userSessions, user: users }).from(userSessions).innerJoin(users, eq(users.id, userSessions.userId)).where(and(eq(userSessions.tokenHash, hash(raw)), isNull(userSessions.revokedAt), gt(userSessions.expiresAt, now), eq(users.accountStatus, "active"))).limit(1))[0];
  if (!row || row.session.sessionVersion !== row.user.sessionVersion) return null;
  void db.update(userSessions).set({ lastSeenAt: now }).where(eq(userSessions.id, row.session.id));
  return { id: row.session.id, user: row.user, csrfToken: parseCookies(req.headers.cookie ?? "")[CSRF_COOKIE] ?? "", stage: row.session.stage, authMethod: row.session.authMethod };
}

export async function requireCsrf(req: Request, session: AuthSession) {
  const supplied = req.headers["x-wp-csrf-token"]; const value = Array.isArray(supplied) ? supplied[0] : supplied;
  const db = await dbRequired(); const current = (await db.select({ csrfHash: userSessions.csrfHash }).from(userSessions).where(eq(userSessions.id, session.id)).limit(1))[0];
  if (!value || !current || !crypto.timingSafeEqual(Buffer.from(hash(value)), Buffer.from(current.csrfHash))) throw new Error("Invalid request verification token");
}

export async function localLogin(email: string, password: string, req: Request, res: Response) {
  const db = await dbRequired(); const user = (await db.select().from(users).where(eq(users.normalizedEmail, normalEmail(email))).limit(1))[0];
  if (!user || user.accountStatus !== "active" || !["local", "hybrid"].includes(user.authProvider) || !(await verifyPassword(password, user.passwordHash))) throw new Error("Invalid email or password");
  await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, user.id));
  const stage: SessionStage = user.mustChangePassword ? "password_change" : user.mfaEnabled ? "mfa_verify" : "mfa_setup";
  await createSession(user, stage, "local", req, res); return { next: stage, user: { name: user.name, email: user.email } };
}

async function sessionForStage(req: Request, allowed: SessionStage[]) { const session = await authenticateRequest(req); if (!session || !allowed.includes(session.stage)) throw new Error("Your sign-in step has expired. Sign in again."); return session; }
export async function changeOwnPassword(password: string, req: Request, res: Response) { const session = await sessionForStage(req, ["password_change"]); if (password.length < 14) throw new Error("Use at least 14 characters for your password."); const db = await dbRequired(); const passwordHash = await hashPassword(password); await db.update(users).set({ passwordHash, mustChangePassword: false, sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, session.user.id)); const user = (await db.select().from(users).where(eq(users.id, session.user.id)).limit(1))[0]!; await db.update(userSessions).set({ revokedAt: new Date() }).where(eq(userSessions.userId, user.id)); await createSession(user, "mfa_setup", "local", req, res); return { next: "mfa_setup" as const }; }
export async function beginMfaEnrollment(req: Request) { const session = await sessionForStage(req, ["mfa_setup"]); const db = await dbRequired(); let secret: string; if (session.user.mfaSecretEncrypted) secret = decryptConfig<{ secret: string }>(session.user.mfaSecretEncrypted).secret; else { secret = base32Encode(crypto.randomBytes(20)); await db.update(users).set({ mfaSecretEncrypted: encryptConfig({ secret }) }).where(eq(users.id, session.user.id)); }
  const label = encodeURIComponent(`Welfare Pride Invoices:${session.user.email ?? session.user.id}`); return { secret, otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent("Welfare Pride Invoices")}&algorithm=SHA1&digits=6&period=30` }; }
export async function confirmMfaEnrollment(code: string, req: Request, res: Response) { const session = await sessionForStage(req, ["mfa_setup"]); const secret = session.user.mfaSecretEncrypted ? decryptConfig<{ secret: string }>(session.user.mfaSecretEncrypted).secret : null; if (!secret || !verifyTotp(secret, code)) throw new Error("That authenticator code is not valid."); const db = await dbRequired(); const recovery = Array.from({ length: 8 }, () => token(6).toUpperCase()); await db.transaction(async tx => { await tx.update(users).set({ mfaEnabled: true, mfaEnrolledAt: new Date(), sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, session.user.id)); await tx.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, session.user.id)); await tx.insert(userRecoveryCodes).values(recovery.map(code => ({ userId: session.user.id, codeHash: hash(code) }))); await tx.update(userSessions).set({ revokedAt: new Date() }).where(eq(userSessions.userId, session.user.id)); }); const user = (await db.select().from(users).where(eq(users.id, session.user.id)).limit(1))[0]!; await createSession(user, "full", "local", req, res); return { recoveryCodes: recovery }; }
export async function verifyMfa(code: string, req: Request, res: Response) { const session = await sessionForStage(req, ["mfa_verify"]); const db = await dbRequired(); const secret = session.user.mfaSecretEncrypted ? decryptConfig<{ secret: string }>(session.user.mfaSecretEncrypted).secret : null; let valid = Boolean(secret && verifyTotp(secret, code)); if (!valid) { const recovery = (await db.select().from(userRecoveryCodes).where(and(eq(userRecoveryCodes.userId, session.user.id), isNull(userRecoveryCodes.usedAt)))); const matched = recovery.find(item => crypto.timingSafeEqual(Buffer.from(item.codeHash), Buffer.from(hash(code.trim().toUpperCase())))); if (matched) { await db.update(userRecoveryCodes).set({ usedAt: new Date() }).where(eq(userRecoveryCodes.id, matched.id)); valid = true; } }
  if (!valid) throw new Error("That verification code is not valid."); await db.update(userSessions).set({ revokedAt: new Date() }).where(eq(userSessions.id, session.id)); await createSession(session.user, "full", "local", req, res); return { success: true }; }

export async function logout(req: Request, res: Response) { const session = await authenticateRequest(req); if (session) { const db = await dbRequired(); await db.update(userSessions).set({ revokedAt: new Date() }).where(eq(userSessions.id, session.id)); } clearSessionCookies(req, res); }

async function entraDiscovery() { const tenant = ENV.entraTenantId; if (!tenant || !ENV.entraClientId || !ENV.entraClientSecret || !ENV.appOrigin) throw new Error("Microsoft Entra ID sign-in is not configured."); const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/v2.0/.well-known/openid-configuration`); if (!response.ok) throw new Error("Microsoft Entra ID discovery failed."); return response.json() as Promise<{ authorization_endpoint: string; token_endpoint: string; jwks_uri: string; issuer: string }>; }
export async function startEntraLogin(req: Request, res: Response) { const db = await dbRequired(); const discovery = await entraDiscovery(); const state = token(); const nonce = token(); const verifier = token(48); const challenge = crypto.createHash("sha256").update(verifier).digest("base64url"); await db.insert(authLoginTransactions).values({ stateHash: hash(state), nonce, codeVerifier: verifier, expiresAt: new Date(Date.now() + 10 * 60_000) }); const url = new URL(discovery.authorization_endpoint); url.searchParams.set("client_id", ENV.entraClientId); url.searchParams.set("response_type", "code"); url.searchParams.set("redirect_uri", `${ENV.appOrigin}/api/auth/entra/callback`); url.searchParams.set("response_mode", "query"); url.searchParams.set("scope", "openid profile email"); url.searchParams.set("state", state); url.searchParams.set("nonce", nonce); url.searchParams.set("code_challenge", challenge); url.searchParams.set("code_challenge_method", "S256"); res.redirect(302, url.toString()); }
export async function completeEntraLogin(code: string, state: string, req: Request, res: Response) { const db = await dbRequired(); const transaction = (await db.select().from(authLoginTransactions).where(and(eq(authLoginTransactions.stateHash, hash(state)), isNull(authLoginTransactions.consumedAt), gt(authLoginTransactions.expiresAt, new Date()))).limit(1))[0]; if (!transaction) throw new Error("The Entra sign-in request expired. Start again."); await db.update(authLoginTransactions).set({ consumedAt: new Date() }).where(eq(authLoginTransactions.id, transaction.id)); const discovery = await entraDiscovery(); const params = new URLSearchParams({ client_id: ENV.entraClientId, client_secret: ENV.entraClientSecret, grant_type: "authorization_code", code, redirect_uri: `${ENV.appOrigin}/api/auth/entra/callback`, code_verifier: transaction.codeVerifier }); const tokenResponse = await fetch(discovery.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: params }); if (!tokenResponse.ok) throw new Error("Microsoft Entra ID token exchange failed."); const tokens = await tokenResponse.json() as { id_token?: string }; if (!tokens.id_token) throw new Error("Microsoft Entra ID did not return an identity token."); const jwks = createRemoteJWKSet(new URL(discovery.jwks_uri)); const verified = await jwtVerify(tokens.id_token, jwks, { issuer: discovery.issuer, audience: ENV.entraClientId }); const claims = verified.payload as Record<string, unknown>; if (claims.nonce !== transaction.nonce) throw new Error("Microsoft Entra ID nonce validation failed."); const tenantId = String(claims.tid ?? ""); const objectId = String(claims.oid ?? ""); const email = normalEmail(String(claims.preferred_username ?? claims.email ?? "")); if (!tenantId || tenantId !== ENV.entraTenantId || !objectId || !email) throw new Error("Microsoft Entra ID claims are incomplete."); const user = (await db.select().from(users).where(eq(users.normalizedEmail, email)).limit(1))[0]; if (!user || user.accountStatus !== "active" || !["entra", "hybrid"].includes(user.authProvider)) throw new Error("This Entra account has not been provisioned for Welfare Pride Invoices."); if (user.entraTenantId && (user.entraTenantId !== tenantId || user.entraObjectId !== objectId)) throw new Error("This Entra identity is not linked to the provisioned account."); await db.update(users).set({ entraTenantId: tenantId, entraObjectId: objectId, lastSignedIn: new Date(), loginMethod: "entra" }).where(eq(users.id, user.id)); const refreshed = (await db.select().from(users).where(eq(users.id, user.id)).limit(1))[0]!; await createSession(refreshed, "full", "entra", req, res); }

export async function bootstrapLocalAdmin(password: string) { const db = await dbRequired(); const email = "admin@welfarepride.local"; const existing = (await db.select().from(users).where(eq(users.normalizedEmail, email)).limit(1))[0]; if (existing) return { created: false, email }; const passwordHash = await hashPassword(password); await db.transaction(async tx => { const insert = await tx.insert(users).values({ openId: `local:${email}`, name: "Welfare Pride Administrator", email, normalizedEmail: email, loginMethod: "local", authProvider: "local", accountStatus: "active", passwordHash, mustChangePassword: true, mfaRequired: true, role: "admin" }); const userId = Number(insert[0].insertId); const company = (await tx.select().from(companies).where(eq(companies.slug, "welfare-pride")).limit(1))[0]; if (company) await tx.insert(companyMembers).values({ companyId: company.id, userId, role: "platform_admin" }); }); return { created: true, email }; }

export async function listManagedUsers() { const db = await dbRequired(); return db.select({ id: users.id, name: users.name, email: users.email, authProvider: users.authProvider, accountStatus: users.accountStatus, mustChangePassword: users.mustChangePassword, mfaEnabled: users.mfaEnabled, role: users.role, lastSignedIn: users.lastSignedIn, createdAt: users.createdAt }).from(users).orderBy(desc(users.createdAt)); }
export async function createManagedUser(input: { name: string; email: string; provider: "local" | "entra"; globalAdmin: boolean }) { const db = await dbRequired(); const email = normalEmail(input.email); const exists = (await db.select({ id: users.id }).from(users).where(eq(users.normalizedEmail, email)).limit(1))[0]; if (exists) throw new Error("An account with this email already exists."); const temporaryPassword = input.provider === "local" ? generateTemporaryPassword() : null; const passwordHash = temporaryPassword ? await hashPassword(temporaryPassword) : null; const result = await db.insert(users).values({ openId: `${input.provider}:pending:${token(12)}`, name: input.name.trim() || null, email, normalizedEmail: email, loginMethod: input.provider, authProvider: input.provider, accountStatus: "active", passwordHash, mustChangePassword: input.provider === "local", mfaRequired: input.provider === "local", role: input.globalAdmin ? "admin" : "user" }); return { userId: Number(result[0].insertId), temporaryPassword }; }
export async function setManagedUserStatus(userId: number, enabled: boolean) { const db = await dbRequired(); await db.transaction(async tx => { await tx.update(users).set({ accountStatus: enabled ? "active" : "disabled", sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, userId)); await tx.update(userSessions).set({ revokedAt: new Date() }).where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt))); }); }
export async function resetManagedPassword(userId: number) { const db = await dbRequired(); const temporaryPassword = generateTemporaryPassword(); await db.transaction(async tx => { await tx.update(users).set({ passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true, sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, userId)); await tx.update(userSessions).set({ revokedAt: new Date() }).where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt))); }); return temporaryPassword; }
export async function resetManagedMfa(userId: number) { const db = await dbRequired(); await db.transaction(async tx => { await tx.update(users).set({ mfaEnabled: false, mfaSecretEncrypted: null, mfaEnrolledAt: null, sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, userId)); await tx.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, userId)); await tx.update(userSessions).set({ revokedAt: new Date() }).where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt))); }); }
export async function revokeManagedSessions(userId: number) { const db = await dbRequired(); await db.transaction(async tx => { await tx.update(users).set({ sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, userId)); await tx.update(userSessions).set({ revokedAt: new Date() }).where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt))); }); }
