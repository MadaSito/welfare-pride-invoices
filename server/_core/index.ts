import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { registerInvoiceHttpRoutes, registerWebhookRoutes } from "../routes/invoiceRoutes";
import { registerRecurringInvoiceScheduledRoutes } from "../routes/recurringInvoiceRoutes";
import { apiRateLimit, requestSecurity } from "../security/requestSecurity";
import { registerStandaloneAuthRoutes } from "../auth/routes";
import { storageGetSignedUrl } from "../storage";
import { registerBackupRoutes } from "../routes/backupRoutes";
import { authenticateRequest } from "../auth/service";
import { getCompanyAccess } from "../db";

async function startServer() {
  const app = express(); const server = createServer(app); app.disable("x-powered-by"); app.set("trust proxy", 1);
  app.use(requestSecurity); app.use("/api", apiRateLimit); registerWebhookRoutes(app);
  app.use(express.json({ limit: "2mb" })); app.use(express.urlencoded({ limit: "2mb", extended: true }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/assets/*", async (req, res) => { try { const key = String((req.params as Record<string, string>)["0"] ?? ""); const match = /^companies\/(\d+)\/logos\//.exec(key); const session = await authenticateRequest(req); if (!key || !match || !session || session.stage !== "full" || !(await getCompanyAccess(session.user, Number(match[1])))) return res.sendStatus(404); res.redirect(302, await storageGetSignedUrl(key)); } catch { res.sendStatus(404); } });
  registerStandaloneAuthRoutes(app); registerInvoiceHttpRoutes(app); registerRecurringInvoiceScheduledRoutes(app); registerBackupRoutes(app);
  app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));
  if (process.env.NODE_ENV === "development") await setupVite(app, server); else serveStatic(app);
  const port = Number(process.env.PORT || "3000"); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  server.on("error", error => { console.error("Server failed:", error.message); process.exit(1); }); server.listen(port, "0.0.0.0", () => console.log(`Server listening on port ${port}`));
}
startServer().catch(error => { console.error(error); process.exit(1); });
