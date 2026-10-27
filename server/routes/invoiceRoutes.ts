import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import express from "express";
import { getCompanyAccess, getInvoiceBundle, createAuditLog, recordWebhookEvent } from "../db";
import { invoicePdfFilename, renderInvoicePdf } from "../services/pdf";
import { verifyWebhookSignature } from "../security/hmac";
import { requestIpHash } from "../security/requestSecurity";
import { sdk } from "../_core/sdk";

function correlationId(res: Response) {
  return typeof res.locals.correlationId === "string" ? res.locals.correlationId : crypto.randomUUID();
}

export function registerInvoiceHttpRoutes(app: Express) {
  app.get("/api/invoices/:invoiceId/pdf", async (req: Request, res: Response) => {
    const invoiceId = Number(req.params.invoiceId);
    const companyId = Number(req.query.companyId);
    if (!Number.isInteger(invoiceId) || !Number.isInteger(companyId)) {
      res.status(400).json({ error: "A valid invoiceId and companyId are required." });
      return;
    }
    try {
      let user;
      try {
        user = await sdk.authenticateRequest(req);
      } catch {
        res.status(401).json({ error: "Authentication is required to download this invoice.", correlationId: correlationId(res) });
        return;
      }
      if (!user || !(await getCompanyAccess(user, companyId))) {
        res.status(403).json({ error: "You do not have permission to download this invoice." });
        return;
      }
      const bundle = await getInvoiceBundle(companyId, invoiceId);
      if (!bundle) {
        res.status(404).json({ error: "Invoice not found." });
        return;
      }
      const pdf = await renderInvoicePdf(bundle);
      await createAuditLog({
        companyId,
        actorUserId: user.id,
        eventType: "invoice.pdf.downloaded",
        resourceType: "invoice",
        resourceId: String(invoiceId),
        outcome: "success",
        correlationId: correlationId(res),
        ipHash: requestIpHash(req),
      });
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${invoicePdfFilename(bundle.invoice.invoiceNumber)}"`);
      res.send(pdf);
    } catch (error) {
      console.error("PDF generation failed", error instanceof Error ? error.message : "unknown error");
      res.status(500).json({ error: "The invoice PDF could not be generated.", correlationId: correlationId(res) });
    }
  });
}

export function registerWebhookRoutes(app: Express) {
  app.post("/api/webhooks/delivery", express.raw({ type: "application/json", limit: "1mb" }), async (req: Request, res: Response) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const id = correlationId(res);
    const verification = verifyWebhookSignature(rawBody, req.header("x-wp-timestamp"), req.header("x-wp-signature"));
    const digest = crypto.createHash("sha256").update(rawBody).digest("hex");
    let parsed: { id?: string; eventId?: string } = {};
    try { parsed = JSON.parse(rawBody.toString("utf8")) as { id?: string; eventId?: string }; } catch { /* recorded as rejected below */ }
    let recorded = false;
    try {
      recorded = await recordWebhookEvent({
        provider: "delivery",
        eventId: parsed.id || parsed.eventId || null,
        eventKey: parsed.id || parsed.eventId || digest,
        status: verification.ok ? "accepted" : "rejected",
        correlationId: id,
        payloadDigest: digest,
        note: verification.ok ? "Verified HMAC-SHA256 payload." : verification.reason,
      });
    } catch (error) {
      console.error("Webhook audit persistence failed", error instanceof Error ? error.message : "unknown error");
    }
    if (!verification.ok) {
      res.status(401).json({ error: "Webhook verification failed.", correlationId: id });
      return;
    }
    res.status(recorded ? 202 : 200).json({ accepted: true, duplicate: !recorded, correlationId: id });
  });
}
