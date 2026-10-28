import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import {
  claimRecurringInvoiceRun,
  completeRecurringInvoiceRun,
  createAuditLog,
  createInvoice,
  getInvoiceByRecurringOccurrence,
  getRecurringInvoiceScheduleByTaskUid,
  linkRecurringInvoiceRun,
  recordRecurringInvoiceExecution,
  recurringOccurrenceKey,
} from "../db";
import { deliverFinalizedInvoice, InvoiceDeliveryError } from "../services/invoiceDelivery";
import { sdk } from "../_core/sdk";

function correlationId(res: Response) {
  return typeof res.locals.correlationId === "string" ? res.locals.correlationId : crypto.randomUUID();
}

function dueDateFrom(issueDate: Date, dueDays: number) {
  const due = new Date(issueDate);
  due.setUTCDate(due.getUTCDate() + dueDays);
  return due;
}

function nextScheduledRunAt(schedule: { cadence: "weekly" | "monthly"; dayOfWeek: number | null; dayOfMonth: number | null; hourUtc: number; minuteUtc: number }, after = new Date()) {
  if (schedule.cadence === "weekly") {
    const target = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate(), schedule.hourUtc, schedule.minuteUtc));
    target.setUTCDate(target.getUTCDate() + ((schedule.dayOfWeek ?? 0) - target.getUTCDay() + 7) % 7);
    if (target.getTime() <= after.getTime()) target.setUTCDate(target.getUTCDate() + 7);
    return target;
  }
  const target = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), schedule.dayOfMonth ?? 1, schedule.hourUtc, schedule.minuteUtc));
  if (target.getTime() <= after.getTime()) target.setUTCMonth(target.getUTCMonth() + 1);
  return target;
}

/**
 * Platform Heartbeat calls this route with an app_session_id JWT. The task UID is
 * resolved through sdk.authenticateRequest and is the only schedule identifier
 * accepted here; request body values are intentionally ignored.
 */
export function registerRecurringInvoiceScheduledRoutes(app: Express) {
  app.post("/api/scheduled/recurring-invoices", async (req: Request, res: Response) => {
    const id = correlationId(res);
    let scheduleId: number | null = null;
    let companyId: number | null = null;
    let occurrenceKey: string | null = null;
    let createdByUserId: number | null = null;
    let schedulerIdentity: Awaited<ReturnType<typeof sdk.authenticateRequest>>;
    try {
      schedulerIdentity = await sdk.authenticateRequest(req);
    } catch {
      res.status(401).json({ error: "Authenticated scheduler identity is required.", correlationId: id });
      return;
    }
    if (!schedulerIdentity.isCron || !schedulerIdentity.taskUid) {
      res.status(401).json({ error: "Authenticated scheduler identity is required.", correlationId: id });
      return;
    }
    try {
      const bundle = await getRecurringInvoiceScheduleByTaskUid(schedulerIdentity.taskUid);
      if (!bundle) {
        // A deleted business row can outlive a platform cancellation momentarily.
        res.status(200).json({ accepted: true, skipped: "schedule_not_found", correlationId: id });
        return;
      }
      const { schedule } = bundle;
      scheduleId = schedule.id;
      companyId = schedule.companyId;
      createdByUserId = schedule.createdByUserId;
      if (bundle.company.archivedAt) {
        res.status(200).json({ accepted: true, skipped: "company_archived", correlationId: id });
        return;
      }
      if (!schedule.isActive) {
        res.status(200).json({ accepted: true, skipped: "schedule_paused", correlationId: id });
        return;
      }

      occurrenceKey = recurringOccurrenceKey(schedule.cadence);
      const claim = await claimRecurringInvoiceRun(schedule.id, occurrenceKey);
      if (!claim.claimed) {
        if (claim.run.status === "running") {
          res.status(503).json({ accepted: false, retry: true, status: "running", correlationId: id });
          return;
        }
        res.status(200).json({ accepted: true, duplicate: true, status: claim.run.status, correlationId: id });
        return;
      }

      let invoice = await getInvoiceByRecurringOccurrence(schedule.companyId, schedule.id, occurrenceKey);
      if (!invoice) {
        const issueDate = new Date();
        invoice = await createInvoice(schedule.companyId, schedule.createdByUserId, {
          contactId: schedule.contactId,
          currency: schedule.currency,
          issueDate,
          dueDate: dueDateFrom(issueDate, schedule.dueDays),
          taxRateBps: schedule.taxRateBps,
          discountRateBps: schedule.discountRateBps,
          notes: schedule.notes,
          terms: schedule.terms,
          paymentInstructions: schedule.paymentInstructions,
          lineItems: bundle.lineItems.map(item => ({
            description: item.description,
            quantity: item.quantity,
            unitPriceCents: item.unitPriceCents,
            taxable: item.taxable,
          })),
          initialStatus: "finalized",
          recurringScheduleId: schedule.id,
          recurringOccurrenceKey: occurrenceKey,
        });
      }
      if (!invoice) throw new Error("Recurring invoice creation did not return a document.");

      await linkRecurringInvoiceRun(schedule.id, occurrenceKey, invoice.invoice.id);
      await recordRecurringInvoiceExecution(schedule.companyId, schedule.id, invoice.invoice.id, nextScheduledRunAt(schedule));
      if (!schedule.autoSend) {
        await completeRecurringInvoiceRun(schedule.id, occurrenceKey, "created", { invoiceId: invoice.invoice.id, note: "Finalized for manual review and send." });
        await createAuditLog({ companyId: schedule.companyId, actorUserId: schedule.createdByUserId, eventType: "recurring_invoice.created", resourceType: "invoice", resourceId: String(invoice.invoice.id), outcome: "success", correlationId: id, metadata: { scheduleId: schedule.id, occurrenceKey, autoSend: false } });
        res.status(200).json({ accepted: true, status: "created", invoiceId: invoice.invoice.id, correlationId: id });
        return;
      }

      if (invoice.invoice.status === "sent") {
        await completeRecurringInvoiceRun(schedule.id, occurrenceKey, "sent", { invoiceId: invoice.invoice.id, note: "Invoice was already sent during an earlier accepted execution." });
        res.status(200).json({ accepted: true, duplicate: true, status: "sent", invoiceId: invoice.invoice.id, correlationId: id });
        return;
      }
      if (invoice.invoice.status === "sending") {
        // Do not issue a second provider call when the prior attempt is uncertain.
        await completeRecurringInvoiceRun(schedule.id, occurrenceKey, "uncertain", { invoiceId: invoice.invoice.id, note: "Invoice remains in sending state; administrator reconciliation is required before any retry." });
        res.status(200).json({ accepted: true, status: "uncertain", invoiceId: invoice.invoice.id, correlationId: id });
        return;
      }
      const delivery = await deliverFinalizedInvoice({ companyId: schedule.companyId, invoiceId: invoice.invoice.id, correlationId: id });
      await completeRecurringInvoiceRun(schedule.id, occurrenceKey, "sent", { invoiceId: invoice.invoice.id, note: "Provider accepted the scheduled PDF invoice." });
      await createAuditLog({ companyId: schedule.companyId, actorUserId: schedule.createdByUserId, eventType: "recurring_invoice.sent", resourceType: "invoice", resourceId: String(invoice.invoice.id), outcome: "success", correlationId: id, metadata: { scheduleId: schedule.id, occurrenceKey, provider: delivery.provider, emailLogId: delivery.emailLogId } });
      res.status(200).json({ accepted: true, status: "sent", invoiceId: invoice.invoice.id, correlationId: id });
    } catch (error) {
      const safeMessage = error instanceof InvoiceDeliveryError ? error.message : "Recurring invoice execution failed safely.";
      const isUncertain = error instanceof InvoiceDeliveryError && error.outcome === "uncertain";
      if (scheduleId !== null && occurrenceKey !== null) {
        const runStatus = isUncertain ? "uncertain" : "failed";
        try { await completeRecurringInvoiceRun(scheduleId, occurrenceKey, runStatus, { note: safeMessage }); } catch { /* Preserve the original safe scheduler failure response. */ }
      }
      if (companyId !== null) {
        try { await createAuditLog({ companyId, actorUserId: createdByUserId, eventType: "recurring_invoice.failed", resourceType: "recurring_invoice_schedule", resourceId: scheduleId ? String(scheduleId) : null, outcome: "failure", correlationId: id, metadata: { occurrenceKey, reason: safeMessage } }); } catch { /* Audit persistence must not expose internal errors. */ }
      }
      console.error("Recurring invoice execution failed", error instanceof Error ? error.message : "unknown error");
      if (isUncertain) {
        res.status(200).json({ accepted: true, status: "uncertain", correlationId: id });
        return;
      }
      res.status(500).json({ error: safeMessage, correlationId: id });
    }
  });
}
