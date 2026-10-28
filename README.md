# Welfare Pride Invoices

A secure, multi-tenant branded invoicing workspace for Welfare Pride and affiliated companies. The application creates real PDF invoices, fits company logos proportionally, keeps tenant data isolated, and lets company administrators select **Microsoft Graph API** or **SMTP** for delivery.

## Included capabilities

- Real Manus OAuth sessions and server-side company membership checks.
- Platform administrator, company invoice creator, and company invoice viewer roles.
- Company address books, branded invoice drafts, line items, taxes, discounts, terms, notes, payment instructions, and lifecycle states.
- PDFKit-generated Letter-size PDFs using local Roboto fonts and bounded, aspect-ratio-safe logo fitting.
- Tenant-controlled branding with protected PNG/JPEG uploads, invoice colors, footer text, BCC archive, logo scale, and logo alignment preview.
- Administrator-selected Microsoft Graph or SMTP delivery, AES-256-GCM encrypted provider payloads, test delivery, PDF attachments, and durable email logs.
- Weekly/monthly tenant-scoped recurring invoice templates with pause/resume/remove controls, UTC execution, review-first default behavior, and administrator-enabled auto-send through the selected provider.
- Service-owned, idempotent platform-scheduler execution with recoverable run leases plus atomic number allocation at first send; one-off invoices use the company `PREFIX-YEAR-NNNN` series, while each recurring schedule owns a protected series such as `HPP035`. Company administrators can migrate a recurring template’s prefix and next number from prior invoices, with no backward movement or prefix changes after that template issues a financial number. Archived schedules retain their protected series and invoice history; ambiguous series such as `HPP` and `HPP1` are rejected. Post-dispatch uncertainty is held for administrator reconciliation instead of being blindly resent.
- Draft-only discard controls: creators can permanently discard an unfinalized draft before it becomes an accounting document; finalized or delivered invoices stay immutable.
- Reversible company portal archival: company administrators can hide a tenant while preserving all records, credentials, audit history, and numbering; archived companies can be restored by a retained administrator, with recurring schedules safely paused.
- Structured audit data, correlation identifiers, validated HMAC-SHA256 webhook receipts, replay window enforcement, and conservative API rate limiting.

## Local development

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm dev
```

The health endpoint is `GET /api/health`; the page-route declaration is `GET /manus-routes.json`.

## Before enabling live email

Set `APP_CONFIG_ENCRYPTION_KEY` through the protected secret configuration flow. It must be a 32-byte base64 or hexadecimal value. Configure the selected provider through **Email delivery**; do not write Graph or SMTP credentials into source or `.env` files. See [deployment guidance](docs/DEPLOYMENT.md) and the [security model](docs/SECURITY.md) for Graph permissions, SMTP, webhooks, Cloudflare/Hostinger, Docker, and secret-handling requirements.

## Brand assets

The supplied Welfare Pride logo, locally hosted Roboto fonts, optimized variants, and editable letterhead reference are catalogued in [brand-assets](brand-assets/README.md).
