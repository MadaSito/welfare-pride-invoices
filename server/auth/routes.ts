import type { Express, Request, Response } from "express";
import { authenticateRequest, beginMfaEnrollment, changeOwnPassword, completeEntraLogin, confirmMfaEnrollment, localLogin, logout, requireCsrf, startEntraLogin, verifyMfa } from "./service";

function text(input: unknown) { return typeof input === "string" ? input : ""; }
function safeError(res: Response, error: unknown, fallback: string, status = 400) {
  const message = error instanceof Error ? error.message : fallback;
  res.status(status).json({ error: message.length <= 240 ? message : fallback });
}

async function requireAuthenticatedCsrf(req: Request) {
  const session = await authenticateRequest(req);
  if (!session) throw new Error("Authentication is required.");
  await requireCsrf(req, session);
}

export function registerStandaloneAuthRoutes(app: Express) {
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try { res.json(await localLogin(text(req.body?.email), text(req.body?.password), req, res)); }
    catch (error) { safeError(res, error, "Unable to sign in.", 401); }
  });
  app.post("/api/auth/change-password", async (req, res) => {
    try { await requireAuthenticatedCsrf(req); res.json(await changeOwnPassword(text(req.body?.password), req, res)); }
    catch (error) { safeError(res, error, "Unable to change password."); }
  });
  app.post("/api/auth/mfa/setup", async (req, res) => {
    try { await requireAuthenticatedCsrf(req); res.json(await beginMfaEnrollment(req)); }
    catch (error) { safeError(res, error, "Unable to prepare MFA enrollment.", 401); }
  });
  app.post("/api/auth/mfa/confirm", async (req, res) => {
    try { await requireAuthenticatedCsrf(req); res.json(await confirmMfaEnrollment(text(req.body?.code), req, res)); }
    catch (error) { safeError(res, error, "Unable to confirm MFA.", 401); }
  });
  app.post("/api/auth/mfa/verify", async (req, res) => {
    try { await requireAuthenticatedCsrf(req); res.json(await verifyMfa(text(req.body?.code), req, res)); }
    catch (error) { safeError(res, error, "Unable to verify MFA.", 401); }
  });
  app.post("/api/auth/logout", async (req, res) => { try { await requireAuthenticatedCsrf(req); await logout(req, res); res.json({ success: true }); } catch (error) { safeError(res, error, "Unable to sign out.", 403); } });
  app.get("/api/auth/entra/login", async (req, res) => { try { await startEntraLogin(req, res); } catch (error) { safeError(res, error, "Welfare Pride Single Sign On is unavailable.", 503); } });
  app.get("/api/auth/entra/callback", async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : ""; const state = typeof req.query.state === "string" ? req.query.state : "";
    try { if (!code || !state) throw new Error("The Entra response is incomplete."); await completeEntraLogin(code, state, req, res); res.redirect(302, "/"); }
    catch (error) { console.error("Welfare Pride SSO sign-in failed", error instanceof Error ? error.message : "unknown"); res.redirect(302, "/?auth_error=entra"); }
  });
}
