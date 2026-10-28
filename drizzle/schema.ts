import {
  boolean,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/** Authenticated Manus identities. The platform admin role is intentionally separate from tenant roles. */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const companies = mysqlTable(
  "companies",
  {
    id: int("id").autoincrement().primaryKey(),
    slug: varchar("slug", { length: 128 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    legalName: varchar("legalName", { length: 220 }),
    email: varchar("email", { length: 320 }),
    phone: varchar("phone", { length: 64 }),
    website: varchar("website", { length: 320 }),
    addressLine1: varchar("addressLine1", { length: 220 }),
    addressLine2: varchar("addressLine2", { length: 220 }),
    city: varchar("city", { length: 120 }),
    region: varchar("region", { length: 120 }),
    postalCode: varchar("postalCode", { length: 32 }),
    country: varchar("country", { length: 2 }),
    primaryColor: varchar("primaryColor", { length: 7 }).default("#5A92C9").notNull(),
    accentColor: varchar("accentColor", { length: 7 }).default("#D58240").notNull(),
    footerText: text("footerText"),
    logoKey: varchar("logoKey", { length: 512 }),
    logoScale: int("logoScale").default(100).notNull(),
    logoAlignment: mysqlEnum("logoAlignment", ["left", "right"]).default("left").notNull(),
    defaultBcc: varchar("defaultBcc", { length: 320 }),
    invoicePrefix: varchar("invoicePrefix", { length: 24 }).default("WP").notNull(),
    invoiceSequence: int("invoiceSequence").default(1000).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("companies_slug_uq").on(table.slug)],
);

export const companyMembers = mysqlTable(
  "company_members",
  {
    id: int("id").autoincrement().primaryKey(),
    companyId: int("companyId").notNull().references(() => companies.id, { onDelete: "cascade" }),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: mysqlEnum("role", ["platform_admin", "company_creator", "company_viewer"])
      .default("company_viewer")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("company_members_company_user_uq").on(table.companyId, table.userId),
    index("company_members_user_idx").on(table.userId),
  ],
);

export const contacts = mysqlTable(
  "contacts",
  {
    id: int("id").autoincrement().primaryKey(),
    companyId: int("companyId").notNull().references(() => companies.id, { onDelete: "cascade" }),
    companyName: varchar("companyName", { length: 220 }).notNull(),
    contactName: varchar("contactName", { length: 180 }),
    email: varchar("email", { length: 320 }),
    phone: varchar("phone", { length: 64 }),
    addressLine1: varchar("addressLine1", { length: 220 }),
    addressLine2: varchar("addressLine2", { length: 220 }),
    city: varchar("city", { length: 120 }),
    region: varchar("region", { length: 120 }),
    postalCode: varchar("postalCode", { length: 32 }),
    country: varchar("country", { length: 2 }),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("contacts_company_idx").on(table.companyId)],
);

export const recurringInvoiceSchedules = mysqlTable(
  "recurring_invoice_schedules",
  {
    id: int("id").autoincrement().primaryKey(),
    companyId: int("companyId").notNull().references(() => companies.id, { onDelete: "cascade" }),
    contactId: int("contactId").notNull().references(() => contacts.id),
    name: varchar("name", { length: 160 }).notNull(),
    cadence: mysqlEnum("cadence", ["weekly", "monthly"]).notNull(),
    dayOfWeek: int("dayOfWeek"),
    dayOfMonth: int("dayOfMonth"),
    hourUtc: int("hourUtc").default(9).notNull(),
    minuteUtc: int("minuteUtc").default(0).notNull(),
    dueDays: int("dueDays").default(30).notNull(),
    autoSend: boolean("autoSend").default(false).notNull(),
    isActive: boolean("isActive").default(true).notNull(),
    heartbeatTaskUid: varchar("heartbeatTaskUid", { length: 160 }).notNull(),
    nextRunAt: timestamp("nextRunAt"),
    lastRunAt: timestamp("lastRunAt"),
    lastInvoiceId: int("lastInvoiceId"),
    currency: varchar("currency", { length: 3 }).default("USD").notNull(),
    taxRateBps: int("taxRateBps").default(0).notNull(),
    discountRateBps: int("discountRateBps").default(0).notNull(),
    notes: text("notes"),
    terms: text("terms"),
    paymentInstructions: text("paymentInstructions"),
    createdByUserId: int("createdByUserId").notNull().references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("recurring_invoice_schedules_task_uq").on(table.heartbeatTaskUid),
    index("recurring_invoice_schedules_company_active_idx").on(table.companyId, table.isActive),
    index("recurring_invoice_schedules_contact_idx").on(table.contactId),
  ],
);

export const invoices = mysqlTable(
  "invoices",
  {
    id: int("id").autoincrement().primaryKey(),
    companyId: int("companyId").notNull().references(() => companies.id, { onDelete: "cascade" }),
    contactId: int("contactId").notNull().references(() => contacts.id),
    invoiceNumber: varchar("invoiceNumber", { length: 64 }).notNull(),
    status: mysqlEnum("status", ["draft", "finalized", "sending", "sent", "paid", "void"])
      .default("draft")
      .notNull(),
    currency: varchar("currency", { length: 3 }).default("USD").notNull(),
    issueDate: timestamp("issueDate").notNull(),
    dueDate: timestamp("dueDate").notNull(),
    taxRateBps: int("taxRateBps").default(0).notNull(),
    discountRateBps: int("discountRateBps").default(0).notNull(),
    subtotalCents: int("subtotalCents").default(0).notNull(),
    taxCents: int("taxCents").default(0).notNull(),
    discountCents: int("discountCents").default(0).notNull(),
    totalCents: int("totalCents").default(0).notNull(),
    notes: text("notes"),
    terms: text("terms"),
    paymentInstructions: text("paymentInstructions"),
    createdByUserId: int("createdByUserId").notNull().references(() => users.id),
    recurringScheduleId: int("recurringScheduleId").references(() => recurringInvoiceSchedules.id, { onDelete: "set null" }),
    recurringOccurrenceKey: varchar("recurringOccurrenceKey", { length: 48 }),
    finalizedAt: timestamp("finalizedAt"),
    sentAt: timestamp("sentAt"),
    paidAt: timestamp("paidAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("invoices_company_number_uq").on(table.companyId, table.invoiceNumber),
    uniqueIndex("invoices_recurring_occurrence_uq").on(table.recurringScheduleId, table.recurringOccurrenceKey),
    index("invoices_company_status_idx").on(table.companyId, table.status),
    index("invoices_contact_idx").on(table.contactId),
  ],
);

export const invoiceLineItems = mysqlTable(
  "invoice_line_items",
  {
    id: int("id").autoincrement().primaryKey(),
    invoiceId: int("invoiceId").notNull().references(() => invoices.id, { onDelete: "cascade" }),
    position: int("position").notNull(),
    description: varchar("description", { length: 500 }).notNull(),
    quantity: int("quantity").default(1).notNull(),
    unitPriceCents: int("unitPriceCents").default(0).notNull(),
    taxable: boolean("taxable").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("invoice_items_invoice_idx").on(table.invoiceId)],
);

export const recurringInvoiceLineItems = mysqlTable(
  "recurring_invoice_line_items",
  {
    id: int("id").autoincrement().primaryKey(),
    scheduleId: int("scheduleId").notNull().references(() => recurringInvoiceSchedules.id, { onDelete: "cascade" }),
    position: int("position").notNull(),
    description: varchar("description", { length: 500 }).notNull(),
    quantity: int("quantity").default(1).notNull(),
    unitPriceCents: int("unitPriceCents").default(0).notNull(),
    taxable: boolean("taxable").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("recurring_invoice_items_schedule_idx").on(table.scheduleId)],
);

export const recurringInvoiceRuns = mysqlTable(
  "recurring_invoice_runs",
  {
    id: int("id").autoincrement().primaryKey(),
    scheduleId: int("scheduleId").notNull().references(() => recurringInvoiceSchedules.id, { onDelete: "cascade" }),
    occurrenceKey: varchar("occurrenceKey", { length: 48 }).notNull(),
    status: mysqlEnum("status", ["running", "created", "sent", "failed", "uncertain"]).default("running").notNull(),
    invoiceId: int("invoiceId").references(() => invoices.id, { onDelete: "set null" }),
    note: varchar("note", { length: 500 }),
    startedAt: timestamp("startedAt").defaultNow().notNull(),
    leaseExpiresAt: timestamp("leaseExpiresAt"),
    completedAt: timestamp("completedAt"),
  },
  table => [
    uniqueIndex("recurring_invoice_runs_schedule_occurrence_uq").on(table.scheduleId, table.occurrenceKey),
    index("recurring_invoice_runs_schedule_started_idx").on(table.scheduleId, table.startedAt),
  ],
);

export const emailProviderConfigs = mysqlTable(
  "email_provider_configs",
  {
    id: int("id").autoincrement().primaryKey(),
    companyId: int("companyId").notNull().references(() => companies.id, { onDelete: "cascade" }),
    provider: mysqlEnum("provider", ["microsoft_graph", "smtp"]).notNull(),
    displayName: varchar("displayName", { length: 160 }).notNull(),
    encryptedConfig: text("encryptedConfig").notNull(),
    isActive: boolean("isActive").default(true).notNull(),
    updatedByUserId: int("updatedByUserId").notNull().references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("email_provider_company_uq").on(table.companyId)],
);

export const emailLogs = mysqlTable(
  "email_logs",
  {
    id: int("id").autoincrement().primaryKey(),
    companyId: int("companyId").notNull().references(() => companies.id, { onDelete: "cascade" }),
    invoiceId: int("invoiceId").references(() => invoices.id, { onDelete: "set null" }),
    provider: mysqlEnum("provider", ["microsoft_graph", "smtp"]).notNull(),
    status: mysqlEnum("status", ["queued", "sent", "failed", "uncertain"]).default("queued").notNull(),
    recipient: varchar("recipient", { length: 320 }).notNull(),
    bcc: varchar("bcc", { length: 320 }),
    subject: varchar("subject", { length: 300 }).notNull(),
    attemptKey: varchar("attemptKey", { length: 96 }),
    responseSummary: text("responseSummary"),
    correlationId: varchar("correlationId", { length: 96 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    sentAt: timestamp("sentAt"),
  },
  table => [
    index("email_logs_company_created_idx").on(table.companyId, table.createdAt),
    uniqueIndex("email_logs_attempt_key_uq").on(table.attemptKey),
  ],
);

export const auditLogs = mysqlTable(
  "audit_logs",
  {
    id: int("id").autoincrement().primaryKey(),
    companyId: int("companyId").references(() => companies.id, { onDelete: "set null" }),
    actorUserId: int("actorUserId").references(() => users.id, { onDelete: "set null" }),
    eventType: varchar("eventType", { length: 120 }).notNull(),
    resourceType: varchar("resourceType", { length: 80 }),
    resourceId: varchar("resourceId", { length: 96 }),
    outcome: mysqlEnum("outcome", ["success", "failure"]).notNull(),
    correlationId: varchar("correlationId", { length: 96 }).notNull(),
    ipHash: varchar("ipHash", { length: 96 }),
    metadataJson: text("metadataJson"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("audit_logs_company_created_idx").on(table.companyId, table.createdAt)],
);

export const webhookEvents = mysqlTable(
  "webhook_events",
  {
    id: int("id").autoincrement().primaryKey(),
    provider: varchar("provider", { length: 80 }).notNull(),
    eventId: varchar("eventId", { length: 160 }),
    eventKey: varchar("eventKey", { length: 240 }).default("").notNull(),
    receivedAt: timestamp("receivedAt").defaultNow().notNull(),
    processedAt: timestamp("processedAt"),
    status: mysqlEnum("status", ["accepted", "rejected", "processed"]).notNull(),
    correlationId: varchar("correlationId", { length: 96 }).notNull(),
    payloadDigest: varchar("payloadDigest", { length: 128 }).notNull(),
    note: varchar("note", { length: 500 }),
  },
  table => [
    uniqueIndex("webhook_events_provider_event_key_uq").on(table.provider, table.eventKey),
    index("webhook_events_provider_created_idx").on(table.provider, table.receivedAt),
  ],
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Company = typeof companies.$inferSelect;
export type CompanyMemberRole = "platform_admin" | "company_creator" | "company_viewer";
export type InvoiceStatus = "draft" | "finalized" | "sending" | "sent" | "paid" | "void";
export type EmailProvider = "microsoft_graph" | "smtp";
export type RecurringInvoiceCadence = "weekly" | "monthly";
export type RecurringInvoiceRunStatus = "running" | "created" | "sent" | "failed" | "uncertain";
