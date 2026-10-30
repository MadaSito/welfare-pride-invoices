import {
  DEFAULT_INVOICE_EMAIL_HTML,
  DEFAULT_INVOICE_EMAIL_SUBJECT,
  allocateInvoiceNumberForSending,
  completeEmailLog,
  getEmailProviderConfig,
  getEmailTemplate,
  getInvoiceBundle,
  setInvoiceStatus,
  startInvoiceDeliveryLog,
  startInvoiceResendLog,
} from "../db";
import { decryptConfig } from "../security/crypto";
import { renderInvoiceEmailTemplate, type InvoiceEmailTemplateContext } from "./emailTemplates";
import { sendProviderEmail, type ProviderConfig } from "./mailer";
import { invoicePdfFilename, renderInvoicePdf } from "./pdf";

type InvoiceBundle = NonNullable<Awaited<ReturnType<typeof getInvoiceBundle>>>;

export class InvoiceDeliveryError extends Error {
  constructor(message: string, public readonly provider?: string, public readonly emailLogId?: number | null, public readonly outcome?: "uncertain") {
    super(message);
    this.name = "InvoiceDeliveryError";
  }
}

async function configuredProvider(companyId: number) {
  const configuration = await getEmailProviderConfig(companyId);
  if (!configuration || !configuration.isActive) throw new InvoiceDeliveryError("An administrator must configure a delivery provider before invoices can be sent.");
  try { return { configuration, provider: decryptConfig<ProviderConfig>(configuration.encryptedConfig) }; }
  catch { throw new InvoiceDeliveryError("Delivery credentials are unavailable. Ask an administrator to save the provider configuration again.", configuration.provider); }
}

async function emailContent(companyId: number, bundle: InvoiceBundle) {
  const saved = await getEmailTemplate(companyId);
  const total = new Intl.NumberFormat("en-US", { style: "currency", currency: bundle.invoice.currency }).format(bundle.invoice.totalCents / 100);
  const formatDate = (value: Date) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(value));
  const context: InvoiceEmailTemplateContext = {
    invoiceNumber: bundle.invoice.invoiceNumber,
    companyName: bundle.company.name,
    clientName: bundle.contact.contactName || bundle.contact.companyName,
    invoiceTotal: total,
    currency: bundle.invoice.currency,
    issueDate: formatDate(bundle.invoice.issueDate),
    dueDate: formatDate(bundle.invoice.dueDate),
    paymentInstructions: bundle.invoice.paymentInstructions || "",
  };
  return renderInvoiceEmailTemplate(saved ?? { subjectTemplate: DEFAULT_INVOICE_EMAIL_SUBJECT, htmlBodyTemplate: DEFAULT_INVOICE_EMAIL_HTML }, context);
}

/**
 * Delivers a finalized invoice exactly once per successful state claim. The caller
 * is responsible for authorization; this service is shared by interactive and
 * authenticated scheduler execution. The tenant sequence is allocated only after
 * the document is claimed for sending, so drafts and finalized review documents
 * never consume a financial number.
 */
export async function deliverFinalizedInvoice(input: { companyId: number; invoiceId: number; correlationId: string }) {
  const initial = await getInvoiceBundle(input.companyId, input.invoiceId);
  if (!initial) throw new InvoiceDeliveryError("Invoice not found.");
  if (initial.company.archivedAt) throw new InvoiceDeliveryError("This company is archived and its invoices cannot be delivered.");
  if (initial.invoice.status !== "finalized") throw new InvoiceDeliveryError("Only finalized invoices can be sent. Drafts must be finalized first, and sent or paid invoices cannot be delivered again.");
  if (!initial.contact.email) throw new InvoiceDeliveryError("This client needs an email address before the invoice can be sent.");

  const { configuration, provider } = await configuredProvider(input.companyId);
  let logId: number | null = null;
  let providerDispatchStarted = false;
  try {
    await setInvoiceStatus(input.companyId, input.invoiceId, "sending", "finalized");
    const numbered = await allocateInvoiceNumberForSending(input.companyId, input.invoiceId);
    if (!numbered) throw new Error("Invoice number allocation returned no document.");
    const message = await emailContent(input.companyId, numbered);
    logId = await startInvoiceDeliveryLog({ companyId: input.companyId, invoiceId: input.invoiceId, provider: configuration.provider, recipient: numbered.contact.email!, bcc: numbered.company.defaultBcc, subject: message.subject, correlationId: input.correlationId });
    const pdf = await renderInvoicePdf(numbered);
    // A network error or a crash after this point cannot prove provider rejection.
    await completeEmailLog(logId, "uncertain", "Provider dispatch started; awaiting a confirmed acceptance response.");
    providerDispatchStarted = true;
    await sendProviderEmail(provider, { to: numbered.contact.email!, bcc: numbered.company.defaultBcc, subject: message.subject, html: message.html, attachment: { filename: invoicePdfFilename(numbered.invoice.invoiceNumber), content: pdf } });
    await completeEmailLog(logId, "sent", "Provider accepted the email with PDF attachment.");
    const updated = await setInvoiceStatus(input.companyId, input.invoiceId, "sent", "sending");
    return { invoice: updated, provider: configuration.provider, emailLogId: logId };
  } catch (error) {
    const failureSummary = error instanceof Error ? error.message : "Delivery failed.";
    if (logId !== null && providerDispatchStarted) {
      try { await completeEmailLog(logId, "uncertain", "Provider outcome is uncertain after dispatch began. An administrator must reconcile this attempt before retrying."); } catch { /* preserve the duplicate-prevention barrier */ }
      if (error instanceof InvoiceDeliveryError) throw error;
      throw new InvoiceDeliveryError("The provider outcome is uncertain. No automatic resend was performed; a company administrator must reconcile the delivery log.", configuration.provider, logId, "uncertain");
    }
    try { await setInvoiceStatus(input.companyId, input.invoiceId, "finalized", "sending"); } catch { /* a completed or concurrent state transition wins */ }
    if (logId !== null) await completeEmailLog(logId, "failed", failureSummary);
    if (error instanceof InvoiceDeliveryError) throw error;
    throw new InvoiceDeliveryError("The provider could not deliver this invoice. Review the email log for a safe error summary.", configuration.provider, logId);
  }
}

/** Administrator-only resend for an already delivered invoice. It never reuses the initial attempt log or allocates a new number. */
export async function resendDeliveredInvoice(input: { companyId: number; invoiceId: number; correlationId: string }) {
  const bundle = await getInvoiceBundle(input.companyId, input.invoiceId);
  if (!bundle) throw new InvoiceDeliveryError("Invoice not found.");
  if (bundle.company.archivedAt) throw new InvoiceDeliveryError("This company is archived and its invoices cannot be delivered.");
  if (!["sent", "paid"].includes(bundle.invoice.status)) throw new InvoiceDeliveryError("Only an already sent or paid invoice can be resent by an administrator.");
  if (!bundle.contact.email) throw new InvoiceDeliveryError("This client needs an email address before the invoice can be resent.");
  const { configuration, provider } = await configuredProvider(input.companyId);
  const message = await emailContent(input.companyId, bundle);
  const logId = await startInvoiceResendLog({ companyId: input.companyId, invoiceId: input.invoiceId, provider: configuration.provider, recipient: bundle.contact.email, bcc: bundle.company.defaultBcc, subject: message.subject, correlationId: input.correlationId });
  let dispatchStarted = false;
  try {
    const pdf = await renderInvoicePdf(bundle);
    await completeEmailLog(logId, "uncertain", "Administrator resend dispatch started; awaiting a confirmed acceptance response.");
    dispatchStarted = true;
    await sendProviderEmail(provider, { to: bundle.contact.email, bcc: bundle.company.defaultBcc, subject: message.subject, html: message.html, attachment: { filename: invoicePdfFilename(bundle.invoice.invoiceNumber), content: pdf } });
    await completeEmailLog(logId, "sent", "Provider accepted the administrator-requested resend with PDF attachment.");
    return { invoice: bundle.invoice, provider: configuration.provider, emailLogId: logId };
  } catch (error) {
    if (dispatchStarted) {
      await completeEmailLog(logId, "uncertain", "Provider outcome is uncertain after administrator resend dispatch began. Do not resend again until this attempt is reconciled.");
      throw new InvoiceDeliveryError("The resend outcome is uncertain. Review the delivery log before trying again.", configuration.provider, logId, "uncertain");
    }
    await completeEmailLog(logId, "failed", error instanceof Error ? error.message : "Administrator resend failed before provider dispatch.");
    throw new InvoiceDeliveryError("The resend could not be delivered. Review the email log for a safe error summary.", configuration.provider, logId);
  }
}
