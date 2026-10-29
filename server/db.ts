import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { nanoid } from "nanoid";
import {
  auditLogs,
  companies,
  companyMembers,
  contacts,
  emailLogs,
  emailProviderConfigs,
  invoiceLineItems,
  invoices,
  recurringInvoiceLineItems,
  recurringInvoiceRuns,
  recurringInvoiceSchedules,
  type CompanyMemberRole,
  type EmailProvider,
  type InsertUser,
  type InvoiceStatus,
  type RecurringInvoiceCadence,
  type RecurringInvoiceRunStatus,
  type User,
  users,
  webhookEvents,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

export const DEFAULT_WELFARE_LOGO_KEY = "welfare-pride-logo_82951fbd.png";
export const DEFAULT_WELFARE_COMPANY_SLUG = "welfare-pride";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error instanceof Error ? error.message : "unknown error");
      _db = null;
    }
  }
  return _db;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  return db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await requireDb();
  const values: InsertUser = { openId: user.openId, lastSignedIn: user.lastSignedIn ?? new Date() };
  const updateSet: Record<string, unknown> = { lastSignedIn: values.lastSignedIn };
  for (const field of ["name", "email", "loginMethod"] as const) {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = values[field];
    }
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function ensureDefaultTenantForUser(user: User) {
  const db = await requireDb();
  let company = (await db.select().from(companies).where(eq(companies.slug, DEFAULT_WELFARE_COMPANY_SLUG)).limit(1))[0];
  if (!company) {
    const insert = await db.insert(companies).values({
      slug: DEFAULT_WELFARE_COMPANY_SLUG,
      name: "Welfare Pride",
      legalName: "Welfare Pride",
      primaryColor: "#5A92C9",
      accentColor: "#D58240",
      logoKey: DEFAULT_WELFARE_LOGO_KEY,
      footerText: "Thank you for supporting Welfare Pride.",
      invoicePrefix: "WP",
    });
    company = (await db.select().from(companies).where(eq(companies.id, Number(insert[0].insertId))).limit(1))[0];
  }
  if (!company) throw new Error("Default company bootstrap failed");

  // Only the platform-recorded project owner may establish the first default-tenant administrator.
  // Other authenticated users fail closed until an administrator assigns a company membership.
  if (user.openId === ENV.ownerOpenId) {
    await db.insert(companyMembers).values({
      companyId: company.id,
      userId: user.id,
      role: "platform_admin",
    }).onDuplicateKeyUpdate({ set: { role: "platform_admin" } });
  }
  return company;
}

export async function getCompaniesForUser(user: User) {
  const db = await requireDb();
  if (user.role === "admin") return db.select().from(companies).where(isNull(companies.archivedAt)).orderBy(asc(companies.name));
  return db
    .select({ company: companies, memberRole: companyMembers.role })
    .from(companyMembers)
    .innerJoin(companies, eq(companies.id, companyMembers.companyId))
    .where(and(eq(companyMembers.userId, user.id), isNull(companies.archivedAt)))
    .orderBy(asc(companies.name));
}

export async function getCompanyById(companyId: number) {
  const db = await requireDb();
  return (await db.select().from(companies).where(eq(companies.id, companyId)).limit(1))[0];
}

export async function getCompanyAccess(user: User, companyId: number, includeArchived = false): Promise<CompanyMemberRole | null> {
  const db = await requireDb();
  const visibility = includeArchived ? undefined : isNull(companies.archivedAt);
  if (user.role === "admin") {
    const company = await db.select({ id: companies.id }).from(companies).where(visibility ? and(eq(companies.id, companyId), visibility) : eq(companies.id, companyId)).limit(1);
    return company[0] ? "platform_admin" : null;
  }
  const member = await db
    .select({ role: companyMembers.role })
    .from(companyMembers)
    .innerJoin(companies, eq(companies.id, companyMembers.companyId))
    .where(visibility ? and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, user.id), visibility) : and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, user.id)))
    .limit(1);
  return member[0]?.role ?? null;
}

export async function listArchivedCompaniesForUser(user: User) {
  const db = await requireDb();
  if (user.role === "admin") return db.select().from(companies).where(sql`${companies.archivedAt} IS NOT NULL`).orderBy(desc(companies.archivedAt));
  return db
    .select({ company: companies, memberRole: companyMembers.role })
    .from(companyMembers)
    .innerJoin(companies, eq(companies.id, companyMembers.companyId))
    .where(and(
      eq(companyMembers.userId, user.id),
      eq(companyMembers.role, "platform_admin"),
      sql`${companies.archivedAt} IS NOT NULL`,
    ))
    .orderBy(desc(companies.archivedAt));
}

export async function hasCompanyAdministratorMembership(userId: number) {
  const db = await requireDb();
  const member = await db
    .select({ id: companyMembers.id })
    .from(companyMembers)
    .where(and(eq(companyMembers.userId, userId), eq(companyMembers.role, "platform_admin")))
    .limit(1);
  return member.length > 0;
}

export async function createCompany(input: { name: string; email?: string | null; createdByUserId: number }) {
  const db = await requireDb();
  const slugBase = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90) || "company";
  const insert = await db.insert(companies).values({
    slug: `${slugBase}-${nanoid(6).toLowerCase()}`,
    name: input.name,
    email: input.email ?? null,
    primaryColor: "#5A92C9",
    accentColor: "#D58240",
    logoKey: DEFAULT_WELFARE_LOGO_KEY,
    invoicePrefix: "INV",
  });
  const companyId = Number(insert[0].insertId);
  await db.insert(companyMembers).values({ companyId, userId: input.createdByUserId, role: "platform_admin" });
  return getCompanyById(companyId);
}

export async function updateCompanyBranding(companyId: number, input: {
  name: string;
  legalName?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
  primaryColor: string;
  accentColor: string;
  footerText?: string | null;
  defaultBcc?: string | null;
  logoScale: number;
  logoAlignment: "left" | "right";
  invoicePrefix: string;
}) {
  const db = await requireDb();
  await db.update(companies).set(input).where(eq(companies.id, companyId));
  return getCompanyById(companyId);
}

/** Set the next company-wide number used only by one-off (non-recurring) invoices. */
export async function setCompanyInvoiceSequence(companyId: number, nextInvoiceSequence: number, audit?: { actorUserId: number; correlationId: string }) {
  const db = await requireDb();
  return db.transaction(async tx => {
    const company = (await tx.select().from(companies).where(and(eq(companies.id, companyId), isNull(companies.archivedAt))).limit(1))[0];
    if (!company) throw new Error("Active company not found");
    const previousNextSequence = company.invoiceSequence + 1;
    const allocated = (await tx.select({ id: invoices.id }).from(invoices).where(and(
      eq(invoices.companyId, companyId),
      isNull(invoices.recurringScheduleId),
      sql`${invoices.invoiceNumber} NOT LIKE 'DRAFT-%'`,
    )).limit(1))[0];
    if (allocated && nextInvoiceSequence < previousNextSequence) {
      throw new Error(`The next company sequence cannot move backward from ${previousNextSequence} after one-off invoices have received numbers.`);
    }
    const result = await tx.update(companies).set({ invoiceSequence: nextInvoiceSequence - 1 }).where(and(
      eq(companies.id, companyId),
      eq(companies.invoiceSequence, company.invoiceSequence),
      isNull(companies.archivedAt),
    ));
    if (Number((result as any)[0]?.affectedRows ?? 0) !== 1) throw new Error("Company sequence changed before this update could be completed.");
    if (audit) await tx.insert(auditLogs).values({
      companyId,
      actorUserId: audit.actorUserId,
      eventType: "company.one_off_series.migrated",
      resourceType: "company",
      resourceId: String(companyId),
      outcome: "success",
      correlationId: audit.correlationId,
      metadataJson: JSON.stringify({ previousNextSequence, nextInvoiceSequence, hasAllocatedInvoice: Boolean(allocated) }),
    });
    const updated = (await tx.select().from(companies).where(eq(companies.id, companyId)).limit(1))[0];
    return { company: updated, previousNextSequence, hasAllocatedInvoice: Boolean(allocated) };
  });
}

export async function setCompanyLogoKey(companyId: number, logoKey: string) {
  const db = await requireDb();
  await db.update(companies).set({ logoKey }).where(eq(companies.id, companyId));
  return getCompanyById(companyId);
}

export async function archiveCompany(companyId: number) {
  const db = await requireDb();
  return db.transaction(async tx => {
    const now = new Date();
    const result = await tx.update(companies).set({ archivedAt: now }).where(and(eq(companies.id, companyId), isNull(companies.archivedAt)));
    if (Number((result as any)[0]?.affectedRows ?? 0) !== 1) throw new Error("Active company not found");
    const sendingInvoice = (await tx.select({ id: invoices.id }).from(invoices).where(and(
      eq(invoices.companyId, companyId),
      eq(invoices.status, "sending"),
    )).limit(1))[0];
    if (sendingInvoice) throw new Error("This company has an invoice delivery in progress. Reconcile or complete it before archiving.");
    const company = (await tx.select().from(companies).where(eq(companies.id, companyId)).limit(1))[0];
    const schedules = await tx.select({ taskUid: recurringInvoiceSchedules.heartbeatTaskUid }).from(recurringInvoiceSchedules).where(and(
      eq(recurringInvoiceSchedules.companyId, companyId),
      eq(recurringInvoiceSchedules.isActive, true),
    ));
    await tx.update(recurringInvoiceSchedules).set({ isActive: false, nextRunAt: null }).where(eq(recurringInvoiceSchedules.companyId, companyId));
    return { company, taskUids: schedules.map(schedule => schedule.taskUid) };
  });
}

export async function restoreCompany(companyId: number) {
  const db = await requireDb();
  const result = await db.update(companies).set({ archivedAt: null }).where(and(eq(companies.id, companyId), sql`${companies.archivedAt} IS NOT NULL`));
  if (Number((result as any)[0]?.affectedRows ?? 0) !== 1) throw new Error("Archived company not found");
  return getCompanyById(companyId);
}

export async function listContacts(companyId: number) {
  const db = await requireDb();
  return db.select().from(contacts).where(eq(contacts.companyId, companyId)).orderBy(asc(contacts.companyName));
}

export async function createContact(companyId: number, input: Omit<typeof contacts.$inferInsert, "id" | "companyId" | "createdAt" | "updatedAt">) {
  const db = await requireDb();
  const insert = await db.insert(contacts).values({ ...input, companyId });
  return (await db.select().from(contacts).where(eq(contacts.id, Number(insert[0].insertId))).limit(1))[0];
}

export async function updateContact(companyId: number, contactId: number, input: Omit<typeof contacts.$inferInsert, "id" | "companyId" | "createdAt" | "updatedAt">) {
  const db = await requireDb();
  const result = await db.update(contacts).set(input).where(and(eq(contacts.id, contactId), eq(contacts.companyId, companyId)));
  if (Number((result as any)[0]?.affectedRows ?? 0) !== 1) throw new Error("Client not found in this company");
  return (await db.select().from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.companyId, companyId))).limit(1))[0];
}

export type InvoiceLineInput = {
  description: string;
  quantity: number;
  unitPriceCents: number;
  taxable: boolean;
};

export function calculateInvoiceTotals(lineItems: InvoiceLineInput[], taxRateBps: number, discountRateBps: number) {
  const subtotalCents = lineItems.reduce((total, item) => total + item.quantity * item.unitPriceCents, 0);
  const taxableSubtotalCents = lineItems
    .filter(item => item.taxable)
    .reduce((total, item) => total + item.quantity * item.unitPriceCents, 0);
  const discountCents = Math.round((subtotalCents * discountRateBps) / 10_000);
  const taxBaseCents = Math.max(0, taxableSubtotalCents - Math.round((taxableSubtotalCents * discountRateBps) / 10_000));
  const taxCents = Math.round((taxBaseCents * taxRateBps) / 10_000);
  return {
    subtotalCents,
    discountCents,
    taxCents,
    totalCents: Math.max(0, subtotalCents - discountCents + taxCents),
  };
}

function nextDraftReference() {
  return `DRAFT-${nanoid(10).toUpperCase()}`;
}

export function isProvisionalInvoiceNumber(invoiceNumber: string) {
  return invoiceNumber.startsWith("DRAFT-");
}

export function formatInvoiceNumber(prefix: string, issuedAt: Date, sequence: number) {
  return `${prefix || "INV"}-${issuedAt.getUTCFullYear()}-${String(sequence).padStart(4, "0")}`;
}

/** Recurring templates own their invoice series, e.g. HPP + 35 becomes HPP035. */
export function formatRecurringInvoiceNumber(prefix: string, sequence: number) {
  return `${prefix || "REC"}${String(sequence).padStart(3, "0")}`;
}

export async function createInvoice(companyId: number, createdByUserId: number, input: {
  contactId: number;
  currency: string;
  issueDate: Date;
  dueDate: Date;
  taxRateBps: number;
  discountRateBps: number;
  notes?: string | null;
  terms?: string | null;
  paymentInstructions?: string | null;
  lineItems: InvoiceLineInput[];
  initialStatus?: "draft" | "awaiting_approval" | "finalized";
  recurringScheduleId?: number | null;
  recurringOccurrenceKey?: string | null;
}) {
  const db = await requireDb();
  const totals = calculateInvoiceTotals(input.lineItems, input.taxRateBps, input.discountRateBps);
  const initialStatus = input.initialStatus ?? "draft";
  let invoiceId = 0;
  await db.transaction(async tx => {
    const activeCompany = await tx.update(companies).set({ updatedAt: new Date() }).where(and(eq(companies.id, companyId), isNull(companies.archivedAt)));
    if (Number((activeCompany as any)[0]?.affectedRows ?? 0) !== 1) throw new Error("This company is archived or no longer available for invoice creation.");
    if (input.recurringScheduleId) {
      const activeSchedule = await tx.update(recurringInvoiceSchedules).set({ updatedAt: new Date() }).where(and(
        eq(recurringInvoiceSchedules.id, input.recurringScheduleId),
        eq(recurringInvoiceSchedules.companyId, companyId),
        eq(recurringInvoiceSchedules.isActive, true),
        isNull(recurringInvoiceSchedules.archivedAt),
      ));
      if (Number((activeSchedule as any)[0]?.affectedRows ?? 0) !== 1) throw new Error("This recurring schedule is paused or archived and cannot create an invoice.");
    }
    const client = (await tx.select().from(contacts).where(and(eq(contacts.id, input.contactId), eq(contacts.companyId, companyId))).limit(1))[0];
    if (!client) throw new Error("Client does not belong to this company");
    const insert = await tx.insert(invoices).values({
      companyId,
      contactId: input.contactId,
      invoiceNumber: nextDraftReference(),
      status: initialStatus,
      currency: input.currency.toUpperCase(),
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      taxRateBps: input.taxRateBps,
      discountRateBps: input.discountRateBps,
      ...totals,
      notes: input.notes ?? null,
      terms: input.terms ?? null,
      paymentInstructions: input.paymentInstructions ?? null,
      createdByUserId,
      recurringScheduleId: input.recurringScheduleId ?? null,
      recurringOccurrenceKey: input.recurringOccurrenceKey ?? null,
      ...(initialStatus === "finalized" ? { finalizedAt: new Date() } : {}),
    });
    invoiceId = Number(insert[0].insertId);
    await tx.insert(invoiceLineItems).values(input.lineItems.map((item, index) => ({ ...item, invoiceId, position: index + 1 })));
  });
  return getInvoiceBundle(companyId, invoiceId);
}

export async function updateInvoiceDraft(companyId: number, invoiceId: number, input: {
  contactId: number;
  currency: string;
  issueDate: Date;
  dueDate: Date;
  taxRateBps: number;
  discountRateBps: number;
  notes?: string | null;
  terms?: string | null;
  paymentInstructions?: string | null;
  lineItems: InvoiceLineInput[];
}) {
  const db = await requireDb();
  const invoice = (await db.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId))).limit(1))[0];
  if (!invoice) throw new Error("Invoice not found");
  if (invoice.status !== "draft") throw new Error("Only draft invoices can be changed");
  const contact = (await db.select().from(contacts).where(and(eq(contacts.id, input.contactId), eq(contacts.companyId, companyId))).limit(1))[0];
  if (!contact) throw new Error("Client does not belong to this company");
  const totals = calculateInvoiceTotals(input.lineItems, input.taxRateBps, input.discountRateBps);
  await db.transaction(async tx => {
    const result = await tx.update(invoices).set({
      contactId: input.contactId,
      currency: input.currency.toUpperCase(),
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      taxRateBps: input.taxRateBps,
      discountRateBps: input.discountRateBps,
      ...totals,
      notes: input.notes ?? null,
      terms: input.terms ?? null,
      paymentInstructions: input.paymentInstructions ?? null,
    }).where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId), eq(invoices.status, "draft")));
    if (Number((result as any)[0]?.affectedRows ?? 0) !== 1) throw new Error("The draft changed state before it could be updated");
    await tx.delete(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoiceId));
    await tx.insert(invoiceLineItems).values(input.lineItems.map((item, index) => ({ ...item, invoiceId, position: index + 1 })));
  });
  return getInvoiceBundle(companyId, invoiceId);
}

/** Drafts have no financial number and may be permanently discarded before finalization. */
export async function discardInvoiceDraft(companyId: number, invoiceId: number) {
  const db = await requireDb();
  await db.transaction(async tx => {
    const activeCompany = await tx.update(companies).set({ updatedAt: new Date() }).where(and(eq(companies.id, companyId), isNull(companies.archivedAt)));
    if (Number((activeCompany as any)[0]?.affectedRows ?? 0) !== 1) throw new Error("This company is archived or no longer available for draft discard.");
    const result = await tx.delete(invoices).where(and(
      eq(invoices.id, invoiceId),
      eq(invoices.companyId, companyId),
      eq(invoices.status, "draft"),
    ));
    if (Number((result as any)[0]?.affectedRows ?? 0) !== 1) {
      throw new Error("Only an unfinalized draft invoice can be discarded.");
    }
  });
}

export async function listInvoices(companyId: number) {
  const db = await requireDb();
  return db
    .select({ invoice: invoices, contact: contacts })
    .from(invoices)
    .innerJoin(contacts, eq(contacts.id, invoices.contactId))
    .where(eq(invoices.companyId, companyId))
    .orderBy(desc(invoices.createdAt));
}

export type RecurringInvoiceTemplateInput = {
  contactId: number;
  name: string;
  invoicePrefix: string;
  nextInvoiceSequence: number;
  cadence: RecurringInvoiceCadence;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  monthOfYear?: number | null;
  hourUtc: number;
  minuteUtc: number;
  dueDays: number;
  autoSend: boolean;
  currency: string;
  taxRateBps: number;
  discountRateBps: number;
  notes?: string | null;
  terms?: string | null;
  paymentInstructions?: string | null;
  lineItems: InvoiceLineInput[];
};

export function hasRecurringSeriesPrefixConflict(existingPrefixes: string[], candidate: string) {
  return existingPrefixes.some(prefix => prefix === candidate || prefix.startsWith(candidate) || candidate.startsWith(prefix));
}

export async function createRecurringInvoiceSchedule(input: RecurringInvoiceTemplateInput & {
  companyId: number;
  createdByUserId: number;
  heartbeatTaskUid: string;
  nextRunAt?: Date | null;
}) {
  const db = await requireDb();
  const contact = (await db.select().from(contacts).where(and(eq(contacts.id, input.contactId), eq(contacts.companyId, input.companyId))).limit(1))[0];
  if (!contact) throw new Error("Client does not belong to this company");
  let scheduleId = 0;
  await db.transaction(async tx => {
    const prefix = input.invoicePrefix.toUpperCase();
    const existingSeries = await tx.select({ invoicePrefix: recurringInvoiceSchedules.invoicePrefix }).from(recurringInvoiceSchedules).where(eq(recurringInvoiceSchedules.companyId, input.companyId));
    if (hasRecurringSeriesPrefixConflict(existingSeries.map(series => series.invoicePrefix), prefix)) {
      throw new Error("Another recurring schedule uses a prefix that could produce the same invoice number. Choose a distinct, non-overlapping series prefix.");
    }
    const candidateNumber = formatRecurringInvoiceNumber(prefix, input.nextInvoiceSequence);
    const existingInvoiceNumber = (await tx.select({ id: invoices.id }).from(invoices).where(and(
      eq(invoices.companyId, input.companyId),
      eq(invoices.invoiceNumber, candidateNumber),
    )).limit(1))[0];
    if (existingInvoiceNumber) throw new Error(`Invoice number ${candidateNumber} already exists in this company. Choose the next unused number.`);
    const insert = await tx.insert(recurringInvoiceSchedules).values({
      companyId: input.companyId,
      contactId: input.contactId,
      name: input.name,
      cadence: input.cadence,
      dayOfWeek: input.dayOfWeek ?? null,
      dayOfMonth: input.dayOfMonth ?? null,
      monthOfYear: input.monthOfYear ?? null,
      hourUtc: input.hourUtc,
      minuteUtc: input.minuteUtc,
      dueDays: input.dueDays,
      autoSend: input.autoSend,
      heartbeatTaskUid: input.heartbeatTaskUid,
      nextRunAt: input.nextRunAt ?? null,
      currency: input.currency.toUpperCase(),
      invoicePrefix: prefix,
      invoiceSequence: input.nextInvoiceSequence,
      taxRateBps: input.taxRateBps,
      discountRateBps: input.discountRateBps,
      notes: input.notes ?? null,
      terms: input.terms ?? null,
      paymentInstructions: input.paymentInstructions ?? null,
      createdByUserId: input.createdByUserId,
    });
    scheduleId = Number(insert[0].insertId);
    await tx.insert(recurringInvoiceLineItems).values(input.lineItems.map((item, index) => ({ ...item, scheduleId, position: index + 1 })));
  });
  return getRecurringInvoiceSchedule(input.companyId, scheduleId);
}

export async function listRecurringInvoiceSchedules(companyId: number) {
  const db = await requireDb();
  return db
    .select({ schedule: recurringInvoiceSchedules, contact: contacts })
    .from(recurringInvoiceSchedules)
    .innerJoin(contacts, eq(contacts.id, recurringInvoiceSchedules.contactId))
    .where(and(eq(recurringInvoiceSchedules.companyId, companyId), isNull(recurringInvoiceSchedules.archivedAt)))
    .orderBy(desc(recurringInvoiceSchedules.createdAt));
}

export async function getRecurringInvoiceSchedule(companyId: number, scheduleId: number) {
  const db = await requireDb();
  const result = await db
    .select({ schedule: recurringInvoiceSchedules, contact: contacts })
    .from(recurringInvoiceSchedules)
    .innerJoin(contacts, eq(contacts.id, recurringInvoiceSchedules.contactId))
    .where(and(eq(recurringInvoiceSchedules.companyId, companyId), eq(recurringInvoiceSchedules.id, scheduleId), isNull(recurringInvoiceSchedules.archivedAt)))
    .limit(1);
  if (!result[0]) return null;
  const lineItems = await db.select().from(recurringInvoiceLineItems).where(eq(recurringInvoiceLineItems.scheduleId, scheduleId)).orderBy(asc(recurringInvoiceLineItems.position));
  return { ...result[0], lineItems };
}

export async function getRecurringInvoiceScheduleByTaskUid(taskUid: string) {
  const db = await requireDb();
  const result = await db
    .select({ schedule: recurringInvoiceSchedules, company: companies, contact: contacts })
    .from(recurringInvoiceSchedules)
    .innerJoin(companies, eq(companies.id, recurringInvoiceSchedules.companyId))
    .innerJoin(contacts, eq(contacts.id, recurringInvoiceSchedules.contactId))
    .where(eq(recurringInvoiceSchedules.heartbeatTaskUid, taskUid))
    .limit(1);
  if (!result[0]) return null;
  const lineItems = await db.select().from(recurringInvoiceLineItems).where(eq(recurringInvoiceLineItems.scheduleId, result[0].schedule.id)).orderBy(asc(recurringInvoiceLineItems.position));
  return { ...result[0], lineItems };
}

export async function setRecurringInvoiceScheduleActive(companyId: number, scheduleId: number, isActive: boolean, nextRunAt?: Date | null) {
  const db = await requireDb();
  const result = await db.update(recurringInvoiceSchedules).set({ isActive, nextRunAt: nextRunAt ?? null }).where(and(eq(recurringInvoiceSchedules.companyId, companyId), eq(recurringInvoiceSchedules.id, scheduleId), isNull(recurringInvoiceSchedules.archivedAt)));
  if (Number((result as any)[0]?.affectedRows ?? 0) !== 1) throw new Error("Recurring schedule not found in this company");
  return getRecurringInvoiceSchedule(companyId, scheduleId);
}

/**
 * Updates the next number for one recurring template. Once the template has
 * issued a financial invoice, its prefix is immutable and its sequence cannot
 * be moved backward, preventing duplicate HPP-style series numbers.
 */
export async function setRecurringInvoiceScheduleNumbering(companyId: number, scheduleId: number, input: { invoicePrefix: string; nextInvoiceSequence: number }) {
  const db = await requireDb();
  return db.transaction(async tx => {
    const schedule = (await tx.select().from(recurringInvoiceSchedules).where(and(
      eq(recurringInvoiceSchedules.id, scheduleId),
      eq(recurringInvoiceSchedules.companyId, companyId),
      isNull(recurringInvoiceSchedules.archivedAt),
    )).limit(1))[0];
    if (!schedule) throw new Error("Recurring schedule not found in this company");
    const allocatedInvoice = (await tx.select({ id: invoices.id }).from(invoices).where(and(
      eq(invoices.companyId, companyId),
      eq(invoices.recurringScheduleId, scheduleId),
      sql`${invoices.invoiceNumber} NOT LIKE 'DRAFT-%'`,
    )).limit(1))[0];
    const prefix = input.invoicePrefix.toUpperCase();
    const otherSeries = await tx.select({ invoicePrefix: recurringInvoiceSchedules.invoicePrefix }).from(recurringInvoiceSchedules).where(and(
      eq(recurringInvoiceSchedules.companyId, companyId),
      ne(recurringInvoiceSchedules.id, scheduleId),
    ));
    if (hasRecurringSeriesPrefixConflict(otherSeries.map(series => series.invoicePrefix), prefix)) {
      throw new Error("Another recurring schedule uses a prefix that could produce the same invoice number. Choose a distinct, non-overlapping series prefix.");
    }
    if (allocatedInvoice && prefix !== schedule.invoicePrefix) {
      throw new Error("The recurring invoice prefix cannot change after this schedule has issued a financial invoice.");
    }
    if (allocatedInvoice && input.nextInvoiceSequence < schedule.invoiceSequence) {
      throw new Error(`The next sequence cannot move backward from ${schedule.invoiceSequence} after this schedule has issued invoice numbers.`);
    }
    const candidateNumber = formatRecurringInvoiceNumber(prefix, input.nextInvoiceSequence);
    const existingInvoiceNumber = (await tx.select({ id: invoices.id }).from(invoices).where(and(
      eq(invoices.companyId, companyId),
      eq(invoices.invoiceNumber, candidateNumber),
    )).limit(1))[0];
    if (existingInvoiceNumber) throw new Error(`Invoice number ${candidateNumber} already exists in this company. Choose the next unused number.`);
    const updated = await tx.update(recurringInvoiceSchedules).set({ invoicePrefix: prefix, invoiceSequence: input.nextInvoiceSequence }).where(and(
      eq(recurringInvoiceSchedules.id, scheduleId),
      eq(recurringInvoiceSchedules.companyId, companyId),
      eq(recurringInvoiceSchedules.invoiceSequence, schedule.invoiceSequence),
      eq(recurringInvoiceSchedules.invoicePrefix, schedule.invoicePrefix),
    ));
    if (Number((updated as any)[0]?.affectedRows ?? 0) !== 1) {
      throw new Error("The recurring invoice series changed concurrently. Refresh and try again.");
    }
    return {
      schedule: (await tx.select().from(recurringInvoiceSchedules).where(eq(recurringInvoiceSchedules.id, scheduleId)).limit(1))[0],
      previousPrefix: schedule.invoicePrefix,
      previousNextSequence: schedule.invoiceSequence,
      hasAllocatedInvoice: Boolean(allocatedInvoice),
    };
  });
}

export async function deleteRecurringInvoiceSchedule(companyId: number, scheduleId: number) {
  const db = await requireDb();
  const result = await db.update(recurringInvoiceSchedules).set({ isActive: false, archivedAt: new Date(), nextRunAt: null }).where(and(
    eq(recurringInvoiceSchedules.companyId, companyId),
    eq(recurringInvoiceSchedules.id, scheduleId),
    isNull(recurringInvoiceSchedules.archivedAt),
  ));
  if (Number((result as any)[0]?.affectedRows ?? 0) !== 1) throw new Error("Recurring schedule not found in this company");
}

export function recurringOccurrenceKey(cadence: RecurringInvoiceCadence, executedAt = new Date()) {
  if (cadence === "daily") return `day-${executedAt.toISOString().slice(0, 10)}`;
  if (cadence === "yearly") return `year-${executedAt.getUTCFullYear()}`;
  if (cadence === "semiannual") return `half-${executedAt.getUTCFullYear()}-${String(executedAt.getUTCMonth() + 1).padStart(2, "0")}`;
  if (cadence === "monthly") return `month-${executedAt.toISOString().slice(0, 7)}`;
  const monday = new Date(Date.UTC(executedAt.getUTCFullYear(), executedAt.getUTCMonth(), executedAt.getUTCDate()));
  const offset = (monday.getUTCDay() + 6) % 7;
  monday.setUTCDate(monday.getUTCDate() - offset);
  return `week-${monday.toISOString().slice(0, 10)}`;
}

const RECURRING_RUN_LEASE_MS = 5 * 60_000;

export async function claimRecurringInvoiceRun(scheduleId: number, occurrenceKey: string) {
  const db = await requireDb();
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + RECURRING_RUN_LEASE_MS);
  try {
    const insert = await db.insert(recurringInvoiceRuns).values({ scheduleId, occurrenceKey, status: "running", startedAt: now, leaseExpiresAt });
    const run = (await db.select().from(recurringInvoiceRuns).where(eq(recurringInvoiceRuns.id, Number(insert[0].insertId))).limit(1))[0];
    return { claimed: true, run };
  } catch (error) {
    if ((error as { code?: string }).code !== "ER_DUP_ENTRY") throw error;
    const run = (await db.select().from(recurringInvoiceRuns).where(and(eq(recurringInvoiceRuns.scheduleId, scheduleId), eq(recurringInvoiceRuns.occurrenceKey, occurrenceKey))).limit(1))[0];
    if (!run) throw error;
    if (run.status === "failed") {
      const retry = await db.update(recurringInvoiceRuns).set({ status: "running", note: null, startedAt: now, leaseExpiresAt, completedAt: null }).where(and(eq(recurringInvoiceRuns.id, run.id), eq(recurringInvoiceRuns.status, "failed")));
      if (Number((retry as any)[0]?.affectedRows ?? 0) === 1) {
        const claimedRun = (await db.select().from(recurringInvoiceRuns).where(eq(recurringInvoiceRuns.id, run.id)).limit(1))[0];
        return { claimed: true, run: claimedRun };
      }
    }
    if (run.status === "running") {
      const reclaim = await db.update(recurringInvoiceRuns).set({ note: "Recovered an expired execution lease.", startedAt: now, leaseExpiresAt, completedAt: null }).where(and(
        eq(recurringInvoiceRuns.id, run.id),
        eq(recurringInvoiceRuns.status, "running"),
        sql`(${recurringInvoiceRuns.leaseExpiresAt} IS NULL OR ${recurringInvoiceRuns.leaseExpiresAt} <= ${now})`,
      ));
      if (Number((reclaim as any)[0]?.affectedRows ?? 0) === 1) {
        const claimedRun = (await db.select().from(recurringInvoiceRuns).where(eq(recurringInvoiceRuns.id, run.id)).limit(1))[0];
        return { claimed: true, run: claimedRun };
      }
    }
    return { claimed: false, run };
  }
}

export async function linkRecurringInvoiceRun(scheduleId: number, occurrenceKey: string, invoiceId: number) {
  const db = await requireDb();
  await db.update(recurringInvoiceRuns).set({ invoiceId }).where(and(
    eq(recurringInvoiceRuns.scheduleId, scheduleId),
    eq(recurringInvoiceRuns.occurrenceKey, occurrenceKey),
    eq(recurringInvoiceRuns.status, "running"),
  ));
}

export async function completeRecurringInvoiceRun(scheduleId: number, occurrenceKey: string, status: RecurringInvoiceRunStatus, input?: { invoiceId?: number | null; note?: string | null }) {
  const db = await requireDb();
  const update: { status: RecurringInvoiceRunStatus; note: string | null; completedAt: Date; leaseExpiresAt: null; invoiceId?: number | null } = {
    status,
    note: input?.note?.slice(0, 500) ?? null,
    completedAt: new Date(),
    leaseExpiresAt: null,
  };
  if (input && "invoiceId" in input) update.invoiceId = input.invoiceId ?? null;
  await db.update(recurringInvoiceRuns).set(update).where(and(eq(recurringInvoiceRuns.scheduleId, scheduleId), eq(recurringInvoiceRuns.occurrenceKey, occurrenceKey)));
}

export async function recordRecurringInvoiceExecution(companyId: number, scheduleId: number, invoiceId: number, nextRunAt?: Date | null) {
  const db = await requireDb();
  const update: { lastRunAt: Date; lastInvoiceId: number; nextRunAt?: Date | null } = { lastRunAt: new Date(), lastInvoiceId: invoiceId };
  if (nextRunAt !== undefined) update.nextRunAt = nextRunAt;
  await db.update(recurringInvoiceSchedules).set(update).where(and(
    eq(recurringInvoiceSchedules.companyId, companyId),
    eq(recurringInvoiceSchedules.id, scheduleId),
    eq(recurringInvoiceSchedules.isActive, true),
    isNull(recurringInvoiceSchedules.archivedAt),
  ));
}

export async function getInvoiceByRecurringOccurrence(companyId: number, scheduleId: number, occurrenceKey: string) {
  const db = await requireDb();
  const invoice = (await db.select().from(invoices).where(and(
    eq(invoices.companyId, companyId),
    eq(invoices.recurringScheduleId, scheduleId),
    eq(invoices.recurringOccurrenceKey, occurrenceKey),
  )).limit(1))[0];
  return invoice ? getInvoiceBundle(companyId, invoice.id) : null;
}

export async function getInvoiceBundle(companyId: number, invoiceId: number) {
  const db = await requireDb();
  const result = await db
    .select({ invoice: invoices, company: companies, contact: contacts })
    .from(invoices)
    .innerJoin(companies, eq(companies.id, invoices.companyId))
    .innerJoin(contacts, eq(contacts.id, invoices.contactId))
    .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)))
    .limit(1);
  if (!result[0]) return null;
  const lineItems = await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoiceId)).orderBy(asc(invoiceLineItems.position));
  return { ...result[0], lineItems };
}

export async function setInvoiceStatus(companyId: number, invoiceId: number, status: "finalized" | "sending" | "sent" | "paid" | "void", expectedCurrentStatus: InvoiceStatus, audit?: { actorUserId: number; correlationId: string; eventType: string; metadata?: Record<string, unknown> }) {
  const db = await requireDb();
  const now = new Date();
  await db.transaction(async tx => {
    const activeCompany = await tx.update(companies).set({ updatedAt: now }).where(and(eq(companies.id, companyId), isNull(companies.archivedAt)));
    if (Number((activeCompany as any)[0]?.affectedRows ?? 0) !== 1) throw new Error("This company is archived and invoice state cannot be changed.");
    const result = await tx.update(invoices).set({
      status,
      ...(status === "finalized" ? { finalizedAt: now } : {}),
      ...(status === "sent" ? { sentAt: now } : {}),
      ...(status === "paid" ? { paidAt: now } : {}),
    }).where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId), eq(invoices.status, expectedCurrentStatus)));
    if (Number((result as any)[0]?.affectedRows ?? 0) !== 1) throw new Error("Invoice state changed before this action could be completed");
    if (audit) await tx.insert(auditLogs).values({
      companyId,
      actorUserId: audit.actorUserId,
      eventType: audit.eventType,
      resourceType: "invoice",
      resourceId: String(invoiceId),
      outcome: "success",
      correlationId: audit.correlationId,
      metadataJson: audit.metadata ? JSON.stringify(audit.metadata) : null,
    });
  });
  return getInvoiceBundle(companyId, invoiceId);
}

/**
 * Reserve a document number only at the first send attempt. Recurring
 * templates increment their own invoice series; ordinary invoices retain the
 * company counter. Conditional updates prevent parallel sends from colliding.
 */
export async function allocateInvoiceNumberForSending(companyId: number, invoiceId: number) {
  const db = await requireDb();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const allocation = await db.transaction(async tx => {
      const activeCompany = await tx.update(companies).set({ updatedAt: new Date() }).where(and(eq(companies.id, companyId), isNull(companies.archivedAt)));
      if (Number((activeCompany as any)[0]?.affectedRows ?? 0) !== 1) throw new Error("This company is archived and cannot allocate invoice numbers.");
      const invoice = (await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId))).limit(1))[0];
      if (!invoice) throw new Error("Invoice not found");
      if (!isProvisionalInvoiceNumber(invoice.invoiceNumber)) return true;
      if (invoice.status !== "sending") throw new Error("Invoice must be claimed for sending before a number is allocated");
      let invoiceNumber: string;
      let sequenceUpdate: unknown;
      if (invoice.recurringScheduleId) {
        const schedule = (await tx.select().from(recurringInvoiceSchedules).where(and(
          eq(recurringInvoiceSchedules.id, invoice.recurringScheduleId),
          eq(recurringInvoiceSchedules.companyId, companyId),
        )).limit(1))[0];
        if (!schedule) throw new Error("Recurring invoice schedule not found");
        invoiceNumber = formatRecurringInvoiceNumber(schedule.invoicePrefix, schedule.invoiceSequence);
        sequenceUpdate = await tx.update(recurringInvoiceSchedules).set({ invoiceSequence: schedule.invoiceSequence + 1 }).where(and(
          eq(recurringInvoiceSchedules.id, schedule.id),
          eq(recurringInvoiceSchedules.companyId, companyId),
          eq(recurringInvoiceSchedules.invoiceSequence, schedule.invoiceSequence),
        ));
      } else {
        const company = (await tx.select().from(companies).where(eq(companies.id, companyId)).limit(1))[0];
        if (!company) throw new Error("Company not found");
        const nextSequence = company.invoiceSequence + 1;
        invoiceNumber = formatInvoiceNumber(company.invoicePrefix, invoice.issueDate, nextSequence);
        sequenceUpdate = await tx.update(companies).set({ invoiceSequence: nextSequence }).where(and(eq(companies.id, companyId), eq(companies.invoiceSequence, company.invoiceSequence)));
      }
      if (Number((sequenceUpdate as any)[0]?.affectedRows ?? 0) !== 1) return false;
      const invoiceUpdate = await tx.update(invoices).set({ invoiceNumber }).where(and(
        eq(invoices.id, invoiceId),
        eq(invoices.companyId, companyId),
        eq(invoices.status, "sending"),
        eq(invoices.invoiceNumber, invoice.invoiceNumber),
      ));
      if (Number((invoiceUpdate as any)[0]?.affectedRows ?? 0) !== 1) throw new Error("Invoice changed before its number could be assigned");
      return true;
    });
    if (allocation) return getInvoiceBundle(companyId, invoiceId);
  }
  throw new Error("Invoice number allocation was contended. Please retry the send.");
}

export async function getEmailProviderConfig(companyId: number) {
  const db = await requireDb();
  return (await db.select().from(emailProviderConfigs).where(eq(emailProviderConfigs.companyId, companyId)).limit(1))[0];
}

export async function saveEmailProviderConfig(companyId: number, userId: number, input: { provider: EmailProvider; displayName: string; encryptedConfig: string }) {
  const db = await requireDb();
  await db.insert(emailProviderConfigs).values({
    companyId,
    provider: input.provider,
    displayName: input.displayName,
    encryptedConfig: input.encryptedConfig,
    updatedByUserId: userId,
    isActive: true,
  }).onDuplicateKeyUpdate({ set: {
    provider: input.provider,
    displayName: input.displayName,
    encryptedConfig: input.encryptedConfig,
    updatedByUserId: userId,
    isActive: true,
  } });
  return getEmailProviderConfig(companyId);
}

export async function createEmailLog(input: {
  companyId: number;
  invoiceId?: number | null;
  provider: EmailProvider;
  recipient: string;
  bcc?: string | null;
  subject: string;
  correlationId: string;
  attemptKey?: string | null;
}) {
  const db = await requireDb();
  const insert = await db.insert(emailLogs).values({ ...input, invoiceId: input.invoiceId ?? null, bcc: input.bcc ?? null, attemptKey: input.attemptKey ?? null, status: "queued" });
  return Number(insert[0].insertId);
}

/** Create or re-open a known-safe pre-dispatch attempt. Uncertain outcomes are never re-opened automatically. */
export async function startInvoiceDeliveryLog(input: {
  companyId: number;
  invoiceId: number;
  provider: EmailProvider;
  recipient: string;
  bcc?: string | null;
  subject: string;
  correlationId: string;
}) {
  const db = await requireDb();
  const attemptKey = `invoice-${input.invoiceId}`;
  const existing = (await db.select().from(emailLogs).where(eq(emailLogs.attemptKey, attemptKey)).limit(1))[0];
  if (existing) {
    if (existing.status === "uncertain") throw new Error("Delivery outcome is uncertain. A company administrator must reconcile it before another provider request can be made.");
    await db.update(emailLogs).set({
      provider: input.provider,
      recipient: input.recipient,
      bcc: input.bcc ?? null,
      subject: input.subject,
      correlationId: input.correlationId,
      status: "queued",
      responseSummary: null,
      sentAt: null,
    }).where(eq(emailLogs.id, existing.id));
    return existing.id;
  }
  try {
    return await createEmailLog({ ...input, attemptKey });
  } catch (error) {
    if ((error as { code?: string }).code !== "ER_DUP_ENTRY") throw error;
    const raced = (await db.select().from(emailLogs).where(eq(emailLogs.attemptKey, attemptKey)).limit(1))[0];
    if (!raced || raced.status === "uncertain") throw new Error("Delivery outcome is uncertain. A company administrator must reconcile it before another provider request can be made.");
    return raced.id;
  }
}

export async function completeEmailLog(logId: number, status: "sent" | "failed" | "uncertain", responseSummary: string) {
  const db = await requireDb();
  await db.update(emailLogs).set({ status, responseSummary: responseSummary.slice(0, 4000), ...(status === "sent" ? { sentAt: new Date() } : {}) }).where(eq(emailLogs.id, logId));
}

export async function reconcileUncertainInvoiceDelivery(companyId: number, invoiceId: number, resolution: "mark_sent" | "retry") {
  const db = await requireDb();
  await db.transaction(async tx => {
    const invoice = (await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId))).limit(1))[0];
    if (!invoice || invoice.status !== "sending") throw new Error("Only a sending invoice with an uncertain delivery can be reconciled.");
    const log = (await tx.select().from(emailLogs).where(eq(emailLogs.attemptKey, `invoice-${invoiceId}`)).limit(1))[0];
    if (!log || log.status !== "uncertain") throw new Error("No uncertain provider attempt exists for this invoice.");
    const now = new Date();
    if (resolution === "mark_sent") {
      await tx.update(invoices).set({ status: "sent", sentAt: now }).where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId), eq(invoices.status, "sending")));
      await tx.update(emailLogs).set({ status: "sent", sentAt: now, responseSummary: "Administrator reconciled the uncertain provider outcome as delivered." }).where(eq(emailLogs.id, log.id));
    } else {
      await tx.update(invoices).set({ status: "finalized" }).where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId), eq(invoices.status, "sending")));
      await tx.update(emailLogs).set({ status: "failed", responseSummary: "Administrator confirmed a retry is safe; no automatic resend was performed." }).where(eq(emailLogs.id, log.id));
    }
  });
  return getInvoiceBundle(companyId, invoiceId);
}

export async function listEmailLogs(companyId: number) {
  const db = await requireDb();
  return db.select().from(emailLogs).where(eq(emailLogs.companyId, companyId)).orderBy(desc(emailLogs.createdAt)).limit(100);
}

export async function createAuditLog(input: {
  companyId?: number | null;
  actorUserId?: number | null;
  eventType: string;
  resourceType?: string | null;
  resourceId?: string | null;
  outcome: "success" | "failure";
  correlationId: string;
  ipHash?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const db = await requireDb();
  await db.insert(auditLogs).values({
    companyId: input.companyId ?? null,
    actorUserId: input.actorUserId ?? null,
    eventType: input.eventType,
    resourceType: input.resourceType ?? null,
    resourceId: input.resourceId ?? null,
    outcome: input.outcome,
    correlationId: input.correlationId,
    ipHash: input.ipHash ?? null,
    metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
  });
}

export async function listCompanyMembers(companyId: number) {
  const db = await requireDb();
  return db
    .select({ member: companyMembers, user: users })
    .from(companyMembers)
    .innerJoin(users, eq(users.id, companyMembers.userId))
    .where(eq(companyMembers.companyId, companyId))
    .orderBy(asc(users.name));
}

export async function assignCompanyMembership(companyId: number, email: string, role: CompanyMemberRole) {
  const db = await requireDb();
  const user = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
  if (!user) throw new Error("That person must sign in once before a company role can be assigned");
  await db.insert(companyMembers).values({ companyId, userId: user.id, role }).onDuplicateKeyUpdate({ set: { role } });
  return listCompanyMembers(companyId);
}

export async function recordWebhookEvent(input: {
  provider: string;
  eventId?: string | null;
  eventKey: string;
  status: "accepted" | "rejected" | "processed";
  correlationId: string;
  payloadDigest: string;
  note?: string | null;
}) {
  const db = await requireDb();
  const existing = await db.select({ id: webhookEvents.id }).from(webhookEvents).where(and(eq(webhookEvents.provider, input.provider), eq(webhookEvents.eventKey, input.eventKey))).limit(1);
  if (existing.length) return false;
  try {
    await db.insert(webhookEvents).values(input);
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") return false;
    throw error;
  }
}

export async function getDashboardMetrics(companyId: number) {
  const db = await requireDb();
  const rows = await db
    .select({ status: invoices.status, totalCents: invoices.totalCents })
    .from(invoices)
    .where(eq(invoices.companyId, companyId));
  const totals = rows.reduce((acc, row) => {
    acc.totalCents += row.totalCents;
    if (row.status === "sent") acc.outstandingCents += row.totalCents;
    if (row.status === "paid") acc.paidCents += row.totalCents;
    if (row.status === "draft") acc.draftCount += 1;
    return acc;
  }, { totalCents: 0, outstandingCents: 0, paidCents: 0, draftCount: 0 });
  const recentInvoices = await listInvoices(companyId);
  return { ...totals, recentInvoices: recentInvoices.slice(0, 5) };
}
