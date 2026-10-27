import crypto from "node:crypto";

function getKey() {
  const value = process.env.APP_CONFIG_ENCRYPTION_KEY;
  if (!value) throw new Error("Email configuration encryption is not configured. Set APP_CONFIG_ENCRYPTION_KEY before saving provider credentials.");
  const base64Key = Buffer.from(value, "base64");
  const hexKey = Buffer.from(value, "hex");
  const key = base64Key.length === 32 ? base64Key : hexKey.length === 32 ? hexKey : null;
  if (!key) throw new Error("APP_CONFIG_ENCRYPTION_KEY must be a 32-byte base64 or hexadecimal value.");
  return key;
}

export function isEncryptionConfigured() {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptConfig(payload: Record<string, unknown>) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptConfig<T extends Record<string, unknown>>(stored: string): T {
  const parts = stored.split(".");
  if (parts.length !== 3) throw new Error("Stored provider configuration has an invalid format.");
  const [ivPart, tagPart, encryptedPart] = parts;
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(encryptedPart, "base64url")), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
