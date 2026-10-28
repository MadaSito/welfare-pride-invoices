# Welfare Pride Invoices — Security Model

## Authorization and tenancy

The app validates the real Manus OAuth session on every protected tRPC request and PDF download. A user’s platform role (`admin` or `user`) is separate from tenant membership. Company resources are scoped through `company_members` and an explicit role hierarchy:

| Role | Allowed actions |
| --- | --- |
| `company_viewer` | View and download permitted company invoices only |
| `company_creator` | Viewer actions plus create, edit draft, finalize, and send company invoices; manage company contacts |
| `platform_admin` | Full company administration: branding, members, delivery configuration, email logs, and security controls |
| Platform `admin` | Cross-tenant operating role; may provision companies and receives company-administrator access |

Every contact, invoice, line item, provider configuration, email log, and storage upload is authorized on the server with the requested `companyId`; a client-provided identifier never by itself grants access.

## Credential protection

Graph and SMTP credentials are entered in the administrator screen but are encrypted before database persistence with AES-256-GCM. The server loads the encryption material only from `APP_CONFIG_ENCRYPTION_KEY`. Saved providers expose only safe metadata such as selected provider and display name. Client secrets, SMTP passwords, HMAC keys, storage credentials, and database credentials are never added to the browser bundle, user-visible API output, or audit metadata.

## Request and document safeguards

The server disables the `X-Powered-By` header, uses a request correlation identifier, adds `nosniff`, strict referrer, and permissions headers, and rate-limits `/api/*` requests in-process. It deliberately does not set `X-Frame-Options` or restrictive `frame-ancestors`, because authenticated Preview runs inside a cross-site HTTPS frame. Sessions preserve `SameSite=None; Secure` and HttpOnly behavior required for Preview compatibility.

Logo uploads accept PNG/JPEG only, inspect the binary signature and dimensions, limit size to 5 MB, generate a tenant-prefixed object key server-side, and store ownership via the company record. PDF rendering uses a bounded `fit` box and locally hosted Roboto files, so logo aspect ratios are preserved and untrusted image URLs are not fetched from the browser.

Invoice values are accepted as minor currency units on the server after strict Zod validation. Subtotal, discount, taxable base, tax, and total are recomputed server-side; status changes block editing after finalization. PDF downloads use an authenticated route and `Cache-Control: private, no-store`. A creator/admin may permanently discard only a tenant-scoped invoice still in `draft`; it has no financial number, its line items are removed with it, and the event is audited. Finalized, sending, sent, paid, void, and uncertain-delivery documents cannot be discarded. Draft and finalized-review invoices use a provisional reference. The first actual send claims the document and atomically assigns its financial number: ordinary invoices use the company `PREFIX-YEAR-NNNN` counter, while recurring invoices use their schedule’s independently guarded prefix/sequence, such as `HPP035`. Concurrent sends cannot receive the same number. A number is not reclaimed after a failed or uncertain delivery, preventing accidental reuse.

## Webhook verification

`POST /api/webhooks/delivery` requires the raw request bytes and headers:

- `x-wp-timestamp`: Unix seconds or milliseconds.
- `x-wp-signature`: `sha256=<hex hmac>` computed over `<timestamp>.<raw body>`.

The endpoint rejects unknown/malformed signatures using a timing-safe comparison, rejects timestamps outside a five-minute replay window, emits a correlation ID, and records accepted/rejected receipt data without persisting the raw payload. Protect `WEBHOOK_SIGNING_SECRET` through the same protected-secret flow used for runtime configuration.

## Auditing and operational boundaries

Security-sensitive actions including invoice creation/finalization/sending, logo upload, role assignment, branding changes, and delivery configuration/test attempts produce structured audit records with an actor, resource type, tenant, outcome, and correlation ID. Invoice delivery creates a durable outbox log before provider dispatch. Known pre-dispatch failures are `failed`; a timeout, crash, or error after dispatch starts is `uncertain`, keeps the invoice in `sending`, and is never automatically resent. A company administrator must reconcile the provider outcome in Email logs by marking it delivered or explicitly enabling a later manual retry.

Recurring-series migration is a company-administrator-only authenticated mutation on the individual schedule. It accepts a validated alphanumeric prefix and bounded positive next number, updates the schedule with a conditional transactional write, captures the prior and requested values in the audit log, and prevents moving backward or changing the prefix after that template has allocated a financial invoice number. Prefixes that could render ambiguously (for example, `HPP` and `HPP1`) are rejected within a company, and the requested next rendered number is checked against the company invoice history. It changes only the next recurring invoice to be issued and never rewrites historical invoice records.

## Recurring invoice scheduler

Recurring schedule creation, pause/resume, and archival require tenant creator access; automatic delivery additionally requires a tenant administrator and an active encrypted provider configuration. The server creates, updates, and deletes each platform scheduler task through a shared service identity, while retaining the initiating user only in the audit data. Archival disables the task and hides the schedule from normal operations while retaining its series reservation, invoices, and run ledger. This lets any subsequently authorized tenant operator manage the schedule without breaking historical numbering. `POST /api/scheduled/recurring-invoices` accepts only a verified platform scheduler identity, derives the schedule solely from that task UID, and does not trust callback-body company, invoice, or recipient values.

Companies are archived rather than deleted. Company archive requires an active company-administrator membership, locks and marks the tenant before schedule deactivation, and refuses while any invoice delivery is actively `sending`; invoice creation, discard, status changes, and number allocation each reassert an active company inside their own transaction. This prevents a successful archive from racing a later provider dispatch. Archival hides the tenant from normal workspace discovery, blocks routine tenant authorization and invoice delivery, deactivates recurring schedules, and retains invoices, contacts, email logs, provider configuration, audit records, and schedule history. Archived-company listing and restore are limited to administrators who retain a membership for that tenant; restoring does not reactivate recurring schedules automatically. Archive and restore actions are audit logged.

Every UTC daily, weekly, monthly, semiannual, or yearly occurrence has a unique run ledger row, a five-minute recoverable lease, and a durable invoice link recorded before delivery. Semiannual schedules are anchored to an explicit January–June month and day, while yearly schedules are anchored to an explicit month and day; server validation, cron generation, next-run calculation, and occurrence keys use the same saved anchors. The persisted scheduler-selected `nextRunAt`, not delayed callback arrival time, anchors the occurrence key and issue date. Retries reuse that row and existing invoice record instead of creating another document. Scheduled invoice creation obtains an active, unarchived schedule fence inside the same transaction, so a completed pause/archive cannot race a new recurring document. An in-progress or uncertain provider attempt is never duplicated. Schedule execution, created/finalized invoices, auto-send success, safe failures, and reconciliations are retained in the company audit trail.

The included in-process rate limiter is a conservative baseline. For production multi-instance traffic, use Cloudflare WAF/rate limiting and a shared store such as Redis for gateway limits, CIDR controls, webhook queues, and dynamic blocklists. Configure Entra ID/Google/SAML/TOTP only after their provider metadata, policies, and organization-required enrollment controls are available; they are not represented as falsely active in this baseline.
