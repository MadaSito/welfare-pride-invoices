import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

type Counter = { count: number; resetAt: number };
const requestCounters = new Map<string, Counter>();
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 120;
const MAX_TRACKED_COUNTERS = 10_000;

function clientKey(req: Request) {
  const raw = req.ip || req.socket.remoteAddress || "unknown";
  return crypto.createHash("sha256").update(raw).digest("base64url").slice(0, 32);
}

export function requestSecurity(req: Request, res: Response, next: NextFunction) {
  const incoming = typeof req.header("x-request-id") === "string" ? req.header("x-request-id")! : "";
  const correlationId = /^[A-Za-z0-9._-]{8,96}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.locals.correlationId = correlationId;
  res.setHeader("X-Request-ID", correlationId);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  // HTTPS sources and cross-site frame ancestry preserve managed Preview while object/base/form sources stay constrained.
  res.setHeader("Content-Security-Policy", "default-src 'self' https: data: blob:; base-uri 'self'; object-src 'none'; form-action 'self'; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' https: data: blob:; font-src 'self' data:; connect-src 'self' https: wss: ws:; frame-ancestors https:");
  // Do not set X-Frame-Options: Manus Preview is embedded cross-site.
  next();
}

export function apiRateLimit(req: Request, res: Response, next: NextFunction) {
  const key = `${req.path}:${clientKey(req)}`;
  const now = Date.now();
  if (requestCounters.size >= MAX_TRACKED_COUNTERS) {
    for (const [storedKey, storedCounter] of requestCounters) {
      if (storedCounter.resetAt <= now) requestCounters.delete(storedKey);
    }
    while (requestCounters.size >= MAX_TRACKED_COUNTERS) {
      const oldestKey = requestCounters.keys().next().value;
      if (!oldestKey) break;
      requestCounters.delete(oldestKey);
    }
  }
  const current = requestCounters.get(key);
  const counter = !current || current.resetAt <= now ? { count: 0, resetAt: now + WINDOW_MS } : current;
  counter.count += 1;
  requestCounters.set(key, counter);
  res.setHeader("RateLimit-Limit", String(MAX_REQUESTS));
  res.setHeader("RateLimit-Remaining", String(Math.max(0, MAX_REQUESTS - counter.count)));
  if (counter.count > MAX_REQUESTS) {
    res.setHeader("Retry-After", String(Math.ceil((counter.resetAt - now) / 1000)));
    res.status(429).json({ error: "Too many requests. Please retry shortly.", correlationId: res.locals.correlationId });
    return;
  }
  next();
}

export function requestIpHash(req: Request) {
  return clientKey(req);
}
