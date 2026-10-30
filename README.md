# Welfare Pride Invoices

A secure, multi-tenant branded invoicing workspace for Welfare Pride and affiliated companies. The application creates real PDF invoices, fits company logos proportionally, keeps tenant data isolated, and lets company administrators select **Microsoft Graph API** or **SMTP** for delivery.

## Included capabilities

- Standalone opaque application sessions, forced local password change, TOTP MFA/recovery codes, CSRF verification, and Microsoft Entra ID Authorization Code + PKCE sign-in.
- Platform-administrator user lifecycle controls for local/Entra provisioning, disablement, company role assignment, password/MFA reset, and session revocation.
- Platform administrator, company invoice creator, and company invoice viewer roles.
- Company address books, branded invoice drafts, line items, taxes, discounts, terms, notes, payment instructions, and lifecycle states.
- PDFKit-generated Letter-size PDFs using local Roboto fonts and bounded, aspect-ratio-safe logo fitting.
- Tenant-controlled branding with protected PNG/JPEG uploads, invoice colors, footer text, BCC archive, logo scale, and logo alignment preview.
- Administrator-selected Microsoft Graph or SMTP delivery, AES-256-GCM encrypted provider payloads, safe non-secret reconfiguration, test delivery, PDF attachments, sanitized subject/HTML templates, explicit administrator resends, and durable email logs.
- Daily, weekly, monthly, every-six-months, and yearly tenant-scoped recurring invoice templates with pause/resume/archive controls, UTC execution, explicit review-first approval, and administrator-enabled auto-send through the selected provider. Each review-first project has a visible **Generate for review** action that creates one pending document without changing the scheduled cadence; generated invoices enter an **awaiting approval** queue and need a creator/admin approval before they become eligible for delivery. Semiannual schedules select a January–June anchor month and day; yearly schedules select a month and day.
- Hostinger cron-compatible, secret-authenticated recurring execution with recoverable run leases plus atomic number allocation at first send; one-off invoices use the company `PREFIX-YEAR-NNNN` series, while each recurring schedule owns a protected project series such as `HPP035`. Company administrators can migrate either the next company one-off number or a recurring template’s prefix/next number from prior invoices, with no backward movement after a local financial number. Archived schedules retain their protected series and invoice history; ambiguous series such as `HPP` and `HPP1` are rejected. Post-dispatch uncertainty is held for administrator reconciliation instead of being blindly resent.
- Draft-only discard controls: creators can permanently discard an unfinalized draft before it becomes an accounting document; finalized or delivered invoices stay immutable.
- Reversible company portal archival: company administrators can hide a tenant while preserving all records, credentials, audit history, and numbering; archived companies can be restored by a retained administrator, with recurring schedules safely paused.
- Structured audit data, correlation identifiers, validated HMAC-SHA256 webhook receipts, replay window enforcement, and conservative API rate limiting.
- A first-administrator setup centre for company branding, Welfare Pride SSO, Graph/SMTP mail, client-facing email templates, and backup configuration after local password/MFA completion. The host-managed root encryption key is checked but never entered through the browser.
- Optional Microsoft Clarity analytics using the official browser package, an encrypted platform-administrator configuration, audit-logged enable/disable changes, strict project-ID validation, and an explicit privacy/consent notice. See [Clarity configuration guidance](docs/CLARITY.md).
- Platform-administrator local credential-free JSON exports plus encrypted cloud backups to Amazon/Wasabi/Backblaze S3-compatible storage or Microsoft SharePoint document libraries, with recorded test/upload outcomes and secret exclusions.

## Local development

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm bootstrap:admin
pnpm dev
```

The health endpoint is `GET /api/health`.

## Hostinger and self-hosted deployment

Deploy the `main` branch from the repository root on Hostinger Node.js Web App Hosting with Node 22, pnpm, build command `pnpm deploy:hostinger`, and entry file `dist/index.js`. The complete production variables, first-admin bootstrap, MFA, recurring-cron, GitHub update, native VPS, and Docker instructions are in [docs/HOSTINGER_DEPLOYMENT.md](docs/HOSTINGER_DEPLOYMENT.md). The portable installer selector is `./scripts/install.sh` after cloning the repository to a Linux host.

## Before enabling live email

Set `APP_CONFIG_ENCRYPTION_KEY` in Hostinger environment configuration. It must be a 32-byte base64 or hexadecimal value. After the first full local-admin login, use **Set up Welfare Pride Invoices** to configure branding, optional SSO, delivery/template settings, and backup destinations. Do not write Graph, SMTP, Entra, S3, SharePoint, database, or scheduler credentials into source or `.env` files. See [deployment guidance](docs/DEPLOYMENT.md) and the [security model](docs/SECURITY.md) for the complete standalone operating model.

## Brand assets

The supplied Welfare Pride logo, locally hosted Roboto fonts, optimized variants, and editable letterhead reference are catalogued in [brand-assets](brand-assets/README.md).
