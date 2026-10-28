import {
  allocateInvoiceNumberForSending,
  completeEmailLog,
  getEmailProviderConfig,
  getInvoiceBundle,
  setInvoiceStatus,
  startInvoiceDeliveryLog,
} from "../db";
import { decryptConfig } from "../security/crypto";
import { escapeHtml, sendProviderEmail, type ProviderConfig } from "./mailer";
import { invoicePdfFilename, renderInvoicePdf } from "./pdf";

export class InvoiceDeliveryError extends Error {
  constructor(message: string, public readonly provider?: string, public readonly emailLogId?: number | null, public readonly outcome?: "uncertain") {
    super(message);
    this.name = "InvoiceDeliveryError";
  }
}

/**
 * Delivers a finalized invoice exactly once per successful state claim. The caller
 * is responsible for authorization; this service is shared by interactive and
 * authenticated scheduler execution. The tenant sequence is allocated only after
 * the document is claimed for sending, so drafts and finalized review documents
 * never consume a financial number.
 */
export async function deliverFinalizedInvoice(input: {
  companyId: number;
  invoiceId: number;
  correlationId: string;
}) {
  const initial = await getInvoiceBundle(input.companyId, input.invoiceId);
  if (!initial) throw new InvoiceDeliveryError("Invoice not found.");
  if (initial.invoice.status !== "finalized") {
    throw new InvoiceDeliveryError("Only finalized invoices can be sent. Drafts must be finalized first, and sent or paid invoices cannot be delivered again.");
  }
  if (!initial.contact.email) throw new InvoiceDeliveryError("This client needs an email address before the invoice can be sent.");

  const configuration = await getEmailProviderConfig(input.companyId);
  if (!configuration || !configuration.isActive) {
    throw new InvoiceDeliveryError("An administrator must configure a delivery provider before invoices can be sent.");
  }

  let provider: ProviderConfig;
  try {
    provider = decryptConfig<ProviderConfig>(configuration.encryptedConfig);
  } catch {
    throw new InvoiceDeliveryError("Delivery credentials are unavailable. Ask an administrator to save the provider configuration again.", configuration.provider);
  }

  let logId: number | null = null;
  let providerDispatchStarted = false;
  try {
    // The conditional state claim prevents concurrent sends. The number allocator
    // then increments one company counter inside its own guarded transaction.
    await setInvoiceStatus(input.companyId, input.invoiceId, "sending", "finalized");
    const numbered = await allocateInvoiceNumberForSending(input.companyId, input.invoiceId);
    if (!numbered) throw new Error("Invoice number allocation returned no document.");
    const subject = `Invoice ${numbered.invoice.invoiceNumber} from ${numbered.company.name}`;
    logId = await startInvoiceDeliveryLog({
      companyId: input.companyId,
      invoiceId: input.invoiceId,
      provider: configuration.provider,
      recipient: numbered.contact.email!,
      bcc: numbered.company.defaultBcc,
      subject,
      correlationId: input.correlationId,
    });
    const pdf = await renderInvoicePdf(numbered);
    const total = new Intl.NumberFormat("en-US", { style: "currency", currency: numbered.invoice.currency }).format(numbered.invoice.totalCents / 100);
    const clientName = escapeHtml(numbered.contact.contactName || numbered.contact.companyName);
    // A network error or a crash after this point cannot prove that the provider
    // did not accept the message. Keep the invoice in sending/uncertain instead
    // of reissuing an automatic email on retry.
    await completeEmailLog(logId, "uncertain", "Provider dispatch started; awaiting a confirmed acceptance response.");
    providerDispatchStarted = true;
    await sendProviderEmail(provider, {
      to: numbered.contact.email!,
      bcc: numbered.company.defaultBcc,
      subject,
      html: `<p>Hello ${clientName},</p><p>Please find invoice <strong>${escapeHtml(numbered.invoice.invoiceNumber)}</strong> attached. The amount due is <strong>${escapeHtml(total)}</strong>.</p><p>Thank you,<br/>${escapeHtml(numbered.company.name)}</p>`,
      attachment: { filename: invoicePdfFilename(numbered.invoice.invoiceNumber), content: pdf },
    });
    await completeEmailLog(logId, "sent", "Provider accepted the email with PDF attachment.");
    const updated = await setInvoiceStatus(input.companyId, input.invoiceId, "sent", "sending");
    return { invoice: updated, provider: configuration.provider, emailLogId: logId };
  } catch (error) {
    const failureSummary = error instanceof Error ? error.message : "Delivery failed.";
    if (logId !== null && providerDispatchStarted) {
      try { await completeEmailLog(logId, "uncertain", "Provider outcome is uncertain after dispatch began. An administrator must reconcile this attempt before retrying."); } catch { /* The sending state remains the safe duplicate-prevention barrier. */ }
      if (error instanceof InvoiceDeliveryError) throw error;
      throw new InvoiceDeliveryError("The provider outcome is uncertain. No automatic resend was performed; a company administrator must reconcile the delivery log.", configuration.provider, logId, "uncertain");
    }
    // The provider was never contacted, so this is a known-safe pre-dispatch
    // failure. Return the invoice to finalized; its allocated number is retained.
    try { await setInvoiceStatus(input.companyId, input.invoiceId, "finalized", "sending"); } catch { /* A completed or concurrent state transition wins. */ }
    if (logId !== null) await completeEmailLog(logId, "failed", failureSummary);
    if (error instanceof InvoiceDeliveryError) throw error;
    throw new InvoiceDeliveryError("The provider could not deliver this invoice. Review the email log for a safe error summary.", configuration.provider, logId);
  }
}
