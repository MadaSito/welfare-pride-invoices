import crypto from "node:crypto";

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export function verifyWebhookSignature(rawBody: Buffer, timestamp: string | undefined, signature: string | undefined) {
  const secret = process.env.WEBHOOK_SIGNING_SECRET;
  if (!secret) return { ok: false as const, reason: "Webhook signing is not configured." };
  if (!timestamp || !signature || !/^\d{10,13}$/.test(timestamp)) return { ok: false as const, reason: "Missing or invalid signature headers." };
  const timestampMs = Number(timestamp.length === 10 ? Number(timestamp) * 1000 : Number(timestamp));
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > MAX_CLOCK_SKEW_MS) {
    return { ok: false as const, reason: "Webhook timestamp is outside the allowed replay window." };
  }
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody.toString("utf8")}`).digest("hex");
  const received = signature.replace(/^sha256=/, "");
  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(received, "hex");
  if (expectedBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
    return { ok: false as const, reason: "Webhook signature did not match." };
  }
  return { ok: true as const };
}
