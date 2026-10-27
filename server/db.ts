import { and, asc, desc, eq, sql } from "drizzle-orm";
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
  type CompanyMemberRole,
  type EmailProvider,
  type InsertUser,
  type InvoiceStatus,
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
  if (user.role === "admin") return db.select().from(companies).orderBy(asc(companies.name));
  return db
    .select({ company: companies, memberRole: companyMembers.role })
    .from(companyMembers)
    .innerJoin(companies, eq(companies.id, companyMembers.companyId))
    .where(eq(companyMembers.userId, user.id))
    .orderBy(asc(companies.name));
}

export async function getCompanyById(companyId: number) {
  const db = await requireDb();
  return (await db.select().from(companies).where(eq(companies.id, companyId)).limit(1))[0];
}

export async function getCompanyAccess(user: User, companyId: number): Promise<CompanyMemberRole | null> {
  if (user.role === "admin") return "platform_admin";
  const db = await requireDb();
  const member = await db
    .select({ role: companyMembers.role })
    .from(companyMembers)
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, user.id)))
    .limit(1);
  return member[0]?.role ?? null;
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

export async function setCompanyLogoKey(companyId: number, logoKey: string) {
  const db = await requireDb();
  await db.update(companies).set({ logoKey }).where(eq(companies.id, companyId));
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

function nextInvoiceNumber(prefix: string) {
  return `${prefix || "INV"}-${new Date().getUTCFullYear()}-${nanoid(7).toUpperCase()}`;
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
}) {
  const db = await requireDb();
  const company = await getCompanyById(companyId);
  if (!company) throw new Error("Company not found");
  const client = (await db.select().from(contacts).where(and(eq(contacts.id, input.contactId), eq(contacts.companyId, companyId))).limit(1))[0];
  if (!client) throw new Error("Client does not belong to this company");
  const totals = calculateInvoiceTotals(input.lineItems, input.taxRateBps, input.discountRateBps);
  let invoiceId = 0;
  await db.transaction(async tx => {
    const insert = await tx.insert(invoices).values({
      companyId,
      contactId: input.contactId,
      invoiceNumber: nextInvoiceNumber(company.invoicePrefix),
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

export async function listInvoices(companyId: number) {
  const db = await requireDb();
  return db
    .select({ invoice: invoices, contact: contacts })
    .from(invoices)
    .innerJoin(contacts, eq(contacts.id, invoices.contactId))
    .where(eq(invoices.companyId, companyId))
    .orderBy(desc(invoices.createdAt));
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

export async function setInvoiceStatus(companyId: number, invoiceId: number, status: "finalized" | "sending" | "sent" | "paid" | "void", expectedCurrentStatus: InvoiceStatus) {
  const db = await requireDb();
  const now = new Date();
  const result = await db.update(invoices).set({
    status,
    ...(status === "finalized" ? { finalizedAt: now } : {}),
    ...(status === "sent" ? { sentAt: now } : {}),
    ...(status === "paid" ? { paidAt: now } : {}),
  }).where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId), eq(invoices.status, expectedCurrentStatus)));
  if (Number((result as any)[0]?.affectedRows ?? 0) !== 1) throw new Error("Invoice state changed before this action could be completed");
  return getInvoiceBundle(companyId, invoiceId);
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
}) {
  const db = await requireDb();
  const insert = await db.insert(emailLogs).values({ ...input, invoiceId: input.invoiceId ?? null, bcc: input.bcc ?? null, status: "queued" });
  return Number(insert[0].insertId);
}

export async function completeEmailLog(logId: number, status: "sent" | "failed", responseSummary: string) {
  const db = await requireDb();
  await db.update(emailLogs).set({ status, responseSummary: responseSummary.slice(0, 4000), ...(status === "sent" ? { sentAt: new Date() } : {}) }).where(eq(emailLogs.id, logId));
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
