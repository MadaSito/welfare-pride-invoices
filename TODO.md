# Welfare Pride Invoices — Delivery To-Do

- [x] **Branded operational workspace and packaged brand assets**
  - Use the supplied Welfare Pride logo, palette (`#5A92C9`, `#D58240`, white, black), and supplied Roboto font in the application and document output.
  - Deliver a responsive, accessible operational dashboard, compact navigation, invoice work canvas, and coherent Welfare Pride visual system rather than starter/sample UI.
  - Include a brand asset catalogue with the original logo, appropriately sized variants, dark/light usage assets where appropriate, and a printable letterhead/document asset.

- [x] **Secure identity, tenancy, and roles**
  - Preserve real Manus OAuth session validation and protect all app data behind authenticated server procedures.
  - Provide platform administrator, company invoice creator, and company invoice viewer roles, with membership stored per company and server-side tenant isolation for every company, contact, invoice, provider configuration, log, and asset request.
  - Bootstrap Welfare Pride as the default tenant without overwriting later administrative changes. Record security-sensitive mutations in structured audit logs with actor, tenant, correlation ID, and outcome.

- [x] **Companies, branding, contacts, and logo fitting**
  - Let administrators manage company contact details, invoice footer, primary/accent colors, default BCC archive address, address-book contacts, and document branding.
  - Provide a dedicated company-administrator invoicing-address editor with a live From-block preview; securely persist street, locality, region, postal code, and country and render the saved address on newly generated invoice PDFs.
  - Let administrators upload a company logo only after validated authorization, image type, byte size, and dimensions checks. Store it under a non-guessable tenant-prefixed key and retain its ownership record.
  - Provide controls and a live invoice-header preview for logo scale and alignment. Render every invoice logo with aspect ratio preserved in a bounded contain box so it cannot be stretched, cropped, or oversized.

- [x] **Invoice lifecycle and branded PDF rendering**
  - Support draft invoices with client, issue and due dates, provisional references that become sequential sent-document numbers, currency, taxable line items, line descriptions, quantity, unit price, discounts, configurable tax, notes, payment terms/conditions, and payment instructions for Stripe/ACH/check workflows.
  - Enforce server-side total calculation and protected status transitions. Creators/admins can create, edit and send permitted invoices; viewers can only view and download permitted invoices.
  - Generate a real server-side PDF using Roboto and company branding. The downloadable PDF must include sender and client contact details, invoice details, line-item table, totals, terms, notes, payment instructions, and a proportionally fitted logo.

- [x] **Administrator-selected Graph and SMTP email delivery**
  - Provide an admin delivery settings screen in which a company selects Microsoft Graph API or SMTP as its active provider. Graph settings include tenant ID, client ID, client secret, sender mailbox, and display name. SMTP settings include host, port, TLS mode, username, password, from address, and display name.
  - Encrypt provider connection payloads at rest with an application-held AES-256-GCM key; never send saved credential values to the browser, source tree, logs, or audit response.
  - Provide a Microsoft Graph **Send Test Email** action that sends through the configured Graph provider and displays the configured DisplayName in the test payload. Support a protected SMTP test path as well.
  - Send branded invoice email with PDF attachment through the selected provider, optional BCC archive, delivery correlation data, and a persisted email log state of `queued`, `sent`, `failed`, or reconciliation-required `uncertain`. Provide an admin email-log page.

- [x] **Security, webhook, and operational safeguards**
  - Validate all inputs with strict server schemas; rate-limit sensitive API routes; set security response headers compatible with embedded HTTPS Preview; and avoid exposing secrets in browser code or error messages.
  - Include an HMAC-SHA256 raw-body webhook verification endpoint with an event timestamp/replay window, correlation ID, and audit receipt. Document the webhook signing secret requirement.
  - Maintain Cloudflare/Hostinger/Docker deployment documentation, environment-secret requirements, CORS/cookie considerations, health checks, and operational limits. Do not claim identity-provider SSO or TOTP are active until the organization supplies their required provider configuration.

- [x] **Recurring invoices, approval, and incremental sent-document numbering**
  - Let invoice creators and company administrators configure, list, pause, resume, and archive daily, weekly, monthly, every-six-months, or yearly recurring invoice schedules with a UTC run time, client, due-days, invoice lines, taxes, discounts, payment instructions, terms, and notes. Semiannual schedules must use a selected first month plus day and run again six months later; yearly schedules must use a selected month plus day. Archival must retain the schedule’s series reservation, historical invoices, and run ledger.
  - Allow an explicit automatic-delivery option only when a tenant has an active protected Graph or SMTP configuration. Otherwise create the scheduled invoice in a distinct **awaiting approval** state, clearly expose it on both the recurring and invoice workspaces, and require a company creator or administrator to explicitly approve it before it can be sent or receive a financial number.
  - Put a visible **Generate for review** action on every review-first recurring schedule. It must create at most one pending generated invoice per project/schedule, leave the normal future scheduler cadence unchanged, and immediately surface the PDF review and approval controls.
  - Use the platform-owned authenticated scheduler callback, resolve schedules only from the platform-issued task UID, validate tenant ownership server-side, and persist a unique run occurrence with a recoverable lease and durable invoice link so retries or interruption cannot create or send a duplicate invoice.
  - Do not consume a financial invoice number for a draft or merely finalized document. At the first send attempt, manually created invoices atomically allocate a company-scoped `PREFIX-YEAR-NNNN` number; recurring schedules atomically allocate from their own prefix and sequence (for example, `HPP035`). The durable outbox is marked uncertain before provider dispatch and blocks automatic resend until an administrator reconciles it, while a number is never reused.
  - Let a company administrator securely set the invoice prefix and next number for each recurring schedule during migration from a prior system (for example, `HPP` and `35` after `HPP034`). Persist the series with that schedule, require bounded validated values, audit the change, reject overlapping rendered prefixes such as `HPP`/`HPP1`, and block moving the schedule backward or changing its prefix after it has issued a financial invoice.
  - Let a company administrator also set the next number for the company-wide one-off invoice series. Clearly distinguish this `PREFIX-YEAR-NNNN` counter from the independently configured recurring project/schedule series, validate and audit updates, and block moving the company counter backward after a one-off invoice has received a financial number.
  - Record schedule creation, updates, executions, invoice creation, delivery outcomes, and safe failures in the existing audit trail. Document deployment and publish prerequisites for the platform scheduler.

- [x] **Safe draft discard and company portal archive**
  - Let a company creator or administrator permanently discard only an unfinalized **draft** invoice through a confirmed, tenant-scoped server action. Delete its draft line items with it, record an audit event, and never permit this action for finalized, sending, sent, paid, void, or uncertain-delivery documents.
  - Let a company administrator archive a company from the portal without deleting invoices, contacts, email logs, credentials, audit records, recurring-series reservations, or scheduler run history. Hide archived companies from all normal workspace/company selectors and block ordinary tenant access and scheduler invoice creation while archived. Archive must serialize against invoice creation/delivery claims and refuse while a delivery is in progress, preventing a post-archive provider dispatch.
  - Provide an administrator-only archived-company list and restore action. Restoring must make the company available again without automatically reactivating recurring schedules; archive/restore actions must be audit logged and tenant-scoped.

- [x] **Quality, delivery, and GitHub source transfer**
  - Maintain TypeScript diagnostics, run type checks/build/tests applicable to modified code, and fix actionable errors.
  - Confirm the application has `/manus-routes.json`, an unauthenticated `/api/health`, durable object storage usage for uploaded logos/generated PDFs, and a production-capable Docker configuration.
  - Connect the finished project to a new private GitHub repository using the managed GitHub transfer confirmation flow, preserve project history, push the completed `main` branch, and confirm the resulting checkpoint/transfer status.
  - Status: application checks/build, health/route validation, PDF verification, responsive preview review, two additive migrations, and the canonical GitHub source checkpoint are complete.

- [x] **Standalone Hostinger authentication and user lifecycle management**
  - Before retiring the legacy platform login, create a default local platform-administrator account with a generated strong temporary password. Require that account to change its password at first login and complete TOTP MFA enrollment before receiving a full application session; disclose the initial username and password to the project owner only in the delivery response, never in source, logs, or Git.
  - Replace platform OAuth/JWT/session handling with application-owned opaque, revocable database sessions, cookie CSRF protection, local email/password authentication, password-change enforcement, TOTP MFA, recovery-code support, rate limits, session revocation, and safe browser error messages. Do not retain browser bearer-token or local/session-storage authentication fallbacks.
  - Add Microsoft Entra ID authorization-code sign-in with PKCE, state/nonce validation, issuer/tenant/audience validation, stable Entra object-ID linking, and invite/link-only provisioning. Entra credentials must be ordinary Hostinger environment variables and setup must not auto-grant invoice access based solely on a token email.
  - Provide platform administrators a full user lifecycle workspace: create local users with a generated one-time password, provision Entra users, assign/revoke company roles, activate/disable accounts, reset a local password, reset MFA/recovery codes, revoke active sessions, and audit every privileged mutation.
  - Remove platform OAuth, SDK, public runtime configuration, preview session/token fallback, notification, object-storage proxy, and scheduler/Heartbeat dependencies from production code. Replace recurring execution with a Hostinger-compatible cron-triggerable authenticated dispatcher, durable external/S3-compatible logo storage configuration, and standalone deployment documentation. Preserve current tenant boundaries, invoice/series safeguards, Graph/SMTP delivery, database audit history, and the protected recurring-run idempotency ledger.
  - Status: standalone identity/schema migrations are applied; the bootstrap administrator exists with forced password change and MFA setup; TypeScript checks, automated tests, production build, health, bad-login, cron-secret rejection, schema verification, and first-login-stage verification passed.

- [x] **Welfare Pride SSO and initial administrator setup**
  - Label the browser entry point as **Sign in with Welfare Pride Single Sign On (SSO)** while preserving the Microsoft Entra ID Authorization Code + PKCE implementation underneath.
  - Prompt every platform administrator after first full login with a setup checklist for Welfare Pride branding, Welfare Pride SSO, and Graph/SMTP delivery configuration. The checklist may be completed after the administrator deliberately reviews optional SSO and mail settings; it must clearly identify the server-security-key prerequisite.
  - Provide a permanent Security & access configuration panel for the Entra tenant ID, client ID, and encrypted client secret. Never return a stored secret to the browser; retain environment-variable fallback for immutable Hostinger deployments. Continue to require explicit user provisioning before any SSO identity gains portal access.
