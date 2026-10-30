import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { authenticateRequest } from "../auth/service";
import { completeBackupRun, createApplicationDataExport, createBackupRun, createAuditLog } from "../db";
import { requestIpHash } from "../security/requestSecurity";

function correlationId(res: Response) { return typeof res.locals.correlationId === "string" ? res.locals.correlationId : crypto.randomUUID(); }

/** Local export remains deliberately credential-free. Cloud backups use the separately encrypted backup service. */
export function registerBackupRoutes(app: Express) {
  app.get("/api/admin/backups/export", async (req: Request, res: Response) => {
    const session = await authenticateRequest(req).catch(() => null);
    if (!session || session.stage !== "full" || session.user.role !== "admin") {
      res.status(403).json({ error: "Platform administrator access is required for application exports." });
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `welfare-pride-invoices-export-${stamp}.json`;
    let runId: number | null = null;
    try {
      runId = await createBackupRun({ initiatedByUserId: session.user.id, operation: "local_export", filename });
      const snapshot = await createApplicationDataExport();
      const body = Buffer.from(JSON.stringify(snapshot, null, 2), "utf8");
      const checksum = crypto.createHash("sha256").update(body).digest("hex");
      await completeBackupRun(runId, { status: "succeeded", checksumSha256: checksum, sizeBytes: body.length, summary: "Credential-free local JSON export downloaded by platform administrator." });
      await createAuditLog({ actorUserId: session.user.id, eventType: "backup.local_export.downloaded", resourceType: "backup_run", resourceId: String(runId), outcome: "success", correlationId: correlationId(res), ipHash: requestIpHash(req), metadata: { checksumSha256: checksum, bytes: body.length } });
      res.setHeader("Cache-Control", "private, no-store, max-age=0");
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(body);
    } catch (error) {
      if (runId !== null) await completeBackupRun(runId, { status: "failed", summary: "Local export could not be generated." }).catch(() => undefined);
      await createAuditLog({ actorUserId: session.user.id, eventType: "backup.local_export.failed", resourceType: "backup_run", resourceId: runId ? String(runId) : null, outcome: "failure", correlationId: correlationId(res), ipHash: requestIpHash(req) }).catch(() => undefined);
      res.status(500).json({ error: "The local export could not be generated." });
    }
  });
}
