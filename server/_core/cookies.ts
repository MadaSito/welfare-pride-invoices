import type { CookieOptions, Request } from "express";

export function getSessionCookieOptions(_req: Request): CookieOptions {
  const secure = process.env.NODE_ENV === "production" || process.env.FORCE_SECURE_COOKIES === "true";
  return { httpOnly: true, path: "/", sameSite: "lax", secure };
}
