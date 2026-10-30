import { TRPCError } from "@trpc/server";
import crypto from "node:crypto";
import { z } from "zod";
import {
  assignCompanyMembership,
  archiveCompany,
  completeBackupRun,
  completeEmailLog,
  createBackupRun,
  createAuditLog,
  createCompany,
  createContact,
  createEmailLog,
  createInvoice,
  createRecurringInvoiceSchedule,
  DEFAULT_WELFARE_LOGO_KEY,
  deleteRecurringInvoiceSchedule,
  discardInvoiceDraft,
  ensureDefaultTenantForUser,
  getCompaniesForUser,
  getCompanyById,
  getBackupDestination,
  getDashboardMetrics,
  getEmailProviderConfig,
  getEmailTemplate,
  getInvoiceBundle,
  getPendingRecurringReview,
  getRecurringInvoiceSchedule,
  listCompanyMembers,
  listArchivedCompaniesForUser,
  listBackupDestinations,
  listBackupRuns,
  listContacts,
  listEmailLogs,
  listInvoices,
  listRecurringInvoiceSchedules,
  reconcileUncertainInvoiceDelivery,
  restoreCompany,
  setCompanyInvoiceSequence,
  setRecurringInvoiceScheduleActive,
  saveEmailProviderConfig,
  saveEmailTemplate,
  saveBackupDestination,
  setBackupDestinationVerification,
  setCompanyLogoKey,
  setRecurringInvoiceScheduleNumbering,
  setInvoiceStatus,
  updateContact,
  updateCompanyBranding,
  updateInvoiceDraft,
  hasCompanyAdministratorMembership,
  type InvoiceLineInput,
} from "./db";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { testProviderConnection, type ProviderConfig } from "./services/mailer";
import { deliverFinalizedInvoice, InvoiceDeliveryError, resendDeliveredInvoice } from "./services/invoiceDelivery";
import { validateEmailTemplate } from "./services/emailTemplates";
import { buildBackupArchive, discoverSharePointSite, listSharePointFolders, testBackupDestination, uploadBackupArchive, validateBackupDestination, type BackupDestinationConfig, type SharePointDiscoveryCredentials } from "./services/backups";
import { validateLogoUpload } from "./services/images";
import { storagePut } from "./storage";
import { decryptConfig, encryptConfig, isEncryptionConfigured } from "./security/crypto";
import { requireCompanyArchiveAdministrator, requireCompanyProvisioner, requireCompanyRole } from "./security/access";
import { completeInitialSetup, createManagedUser, getClarityConfiguration, getInitialSetupStatus, listManagedUsers, logout as logoutStandalone, resetManagedMfa, resetManagedPassword, revokeManagedSessions, saveClarityConfiguration, saveEntraConfiguration, setManagedUserStatus } from "./auth/service";
import { createLocalSchedule, removeLocalSchedule, updateLocalSchedule } from "./scheduler/local";

const companyIdInput = z.object({ companyId: z.number().int().positive() });
const color = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Use a six-digit hex color.");
const date = z.coerce.date();
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();
const invoicePrefix = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,24}$/, "Use 1–24 letters or numbers for the invoice prefix.").refine(value => value !== "DRAFT", "DRAFT is reserved for provisional documents.");
const lineItemInput = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.number().int().min(1).max(1_000_000),
  unitPriceCents: z.number().int().min(0).max(100_000_000),
  taxable: z.boolean().default(true),
});
const invoiceInput = z.object({
  companyId: z.number().int().positive(),
  contactId: z.number().int().positive(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  issueDate: date,
  dueDate: date,
  taxRateBps: z.number().int().min(0).max(10_000),
  discountRateBps: z.number().int().min(0).max(10_000),
  notes: optionalText(4000),
  terms: optionalText(4000),
  paymentInstructions: optionalText(4000),
  lineItems: z.array(lineItemInput).min(1).max(100),
});
const recurringInvoiceInput = z.object({
  companyId: z.number().int().positive(),
  name: z.string().trim().min(2).max(160),
  contactId: z.number().int().positive(),
  invoicePrefix,
  nextInvoiceSequence: z.number().int().min(1).max(99_999_999),
  cadence: z.enum(["daily", "weekly", "monthly", "semiannual", "yearly"]),
  dayOfWeek: z.number().int().min(0).max(6).optional().nullable(),
  dayOfMonth: z.number().int().min(1).max(28).optional().nullable(),
  monthOfYear: z.number().int().min(1).max(12).optional().nullable(),
  hourUtc: z.number().int().min(0).max(23),
  minuteUtc: z.number().int().min(0).max(59),
  dueDays: z.number().int().min(0).max(365),
  autoSend: z.boolean(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  taxRateBps: z.number().int().min(0).max(10_000),
  discountRateBps: z.number().int().min(0).max(10_000),
  notes: optionalText(4000),
  terms: optionalText(4000),
  paymentInstructions: optionalText(4000),
  lineItems: z.array(lineItemInput).min(1).max(100),
}).superRefine((value, ctx) => {
  if (value.cadence === "weekly") {
    if (value.dayOfWeek == null) ctx.addIssue({ code: "custom", path: ["dayOfWeek"], message: "Choose a day of week for a weekly schedule." });
    if (value.dayOfMonth != null || value.monthOfYear != null) ctx.addIssue({ code: "custom", path: ["cadence"], message: "Weekly schedules cannot include monthly anchors." });
  }
  if (value.cadence === "monthly") {
    if (value.dayOfMonth == null) ctx.addIssue({ code: "custom", path: ["dayOfMonth"], message: "Choose a day of month for a monthly schedule." });
    if (value.dayOfWeek != null || value.monthOfYear != null) ctx.addIssue({ code: "custom", path: ["cadence"], message: "Monthly schedules cannot include weekly or yearly anchors." });
  }
  if (value.cadence === "semiannual") {
    if (value.dayOfMonth == null) ctx.addIssue({ code: "custom", path: ["dayOfMonth"], message: "Choose a day of month for an every-six-months schedule." });
    if (value.monthOfYear == null || value.monthOfYear > 6) ctx.addIssue({ code: "custom", path: ["monthOfYear"], message: "Choose an anchor month from January through June for an every-six-months schedule." });
    if (value.dayOfWeek != null) ctx.addIssue({ code: "custom", path: ["cadence"], message: "Every-six-months schedules cannot include a weekly anchor." });
  }
  if (value.cadence === "yearly") {
    if (value.dayOfMonth == null) ctx.addIssue({ code: "custom", path: ["dayOfMonth"], message: "Choose a day of month for a yearly schedule." });
    if (value.monthOfYear == null) ctx.addIssue({ code: "custom", path: ["monthOfYear"], message: "Choose a month for a yearly schedule." });
    if (value.dayOfWeek != null) ctx.addIssue({ code: "custom", path: ["cadence"], message: "Yearly schedules cannot include a weekly anchor." });
  }
  if (value.cadence === "daily" && (value.dayOfWeek != null || value.dayOfMonth != null || value.monthOfYear != null)) {
    ctx.addIssue({ code: "custom", path: ["cadence"], message: "Daily schedules cannot include a weekly or monthly anchor." });
  }
});

const graphConfigInput = z.object({
  provider: z.literal("microsoft_graph"),
  tenantId: z.string().trim().min(1).max(160),
  clientId: z.string().trim().min(1).max(160),
  clientSecret: z.string().max(4096).optional().default(""),
  senderEmail: z.string().trim().email().max(320),
  displayName: z.string().trim().min(1).max(160),
});
const smtpConfigInput = z.object({
  provider: z.literal("smtp"),
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().trim().min(1).max(320),
  password: z.string().max(4096).optional().default(""),
  fromEmail: z.string().trim().email().max(320),
  displayName: z.string().trim().min(1).max(160),
});
const deliveryConfigInput = z.discriminatedUnion("provider", [graphConfigInput, smtpConfigInput]);
const emailTemplateInput = z.object({ subjectTemplate: z.string().trim().min(1).max(300), htmlBodyTemplate: z.string().trim().min(1).max(20_000) });
const s3BackupConfigInput = z.object({
  provider: z.literal("s3"),
  endpoint: z.string().trim().url().max(500),
  region: z.string().trim().max(100).optional().default("us-east-1"),
  bucket: z.string().trim().min(3).max(255),
  accessKeyId: z.string().trim().max(512).optional().default(""),
  secretAccessKey: z.string().max(4096).optional().default(""),
  prefix: z.string().trim().max(300).optional().default("welfare-pride-invoices-backups"),
});
const sharePointBackupConfigInput = z.object({
  provider: z.literal("sharepoint"),
  tenantId: z.string().trim().max(160),
  clientId: z.string().trim().max(160),
  clientSecret: z.string().max(4096).optional().default(""),
  siteUrl: z.string().trim().max(500).optional().default(""),
  siteId: z.string().trim().max(512),
  driveId: z.string().trim().max(512),
  folderPath: z.string().trim().max(500).optional().default("Welfare Pride Invoices Backups"),
});
const backupDestinationInput = z.object({ id: z.number().int().positive().optional(), label: z.string().trim().min(2).max(160), isActive: z.boolean().default(true), config: z.discriminatedUnion("provider", [s3BackupConfigInput, sharePointBackupConfigInput]) });
const sharePointCredentialsInput = z.object({
  destinationId: z.number().int().positive().optional(),
  tenantId: z.string().trim().min(1).max(160),
  clientId: z.string().trim().min(1).max(160),
  clientSecret: z.string().max(4096).optional().default(""),
});
const sharePointDiscoveryInput = sharePointCredentialsInput.extend({ siteUrl: z.string().trim().min(8).max(500) });
const sharePointFolderBrowseInput = sharePointCredentialsInput.extend({
  siteId: z.string().trim().min(1).max(512),
  driveId: z.string().trim().min(1).max(512),
  folderPath: z.string().trim().max(500).optional().default(""),
});

function getCorrelationId(ctx: { res: { locals: Record<string, unknown> } }) {
  const value = ctx.res.locals.correlationId;
  return typeof value === "string" ? value : "trpc";
}

async function audit(ctx: { user: { id: number } | null; req: { ip?: string }; res: { locals: Record<string, unknown> } }, input: {
  companyId?: number;
  eventType: string;
  resourceType?: string;
  resourceId?: string;
  outcome: "success" | "failure";
  metadata?: Record<string, unknown>;
}) {
  try {
    await createAuditLog({
      companyId: input.companyId ?? null,
      actorUserId: ctx.user?.id ?? null,
      eventType: input.eventType,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      outcome: input.outcome,
      correlationId: getCorrelationId(ctx),
      metadata: input.metadata,
    });
  } catch (error) {
    console.error("Audit persistence failed", error instanceof Error ? error.message : "unknown error");
  }
}

function normalizedCompanies(entries: Awaited<ReturnType<typeof getCompaniesForUser>>) {
  return entries.map((entry: any) => entry.company ? { ...entry.company, memberRole: entry.memberRole } : { ...entry, memberRole: "platform_admin" });
}

function assertInvoiceDates(input: z.infer<typeof invoiceInput>) {
  if (input.dueDate.getTime() < input.issueDate.getTime()) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The due date cannot be before the issue date." });
  }
}

function recurrenceCron(input: z.infer<typeof recurringInvoiceInput>) {
  const seconds = 0;
  if (input.cadence === "daily") return `${seconds} ${input.minuteUtc} ${input.hourUtc} * * *`;
  if (input.cadence === "weekly") return `${seconds} ${input.minuteUtc} ${input.hourUtc} * * ${input.dayOfWeek}`;
  if (input.cadence === "monthly") return `${seconds} ${input.minuteUtc} ${input.hourUtc} ${input.dayOfMonth} * *`;
  if (input.cadence === "semiannual") {
    const firstMonth = input.monthOfYear!;
    return `${seconds} ${input.minuteUtc} ${input.hourUtc} ${input.dayOfMonth} ${firstMonth},${firstMonth + 6} *`;
  }
  return `${seconds} ${input.minuteUtc} ${input.hourUtc} ${input.dayOfMonth} ${input.monthOfYear} *`;
}

function nextRunDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function mergeDeliveryConfiguration(companyId: number, input: z.infer<typeof deliveryConfigInput>): Promise<ProviderConfig> {
  const current = await getEmailProviderConfig(companyId);
  let previous: ProviderConfig | null = null;
  if (current?.provider === input.provider) {
    try { previous = decryptConfig<ProviderConfig>(current.encryptedConfig); } catch { throw new Error("The existing encrypted mail configuration cannot be read. Enter all credentials and save a replacement configuration."); }
  }
  if (input.provider === "microsoft_graph") {
    const clientSecret = input.clientSecret.trim() || (previous?.provider === "microsoft_graph" ? previous.clientSecret : "");
    if (!clientSecret) throw new Error("Enter the Microsoft Graph client secret for a new provider configuration.");
    return { provider: input.provider, tenantId: input.tenantId, clientId: input.clientId, clientSecret, senderEmail: input.senderEmail, displayName: input.displayName };
  }
  const password = input.password || (previous?.provider === "smtp" ? previous.password : "");
  if (!password) throw new Error("Enter the SMTP password for a new provider configuration.");
  return { provider: input.provider, host: input.host, port: input.port, secure: input.secure, username: input.username, password, fromEmail: input.fromEmail, displayName: input.displayName };
}

async function mergeBackupConfiguration(input: z.infer<typeof backupDestinationInput>): Promise<BackupDestinationConfig> {
  const current = input.id ? await getBackupDestination(input.id) : null;
  if (input.id && !current) throw new Error("Backup destination not found.");
  let previous: BackupDestinationConfig | null = null;
  if (current?.provider === input.config.provider) {
    try { previous = decryptConfig<BackupDestinationConfig>(current.encryptedConfig); } catch { throw new Error("The existing encrypted backup configuration cannot be read. Enter all destination credentials and save a replacement."); }
  }
  if (input.config.provider === "s3") {
    const accessKeyId = input.config.accessKeyId || (previous?.provider === "s3" ? previous.accessKeyId : "");
    const secretAccessKey = input.config.secretAccessKey || (previous?.provider === "s3" ? previous.secretAccessKey : "");
    return validateBackupDestination({ ...input.config, accessKeyId, secretAccessKey });
  }
  const clientSecret = input.config.clientSecret || (previous?.provider === "sharepoint" ? previous.clientSecret : "");
  return validateBackupDestination({ ...input.config, clientSecret });
}

async function mergeSharePointCredentials(input: z.infer<typeof sharePointCredentialsInput>): Promise<SharePointDiscoveryCredentials> {
  const current = input.destinationId ? await getBackupDestination(input.destinationId) : null;
  if (input.destinationId && !current) throw new Error("Backup destination not found.");
  let previous: BackupDestinationConfig | null = null;
  if (current?.provider === "sharepoint") {
    try { previous = decryptConfig<BackupDestinationConfig>(current.encryptedConfig); }
    catch { throw new Error("The existing encrypted backup configuration cannot be read. Enter the SharePoint client secret and save a replacement destination."); }
  }
  const clientSecret = input.clientSecret || (previous?.provider === "sharepoint" ? previous.clientSecret : "");
  if (!clientSecret) throw new Error("Enter the SharePoint application client secret before discovering a new site.");
  return { tenantId: input.tenantId, clientId: input.clientId, clientSecret };
}

export const appRouter = router({
  analytics: router({
    clarityConfig: publicProcedure.query(async () => {
      const config = await getClarityConfiguration();
      return { projectId: config.enabled ? config.projectId : null };
    }),
  }),
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      await logoutStandalone(ctx.req, ctx.res);
      return { success: true } as const;
    }),
  }),

  users: router({
    list: adminProcedure.query(() => listManagedUsers()),
    create: adminProcedure.input(z.object({ name: z.string().trim().min(2).max(160), email: z.string().trim().email(), provider: z.enum(["local", "entra"]), globalAdmin: z.boolean().default(false) })).mutation(async ({ ctx, input }) => {
      const result = await createManagedUser(input); await audit(ctx, { eventType: "user.created", resourceType: "user", resourceId: String(result.userId), outcome: "success", metadata: { provider: input.provider, email: input.email, globalAdmin: input.globalAdmin } }); return result;
    }),
    setStatus: adminProcedure.input(z.object({ userId: z.number().int().positive(), enabled: z.boolean() })).mutation(async ({ ctx, input }) => { await setManagedUserStatus(input.userId, input.enabled); await audit(ctx, { eventType: input.enabled ? "user.enabled" : "user.disabled", resourceType: "user", resourceId: String(input.userId), outcome: "success" }); return { success: true }; }),
    resetPassword: adminProcedure.input(z.object({ userId: z.number().int().positive() })).mutation(async ({ ctx, input }) => { const temporaryPassword = await resetManagedPassword(input.userId); await audit(ctx, { eventType: "user.password.reset", resourceType: "user", resourceId: String(input.userId), outcome: "success" }); return { temporaryPassword }; }),
    resetMfa: adminProcedure.input(z.object({ userId: z.number().int().positive() })).mutation(async ({ ctx, input }) => { await resetManagedMfa(input.userId); await audit(ctx, { eventType: "user.mfa.reset", resourceType: "user", resourceId: String(input.userId), outcome: "success" }); return { success: true }; }),
    revokeSessions: adminProcedure.input(z.object({ userId: z.number().int().positive() })).mutation(async ({ ctx, input }) => { await revokeManagedSessions(input.userId); await audit(ctx, { eventType: "user.sessions.revoked", resourceType: "user", resourceId: String(input.userId), outcome: "success" }); return { success: true }; }),
  }),

  workspace: router({
    overview: protectedProcedure.query(async ({ ctx }) => {
      await ensureDefaultTenantForUser(ctx.user);
      const companies = normalizedCompanies(await getCompaniesForUser(ctx.user));
      const activeCompany = companies[0] ?? null;
      const metrics = activeCompany ? await getDashboardMetrics(activeCompany.id) : null;
      return { companies, activeCompany, metrics, isPlatformAdmin: ctx.user.role === "admin" || await hasCompanyAdministratorMembership(ctx.user.id) };
    }),
  }),

  company: router({
    create: protectedProcedure.input(z.object({ name: z.string().trim().min(2).max(160), email: z.string().email().optional() })).mutation(async ({ ctx, input }) => {
      await requireCompanyProvisioner(ctx.user);
      const company = await createCompany({ name: input.name, email: input.email ?? null, createdByUserId: ctx.user.id });
      await audit(ctx, { companyId: company?.id, eventType: "company.created", resourceType: "company", resourceId: String(company?.id), outcome: "success" });
      return company;
    }),
    listArchived: protectedProcedure.query(async ({ ctx }) => listArchivedCompaniesForUser(ctx.user)),
    get: protectedProcedure.input(companyIdInput).query(async ({ ctx, input }) => {
      await requireCompanyRole(ctx.user, input.companyId);
      const company = await getCompanyById(input.companyId);
      if (!company) throw new TRPCError({ code: "NOT_FOUND", message: "Company not found." });
      return company;
    }),
    updateBranding: protectedProcedure.input(companyIdInput.extend({
      name: z.string().trim().min(2).max(160),
      legalName: optionalText(220), email: z.string().email().optional().nullable(), phone: optionalText(64), website: optionalText(320),
      addressLine1: optionalText(220), addressLine2: optionalText(220), city: optionalText(120), region: optionalText(120), postalCode: optionalText(32), country: z.string().trim().length(2).optional().nullable(),
      primaryColor: color, accentColor: color, footerText: optionalText(1000), defaultBcc: z.string().email().optional().nullable(),
      logoScale: z.number().int().min(50).max(160), logoAlignment: z.enum(["left", "right"]), invoicePrefix,
    })).mutation(async ({ ctx, input }) => {
      await requireCompanyRole(ctx.user, input.companyId, "platform_admin");
      const { companyId, ...update } = input;
      const company = await updateCompanyBranding(companyId, update);
      await audit(ctx, { companyId, eventType: "company.branding.updated", resourceType: "company", resourceId: String(companyId), outcome: "success" });
      return company;
    }),
    setInvoiceSequence: protectedProcedure.input(companyIdInput.extend({ nextInvoiceSequence: z.number().int().min(1).max(99_999_999) })).mutation(async ({ ctx, input }) => {
      await requireCompanyRole(ctx.user, input.companyId, "platform_admin");
      try {
        const result = await setCompanyInvoiceSequence(input.companyId, input.nextInvoiceSequence, { actorUserId: ctx.user.id, correlationId: getCorrelationId(ctx) });
        return result.company;
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "The company one-off invoice sequence could not be updated." });
      }
    }),
    archive: protectedProcedure.input(companyIdInput).mutation(async ({ ctx, input }) => {
      await requireCompanyRole(ctx.user, input.companyId, "platform_admin");
      try {
        const archived = await archiveCompany(input.companyId);
        await Promise.allSettled(archived.taskUids.map(taskUid => updateLocalSchedule(taskUid, { enable: false })));
        await audit(ctx, { companyId: input.companyId, eventType: "company.archived", resourceType: "company", resourceId: String(input.companyId), outcome: "success", metadata: { disabledRecurringSchedules: archived.taskUids.length } });
        return { archived: true } as const;
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "The company could not be archived." });
      }
    }),
    restore: protectedProcedure.input(companyIdInput).mutation(async ({ ctx, input }) => {
      await requireCompanyArchiveAdministrator(ctx.user, input.companyId);
      try {
        const company = await restoreCompany(input.companyId);
        await audit(ctx, { companyId: input.companyId, eventType: "company.restored", resourceType: "company", resourceId: String(input.companyId), outcome: "success" });
        return company;
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "The company could not be restored." });
      }
    }),
    uploadLogo: protectedProcedure.input(companyIdInput.extend({ base64: z.string().min(1).max(7_000_000), mimeType: z.enum(["image/png", "image/jpeg"]) })).mutation(async ({ ctx, input }) => {
      await requireCompanyRole(ctx.user, input.companyId, "platform_admin");
      const binary = Buffer.from(input.base64, "base64");
      if (!binary.length || binary.toString("base64").replace(/=+$/, "") !== input.base64.replace(/=+$/, "")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The logo upload did not contain valid base64 data." });
      }
      const image = validateLogoUpload(binary, input.mimeType);
      const stored = await storagePut(`companies/${input.companyId}/logos/company-logo.${image.extension}`, binary, image.mimeType);
      const company = await setCompanyLogoKey(input.companyId, stored.key);
      await audit(ctx, { companyId: input.companyId, eventType: "company.logo.uploaded", resourceType: "company", resourceId: String(input.companyId), outcome: "success", metadata: { width: image.width, height: image.height } });
      return { company, logoUrl: stored.url };
    }),
    members: protectedProcedure.input(companyIdInput).query(async ({ ctx, input }) => {
      await requireCompanyRole(ctx.user, input.companyId, "platform_admin");
      return listCompanyMembers(input.companyId);
    }),
    assignMember: protectedProcedure.input(companyIdInput.extend({ email: z.string().trim().email(), role: z.enum(["platform_admin", "company_creator", "company_viewer"]) })).mutation(async ({ ctx, input }) => {
      await requireCompanyRole(ctx.user, input.companyId, "platform_admin");
      const members = await assignCompanyMembership(input.companyId, input.email, input.role);
      await audit(ctx, { companyId: input.companyId, eventType: "company.member.assigned", resourceType: "company_member", outcome: "success", metadata: { email: input.email, role: input.role } });
      return members;
    }),
  }),

  contacts: router({
    list: protectedProcedure.input(companyIdInput).query(async ({ ctx, input }) => {
      await requireCompanyRole(ctx.user, input.companyId);
      return listContacts(input.companyId);
    }),
    create: protectedProcedure.input(companyIdInput.extend({
      companyName: z.string().trim().min(1).max(220), contactName: optionalText(180), email: z.string().email().optional().nullable(), phone: optionalText(64),
      addressLine1: optionalText(220), addressLine2: optionalText(220), city: optionalText(120), region: optionalText(120), postalCode: optionalText(32), country: z.string().trim().length(2).optional().nullable(), notes: optionalText(2000),
    })).mutation(async ({ ctx, input }) => {
      await requireCompanyRole(ctx.user, input.companyId, "company_creator");
      const { companyId, ...contact } = input;
      const created = await createContact(companyId, contact);
      await audit(ctx, { companyId, eventType: "contact.created", resourceType: "contact", resourceId: String(created?.id), outcome: "success" });
      return created;
    }),
    update: protectedProcedure.input(companyIdInput.extend({
      contactId: z.number().int().positive(), companyName: z.string().trim().min(1).max(220), contactName: optionalText(180), email: z.string().email().optional().nullable(), phone: optionalText(64),
      addressLine1: optionalText(220), addressLine2: optionalText(220), city: optionalText(120), region: optionalText(120), postalCode: optionalText(32), country: z.string().trim().length(2).optional().nullable(), notes: optionalText(2000),
    })).mutation(async ({ ctx, input }) => {
      await requireCompanyRole(ctx.user, input.companyId, "company_creator");
      const { companyId, contactId, ...contact } = input;
      const updated = await updateContact(companyId, contactId, contact);
      await audit(ctx, { companyId, eventType: "contact.updated", resourceType: "contact", resourceId: String(contactId), outcome: "success" });
      return updated;
    }),
  }),

  recurringInvoices: router({
    list: protectedProcedure.input(companyIdInput).query(async ({ ctx, input }) => {
      await requireCompanyRole(ctx.user, input.companyId);
      return listRecurringInvoiceSchedules(input.companyId);
    }),
    create: protectedProcedure.input(recurringInvoiceInput).mutation(async ({ ctx, input }) => {
      await requireCompanyRole(ctx.user, input.companyId, "company_creator");
      if (input.autoSend) {
        await requireCompanyRole(ctx.user, input.companyId, "platform_admin");
        const config = await getEmailProviderConfig(input.companyId);
        if (!config?.isActive) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Configure an active email provider before enabling automatic recurring delivery." });
      }
      const task = await createLocalSchedule();
      try {
        const schedule = await createRecurringInvoiceSchedule({
          ...input,
          companyId: input.companyId,
          createdByUserId: ctx.user.id,
          schedulerKey: task.taskUid,
          nextRunAt: nextRunDate(task.nextExecutionAt),
        });
        await audit(ctx, { companyId: input.companyId, eventType: "recurring_invoice.created", resourceType: "recurring_invoice_schedule", resourceId: String(schedule?.schedule.id), outcome: "success", metadata: { cadence: input.cadence, autoSend: input.autoSend, invoicePrefix: input.invoicePrefix, nextInvoiceSequence: input.nextInvoiceSequence } });
        return schedule;
      } catch (error) {
        await removeLocalSchedule(task.taskUid);
        throw error;
      }
    }),
    generateForReview: protectedProcedure.input(companyIdInput.extend({ scheduleId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      await requireCompanyRole(ctx.user, input.companyId, "company_creator");
      const existing = await getPendingRecurringReview(input.companyId, input.scheduleId);
      if (existing) return { invoice: existing, reused: true };
      const schedule = await getRecurringInvoiceSchedule(input.companyId, input.scheduleId);
      if (!schedule) throw new TRPCError({ code: "NOT_FOUND", message: "Recurring schedule not found." });
      if (!schedule.schedule.isActive) throw new TRPCError({ code: "BAD_REQUEST", message: "Resume this recurring schedule before generating an invoice for review." });
      const issueDate = new Date();
      const dueDate = new Date(issueDate);
      dueDate.setUTCDate(dueDate.getUTCDate() + schedule.schedule.dueDays);
      try {
        const invoice = await createInvoice(input.companyId, ctx.user.id, {
          contactId: schedule.schedule.contactId,
          currency: schedule.schedule.currency,
          issueDate,
          dueDate,
          taxRateBps: schedule.schedule.taxRateBps,
          discountRateBps: schedule.schedule.discountRateBps,
          notes: schedule.schedule.notes,
          terms: schedule.schedule.terms,
          paymentInstructions: schedule.schedule.paymentInstructions,
          lineItems: schedule.lineItems.map(item => ({ description: item.description, quantity: item.quantity, unitPriceCents: item.unitPriceCents, taxable: item.taxable })),
          initialStatus: "awaiting_approval",
          recurringScheduleId: schedule.schedule.id,
          // Must remain within recurringOccurrenceKey's 48-character bound.
          recurringOccurrenceKey: `manual-${crypto.randomUUID()}`,
        });
        await audit(ctx, { companyId: input.companyId, eventType: "recurring_invoice.manual_review_generated", resourceType: "invoice", resourceId: String(invoice?.invoice.id), outcome: "success", metadata: { scheduleId: input.scheduleId } });
        return { invoice, reused: false };
      } catch (error) {
        console.error("Manual recurring review generation failed", error instanceof Error ? error.message : "unknown error");
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The review invoice could not be generated. No invoice was created; please try again or contact an administrator if the issue continues." });
      }
    }),
    setActive: protectedProcedure.input(companyIdInput.extend({ scheduleId: z.number().int().positive(), isActive: z.boolean() })).mutation(async ({ ctx, input }) => {
      await requireCompanyRole(ctx.user, input.companyId, "company_creator");
      const schedule = await getRecurringInvoiceSchedule(input.companyId, input.scheduleId);
      if (!schedule) throw new TRPCError({ code: "NOT_FOUND", message: "Recurring schedule not found." });
      const task = await updateLocalSchedule(schedule.schedule.schedulerKey, { enable: input.isActive });
      const updated = await setRecurringInvoiceScheduleActive(input.companyId, input.scheduleId, input.isActive, input.isActive ? nextRunDate(task.nextExecutionAt) : null);
      await audit(ctx, { companyId: input.companyId, eventType: input.isActive ? "recurring_invoice.resumed" : "recurring_invoice.paused", resourceType: "recurring_invoice_schedule", resourceId: String(input.scheduleId), outcome: "success" });
      return updated;
    }),
    setInvoiceSequence: protectedProcedure.input(companyIdInput.extend({
      scheduleId: z.number().int().positive(),
      invoicePrefix,
      nextInvoiceSequence: z.number().int().min(1).max(99_999_999),
    })).mutation(async ({ ctx, input }) => {
      await requireCompanyRole(ctx.user, input.companyId, "platform_admin");
      try {
        const result = await setRecurringInvoiceScheduleNumbering(input.companyId, input.scheduleId, input);
        await audit(ctx, {
          companyId: input.companyId,
          eventType: "recurring_invoice.series.migrated",
          resourceType: "recurring_invoice_schedule",
          resourceId: String(input.scheduleId),
          outcome: "success",
          metadata: { previousPrefix: result.previousPrefix, previousNextSequence: result.previousNextSequence, invoicePrefix: input.invoicePrefix, nextInvoiceSequence: input.nextInvoiceSequence, hasAllocatedInvoice: result.hasAllocatedInvoice },
        });
        return result.schedule;
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "The recurring invoice series could not be updated." });
      }
    }),
    delete: protectedProcedure.input(companyIdInput.extend({ scheduleId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      await requireCompanyRole(ctx.user, input.companyId, "company_creator");
      const schedule = await getRecurringInvoiceSchedule(input.companyId, input.scheduleId);
      if (!schedule) throw new TRPCError({ code: "NOT_FOUND", message: "Recurring schedule not found." });
      await deleteRecurringInvoiceSchedule(input.companyId, input.scheduleId);
      await removeLocalSchedule(schedule.schedule.schedulerKey);
      await audit(ctx, { companyId: input.companyId, eventType: "recurring_invoice.archived", resourceType: "recurring_invoice_schedule", resourceId: String(input.scheduleId), outcome: "success" });
      return { archived: true } as const;
    }),
  }),

  invoices: router({
    list: protectedProcedure.input(companyIdInput).query(async ({ ctx, input }) => {
      await requireCompanyRole(ctx.user, input.companyId);
      return listInvoices(input.companyId);
    }),
    get: protectedProcedure.input(companyIdInput.extend({ invoiceId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      await requireCompanyRole(ctx.user, input.companyId);
      const bundle = await getInvoiceBundle(input.companyId, input.invoiceId);
      if (!bundle) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found." });
      return bundle;
    }),
    create: protectedProcedure.input(invoiceInput).mutation(async ({ ctx, input }) => {
      await requireCompanyRole(ctx.user, input.companyId, "company_creator");
      assertInvoiceDates(input);
      const invoice = await createInvoice(input.companyId, ctx.user.id, input as Omit<z.infer<typeof invoiceInput>, "companyId">);
      await audit(ctx, { companyId: input.companyId, eventType: "invoice.created", resourceType: "invoice", resourceId: String(invoice?.invoice.id), outcome: "success" });
      return invoice;
    }),
    updateDraft: protectedProcedure.input(invoiceInput.extend({ invoiceId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      await requireCompanyRole(ctx.user, input.companyId, "company_creator");
      assertInvoiceDates(input);
      const { companyId, invoiceId, ...draft } = input;
      const invoice = await updateInvoiceDraft(companyId, invoiceId, draft as Omit<z.infer<typeof invoiceInput>, "companyId">);
      await audit(ctx, { companyId, eventType: "invoice.draft.updated", resourceType: "invoice", resourceId: String(invoiceId), outcome: "success" });
      return invoice;
    }),
    discardDraft: protectedProcedure.input(companyIdInput.extend({ invoiceId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      await requireCompanyRole(ctx.user, input.companyId, "company_creator");
      try {
        await discardInvoiceDraft(input.companyId, input.invoiceId);
        await audit(ctx, { companyId: input.companyId, eventType: "invoice.draft.discarded", resourceType: "invoice", resourceId: String(input.invoiceId), outcome: "success" });
        return { discarded: true } as const;
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "The draft invoice could not be discarded." });
      }
    }),
    finalize: protectedProcedure.input(companyIdInput.extend({ invoiceId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      await requireCompanyRole(ctx.user, input.companyId, "company_creator");
      const invoice = await getInvoiceBundle(input.companyId, input.invoiceId);
      if (!invoice) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found." });
      if (invoice.invoice.status !== "draft") throw new TRPCError({ code: "BAD_REQUEST", message: "Only draft invoices can be finalized." });
      const updated = await setInvoiceStatus(input.companyId, input.invoiceId, "finalized", "draft");
      await audit(ctx, { companyId: input.companyId, eventType: "invoice.finalized", resourceType: "invoice", resourceId: String(input.invoiceId), outcome: "success" });
      return updated;
    }),
    approveRecurring: protectedProcedure.input(companyIdInput.extend({ invoiceId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      await requireCompanyRole(ctx.user, input.companyId, "company_creator");
      const invoice = await getInvoiceBundle(input.companyId, input.invoiceId);
      if (!invoice) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found." });
      if (!invoice.invoice.recurringScheduleId || invoice.invoice.status !== "awaiting_approval") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only generated recurring invoices awaiting approval can be approved." });
      }
      const updated = await setInvoiceStatus(input.companyId, input.invoiceId, "finalized", "awaiting_approval", { actorUserId: ctx.user.id, correlationId: getCorrelationId(ctx), eventType: "recurring_invoice.approved", metadata: { scheduleId: invoice.invoice.recurringScheduleId } });
      return updated;
    }),
    send: protectedProcedure.input(companyIdInput.extend({ invoiceId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      await requireCompanyRole(ctx.user, input.companyId, "company_creator");
      try {
        const delivery = await deliverFinalizedInvoice({ companyId: input.companyId, invoiceId: input.invoiceId, correlationId: getCorrelationId(ctx) });
        await audit(ctx, { companyId: input.companyId, eventType: "invoice.sent", resourceType: "invoice", resourceId: String(input.invoiceId), outcome: "success", metadata: { provider: delivery.provider, emailLogId: delivery.emailLogId } });
        return delivery.invoice;
      } catch (error) {
        const safeMessage = error instanceof InvoiceDeliveryError ? error.message : "The provider could not deliver this invoice. Review the email log for details.";
        await audit(ctx, { companyId: input.companyId, eventType: "invoice.send.failed", resourceType: "invoice", resourceId: String(input.invoiceId), outcome: "failure", metadata: { provider: error instanceof InvoiceDeliveryError ? error.provider : undefined, emailLogId: error instanceof InvoiceDeliveryError ? error.emailLogId : undefined } });
        throw new TRPCError({ code: "BAD_GATEWAY", message: safeMessage });
      }
    }),
    reconcileUncertainDelivery: protectedProcedure.input(companyIdInput.extend({ invoiceId: z.number().int().positive(), resolution: z.enum(["mark_sent", "retry"]) })).mutation(async ({ ctx, input }) => {
      await requireCompanyRole(ctx.user, input.companyId, "platform_admin");
      try {
        const invoice = await reconcileUncertainInvoiceDelivery(input.companyId, input.invoiceId, input.resolution);
        await audit(ctx, { companyId: input.companyId, eventType: `invoice.delivery.${input.resolution}`, resourceType: "invoice", resourceId: String(input.invoiceId), outcome: "success" });
        return invoice;
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "The uncertain delivery could not be reconciled." });
      }
    }),
  }),

  setup: router({
    status: adminProcedure.query(async () => ({ ...(await getInitialSetupStatus()), encryptionReady: isEncryptionConfigured() })),
    clarityConfig: adminProcedure.query(async () => getClarityConfiguration()),
    saveClarity: adminProcedure.input(z.object({ enabled: z.boolean(), projectId: z.string().trim().max(80).optional() })).mutation(async ({ ctx, input }) => {
      if (!isEncryptionConfigured()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The server security key must be configured before analytics settings can be encrypted." });
      try {
        await saveClarityConfiguration(input, ctx.user.id);
        await audit(ctx, { eventType: "analytics.clarity.configuration.saved", resourceType: "application_setting", resourceId: "microsoft_clarity", outcome: "success", metadata: { enabled: input.enabled } });
        return { saved: true };
      } catch (error) {
        await audit(ctx, { eventType: "analytics.clarity.configuration.save.failed", resourceType: "application_setting", resourceId: "microsoft_clarity", outcome: "failure", metadata: { enabled: input.enabled } });
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Unable to save Microsoft Clarity configuration." });
      }
    }),
    saveWelfarePrideSso: adminProcedure.input(z.object({
      tenantId: z.string().trim().min(1).max(160),
      clientId: z.string().trim().min(1).max(160),
      clientSecret: z.string().max(4096).optional(),
    })).mutation(async ({ ctx, input }) => {
      if (!isEncryptionConfigured()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The server security key must be configured before SSO credentials can be encrypted." });
      try {
        await saveEntraConfiguration(input, ctx.user.id);
        await audit(ctx, { eventType: "sso.configuration.saved", resourceType: "application_setting", resourceId: "welfare_pride_sso", outcome: "success" });
        return { saved: true };
      } catch (error) {
        await audit(ctx, { eventType: "sso.configuration.save.failed", resourceType: "application_setting", resourceId: "welfare_pride_sso", outcome: "failure" });
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Unable to save Welfare Pride SSO configuration." });
      }
    }),
    completeInitialSetup: adminProcedure.mutation(async ({ ctx }) => {
      if (!isEncryptionConfigured()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Configure the server security key before completing initial setup." });
      await completeInitialSetup(ctx.user.id);
      await audit(ctx, { eventType: "initial_setup.completed", resourceType: "application_setting", resourceId: "initial_setup_complete", outcome: "success" });
      return { complete: true };
    }),
  }),

  backups: router({
    destinations: adminProcedure.query(async () => listBackupDestinations()),
    runs: adminProcedure.query(async () => listBackupRuns()),
    destinationDetails: adminProcedure.input(z.object({ destinationId: z.number().int().positive() })).query(async ({ input }) => {
      const destination = await getBackupDestination(input.destinationId);
      if (!destination) throw new TRPCError({ code: "NOT_FOUND", message: "Backup destination not found." });
      try {
        const config = decryptConfig<BackupDestinationConfig>(destination.encryptedConfig);
        if (config.provider === "s3") return { id: destination.id, label: destination.label, isActive: destination.isActive, config: { provider: config.provider, endpoint: config.endpoint, region: config.region, bucket: config.bucket, prefix: config.prefix } };
        return { id: destination.id, label: destination.label, isActive: destination.isActive, config: { provider: config.provider, tenantId: config.tenantId, clientId: config.clientId, siteUrl: config.siteUrl ?? "", siteId: config.siteId, driveId: config.driveId, folderPath: config.folderPath } };
      } catch { throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The encrypted backup configuration cannot be read. Save a replacement destination configuration." }); }
    }),
    discoverSharePoint: adminProcedure.input(sharePointDiscoveryInput).mutation(async ({ ctx, input }) => {
      try {
        const credentials = await mergeSharePointCredentials(input);
        const result = await discoverSharePointSite({ ...credentials, siteUrl: input.siteUrl });
        await audit(ctx, { eventType: "backup.sharepoint.site_discovered", resourceType: "backup_destination", resourceId: input.destinationId ? String(input.destinationId) : "new", outcome: "success", metadata: { libraryCount: result.drives.length } });
        return result;
      } catch (error) {
        await audit(ctx, { eventType: "backup.sharepoint.site_discovery.failed", resourceType: "backup_destination", resourceId: input.destinationId ? String(input.destinationId) : "new", outcome: "failure" });
        throw new TRPCError({ code: "BAD_GATEWAY", message: error instanceof Error ? error.message : "The SharePoint site could not be discovered." });
      }
    }),
    browseSharePointFolders: adminProcedure.input(sharePointFolderBrowseInput).mutation(async ({ ctx, input }) => {
      try {
        const credentials = await mergeSharePointCredentials(input);
        const result = await listSharePointFolders({ ...credentials, siteId: input.siteId, driveId: input.driveId, folderPath: input.folderPath });
        await audit(ctx, { eventType: "backup.sharepoint.folder_browsed", resourceType: "backup_destination", resourceId: input.destinationId ? String(input.destinationId) : "new", outcome: "success", metadata: { pathDepth: result.folderPath ? result.folderPath.split("/").length : 0, resultCount: result.folders.length } });
        return result;
      } catch (error) {
        await audit(ctx, { eventType: "backup.sharepoint.folder_browse.failed", resourceType: "backup_destination", resourceId: input.destinationId ? String(input.destinationId) : "new", outcome: "failure" });
        throw new TRPCError({ code: "BAD_GATEWAY", message: error instanceof Error ? error.message : "The SharePoint folder list could not be loaded." });
      }
    }),
    saveDestination: adminProcedure.input(backupDestinationInput).mutation(async ({ ctx, input }) => {
      if (!isEncryptionConfigured()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Configure the server security key before backup destination credentials can be encrypted." });
      try {
        const config = await mergeBackupConfiguration(input);
        const saved = await saveBackupDestination({ id: input.id, label: input.label, provider: config.provider, encryptedConfig: encryptConfig(config), isActive: input.isActive, actorUserId: ctx.user.id });
        const credentialsRetained = input.config.provider === "s3" ? !input.config.accessKeyId && !input.config.secretAccessKey : !input.config.clientSecret;
        await audit(ctx, { eventType: "backup.destination.saved", resourceType: "backup_destination", resourceId: String(saved?.id), outcome: "success", metadata: { provider: config.provider, credentialsRetained } });
        return saved ? { id: saved.id, label: saved.label, provider: saved.provider, isActive: saved.isActive, lastVerifiedAt: saved.lastVerifiedAt } : null;
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Unable to save backup destination." });
      }
    }),
    testDestination: adminProcedure.input(z.object({ destinationId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const destination = await getBackupDestination(input.destinationId);
      if (!destination) throw new TRPCError({ code: "NOT_FOUND", message: "Backup destination not found." });
      const runId = await createBackupRun({ destinationId: destination.id, initiatedByUserId: ctx.user.id, operation: "destination_test" });
      try {
        const config = decryptConfig<BackupDestinationConfig>(destination.encryptedConfig);
        const summary = await testBackupDestination(config);
        await setBackupDestinationVerification(destination.id, summary);
        await completeBackupRun(runId, { status: "succeeded", summary });
        await audit(ctx, { eventType: "backup.destination.tested", resourceType: "backup_destination", resourceId: String(destination.id), outcome: "success", metadata: { provider: destination.provider } });
        return { ok: true, summary };
      } catch (error) {
        const summary = "Backup destination test failed. Verify the encrypted credentials, permissions, and destination identifiers.";
        await completeBackupRun(runId, { status: "failed", summary });
        await audit(ctx, { eventType: "backup.destination.test.failed", resourceType: "backup_destination", resourceId: String(destination.id), outcome: "failure", metadata: { provider: destination.provider } });
        throw new TRPCError({ code: "BAD_GATEWAY", message: summary });
      }
    }),
    runCloudBackup: adminProcedure.input(z.object({ destinationId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const destination = await getBackupDestination(input.destinationId);
      if (!destination || !destination.isActive) throw new TRPCError({ code: "NOT_FOUND", message: "An active backup destination was not found." });
      let runId: number | null = null;
      try {
        const config = decryptConfig<BackupDestinationConfig>(destination.encryptedConfig);
        const archive = await buildBackupArchive();
        runId = await createBackupRun({ destinationId: destination.id, initiatedByUserId: ctx.user.id, operation: "cloud_backup", filename: archive.filename });
        const archiveLocation = await uploadBackupArchive(config, archive);
        await completeBackupRun(runId, { status: "succeeded", archiveLocation, checksumSha256: archive.checksumSha256, sizeBytes: archive.bytes, summary: "Encrypted backup archive uploaded successfully." });
        await audit(ctx, { eventType: "backup.cloud.created", resourceType: "backup_run", resourceId: String(runId), outcome: "success", metadata: { destinationId: destination.id, provider: destination.provider, checksumSha256: archive.checksumSha256 } });
        return { id: runId, filename: archive.filename, archiveLocation, checksumSha256: archive.checksumSha256, bytes: archive.bytes };
      } catch (error) {
        if (runId !== null) await completeBackupRun(runId, { status: "failed", summary: "Cloud backup failed. Verify destination credentials, permissions, and network access before retrying." });
        await audit(ctx, { eventType: "backup.cloud.failed", resourceType: "backup_destination", resourceId: String(input.destinationId), outcome: "failure" });
        throw new TRPCError({ code: "BAD_GATEWAY", message: "The encrypted cloud backup could not be completed. Review backup run history and destination configuration." });
      }
    }),
  }),

  delivery: router({
    configuration: protectedProcedure.input(companyIdInput).query(async ({ ctx, input }) => {
      await requireCompanyRole(ctx.user, input.companyId, "platform_admin");
      const config = await getEmailProviderConfig(input.companyId);
      let savedFields: Record<string, unknown> | null = null;
      if (config) {
        try {
          const provider = decryptConfig<ProviderConfig>(config.encryptedConfig);
          savedFields = provider.provider === "microsoft_graph" ? { tenantId: provider.tenantId, clientId: provider.clientId, senderEmail: provider.senderEmail, displayName: provider.displayName } : { host: provider.host, port: provider.port, secure: provider.secure, username: provider.username, fromEmail: provider.fromEmail, displayName: provider.displayName };
        } catch { /* surface only the safe configured flag; the administrator may overwrite the configuration */ }
      }
      return { configured: Boolean(config?.isActive), provider: config?.provider ?? null, displayName: config?.displayName ?? null, encryptionReady: isEncryptionConfigured(), savedFields };
    }),
    saveConfiguration: protectedProcedure.input(companyIdInput.extend({ config: deliveryConfigInput })).mutation(async ({ ctx, input }) => {
      await requireCompanyRole(ctx.user, input.companyId, "platform_admin");
      if (!isEncryptionConfigured()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "APP_CONFIG_ENCRYPTION_KEY must be set before provider credentials can be stored." });
      try {
        const merged = await mergeDeliveryConfiguration(input.companyId, input.config);
        const saved = await saveEmailProviderConfig(input.companyId, ctx.user.id, { provider: merged.provider, displayName: merged.displayName, encryptedConfig: encryptConfig(merged) });
        await audit(ctx, { companyId: input.companyId, eventType: "delivery.configuration.saved", resourceType: "email_provider", resourceId: String(saved?.id), outcome: "success", metadata: { provider: merged.provider, credentialsRetained: input.config.provider === "microsoft_graph" ? !input.config.clientSecret : !input.config.password } });
        return { configured: Boolean(saved), provider: saved?.provider, displayName: saved?.displayName };
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Unable to save mail configuration." });
      }
    }),
    template: protectedProcedure.input(companyIdInput).query(async ({ ctx, input }) => {
      await requireCompanyRole(ctx.user, input.companyId, "platform_admin");
      return (await getEmailTemplate(input.companyId)) ?? { id: null, subjectTemplate: "Invoice {{invoiceNumber}} from {{companyName}}", htmlBodyTemplate: "<p>Hello {{clientName}},</p><p>Please find invoice <strong>{{invoiceNumber}}</strong> attached. The amount due is <strong>{{invoiceTotal}}</strong>.</p><p>Due date: {{dueDate}}</p><p>Thank you,<br/>{{companyName}}</p>", isDefault: true };
    }),
    saveTemplate: protectedProcedure.input(companyIdInput.extend(emailTemplateInput.shape)).mutation(async ({ ctx, input }) => {
      await requireCompanyRole(ctx.user, input.companyId, "platform_admin");
      try {
        const template = validateEmailTemplate(input);
        const saved = await saveEmailTemplate(input.companyId, ctx.user.id, template);
        await audit(ctx, { companyId: input.companyId, eventType: "delivery.template.saved", resourceType: "email_template", resourceId: String(saved?.id), outcome: "success" });
        return saved;
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Unable to save email template." });
      }
    }),
    sendTest: protectedProcedure.input(companyIdInput.extend({ recipient: z.string().trim().email() })).mutation(async ({ ctx, input }) => {
      await requireCompanyRole(ctx.user, input.companyId, "platform_admin");
      const config = await getEmailProviderConfig(input.companyId);
      if (!config) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Save a provider configuration before sending a test email." });
      let provider: ProviderConfig;
      try { provider = decryptConfig<ProviderConfig>(config.encryptedConfig); } catch { throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The encrypted provider configuration cannot be read. Save it again after confirming the encryption key." }); }
      const logId = await createEmailLog({ companyId: input.companyId, provider: config.provider, recipient: input.recipient, subject: `Welfare Pride delivery test — ${config.displayName}`, attemptType: "test", correlationId: getCorrelationId(ctx) });
      try {
        const result = await testProviderConnection(provider, input.recipient);
        await completeEmailLog(logId, "sent", `Test accepted by ${result.provider}; provider reference ${result.messageId}.`);
        await audit(ctx, { companyId: input.companyId, eventType: "delivery.test.sent", resourceType: "email_provider", resourceId: String(config.id), outcome: "success", metadata: { provider: result.provider } });
        return { ok: true, displayName: config.displayName, provider: result.provider };
      } catch (error) {
        await completeEmailLog(logId, "failed", error instanceof Error ? error.message : "Test delivery failed.");
        await audit(ctx, { companyId: input.companyId, eventType: "delivery.test.failed", resourceType: "email_provider", resourceId: String(config.id), outcome: "failure", metadata: { provider: config.provider } });
        throw new TRPCError({ code: "BAD_GATEWAY", message: "The provider connection test failed. Review the email log for a safe error summary." });
      }
    }),
    logs: protectedProcedure.input(companyIdInput).query(async ({ ctx, input }) => {
      await requireCompanyRole(ctx.user, input.companyId, "platform_admin");
      return listEmailLogs(input.companyId);
    }),
    resendInvoice: protectedProcedure.input(companyIdInput.extend({ invoiceId: z.number().int().positive(), reason: z.string().trim().min(5).max(500) })).mutation(async ({ ctx, input }) => {
      await requireCompanyRole(ctx.user, input.companyId, "platform_admin");
      try {
        const delivery = await resendDeliveredInvoice({ companyId: input.companyId, invoiceId: input.invoiceId, correlationId: getCorrelationId(ctx) });
        await audit(ctx, { companyId: input.companyId, eventType: "invoice.email.resent", resourceType: "invoice", resourceId: String(input.invoiceId), outcome: "success", metadata: { provider: delivery.provider, emailLogId: delivery.emailLogId, reason: input.reason } });
        return delivery;
      } catch (error) {
        await audit(ctx, { companyId: input.companyId, eventType: "invoice.email.resend.failed", resourceType: "invoice", resourceId: String(input.invoiceId), outcome: "failure", metadata: { reason: input.reason, emailLogId: error instanceof InvoiceDeliveryError ? error.emailLogId : undefined } });
        throw new TRPCError({ code: "BAD_GATEWAY", message: error instanceof InvoiceDeliveryError ? error.message : "The invoice could not be resent." });
      }
    }),
  }),
});

export type AppRouter = typeof appRouter;
