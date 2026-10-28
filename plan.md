# Welfare Pride Invoices — Implementation Plan

## Product scope

Build a secure, multi-tenant operational invoicing application with **Welfare Pride** as its default tenant and design language. The product will provide an authenticated invoice workspace, a tenant/company address book, invoice lifecycle controls, branded PDF rendering, and audit-ready delivery through an administrator-selected **Microsoft Graph API** or **SMTP** transport.

The implementation uses the initialized React + Express + tRPC + Drizzle/MySQL project. Manus OAuth will provide the hosted application login and session validation. The application owns tenant membership and roles, and every tenant-scoped query will be authorized on the server. The first project owner is promoted to platform administrator; platform administrators may create companies, grant tenant-level roles, and configure protected delivery settings.

The master prompt contains additional enterprise deployment and integration directions. This delivery will implement the working invoicing core and its secure extensibility points: HMAC-signed webhook verification, structured audit records, server-side rate limiting, Cloudflare-aware request handling, restricted storage uploads, and deployable Node/Docker/Hostinger documentation. Entra ID, Google, SAML 2.0, and TOTP need the organization’s identity-provider metadata and cannot truthfully be enabled without it; the implementation will retain a documented identity-integration boundary rather than simulate those controls.

## Key outcomes

1. **Authenticated multi-tenant workspace.** The dashboard will show invoice performance and recent delivery activity. Server-side role checks will distinguish `platform_admin`, `company_creator`, and `company_viewer`, with a company membership record as the tenant boundary.
2. **Invoice and address-book lifecycle.** Users with creator/admin access can manage contacts and invoice drafts, including structured line items, quantity, unit price, configurable tax/discount, notes, terms, payment instructions, due date, and client selection. Viewer users will be able to view and download only their permitted company invoices.
3. **Branded PDF invoices.** A server-only PDF service will embed locally supplied Roboto fonts, tenant/company contact details, normalized line items, tax/discount calculations, terms, payment instructions, and a proper company logo. Logo placement will use a bounded *contain* box with a configurable scale setting, preserving the aspect ratio and preventing oversized or distorted logos. A printable Welfare Pride letterhead preview will accompany the default brand package.
4. **Company branding administration.** Admins will set company name/contact information, colors, document footer, invoice logo scale, and optional logo alignment. The upload flow will validate ownership, MIME type, byte size, and image dimensions before storing a tenant-prefixed object key. The branding screen will include an immediate invoice-header preview so administrators can see the result before saving.
5. **Administrator-selected email delivery.** A delivery settings page will allow an administrator to select either:
   - **Microsoft Graph API** using tenant ID, application/client ID, application secret, sender mailbox, and configured display name; and
   - **SMTP** using host, port, TLS mode, username, password, from address, and configured display name.

   Credentials will be encrypted at rest using an application-held AES-256-GCM key and never returned to the browser. The configured provider will send a branded HTML summary with the invoice PDF attached, honor an optional BCC archive address, persist `queued`, `sent`, or `failed` audit results, and show an Admin **Email logs** page. Graph settings will include the requested **Send Test Email** action to verify the sender connection and configured display name. Successful end-to-end delivery requires the administrator to later supply real provider credentials and grant the Graph app `Mail.Send` application permission for the sender mailbox.
6. **Security, observability, and webhooks.** All mutation inputs will be schema-validated; unsafe status transitions will be prevented; database rows will be scoped to the company membership; sensitive routes will be rate-limited; and audit events will capture actor, tenant, resource, request correlation identifier, and outcome. A raw-body HMAC-SHA256 webhook verification endpoint will be included with a timestamp/replay window and a protected secret configuration requirement. CORS/CSP/cookie settings will preserve the managed Preview login behavior.
7. **Deployment and source control.** The repository will remain Docker-ready, expose an unauthenticated health path, honor `PORT`, and include deployment notes for Hostinger Node/Passenger, Docker Compose/VPS, and Cloudflare proxy/WAF configuration. On completion the project will be connected to a new private GitHub repository through the managed GitHub transfer flow and pushed to `main` after the user confirms the repository card.
8. **Recurring invoices and send-time numbering.** Invoice creators and company administrators will be able to save weekly or monthly invoice templates with a UTC delivery time, recipient, due-days, line items, taxes, terms, and payment instructions. A recurring schedule can either create a finalized invoice for review or, when an encrypted email provider is configured and the administrator explicitly opts in, send it automatically. Platform/service-owned Heartbeat jobs authenticate each callback, resolve the schedule exclusively by the scheduler-issued task UID, and use a durable per-occurrence run ledger with a recoverable lease and invoice link to prevent duplicate documents. Drafts use a clearly provisional reference; a company-scoped sequential document number (`PREFIX-YEAR-NNNN`) is allocated atomically only on the first actual send attempt. A durable outbox enters an explicit uncertain state before provider dispatch and blocks automatic resend until an administrator reconciles the outcome; an allocated number is never reused.

## Design direction — Welfare Pride operations console

- **Design movement:** A purpose-built, editorial operations console rather than a generic SaaS dashboard: clear hierarchy, practical density, and deliberate whitespace.
- **Core principles:** Credible and calm; transaction-focused; highly legible; accessible in routine administrative use.
- **Color philosophy:** Welfare Pride blue (`#5A92C9`) provides the steady structural field, orange (`#D58240`) is reserved for decisive financial attention and action, while white and near-black preserve document-grade clarity.
- **Layout paradigm:** A compact left navigation rail pairs with a broad, document-like work canvas. The invoice composer uses a structured two-column working surface with live totals and branded output evidence rather than a card grid of unrelated widgets.
- **Signature elements:** A slim Welfare Pride blue top band; orange status accents and due-date signals; subtle dotted/patterned blue surfaces inspired by the supplied brand guide; carefully bounded logos in document previews.
- **Interaction philosophy:** Keep administrative actions explicit. Users see calculations before save, delivery/provider configuration before a send, and brand changes in a live header preview before publishing them to invoices.
- **Animation:** Fast 150–220 ms opacity/position transitions only for navigation, side panels, and feedback. Never animate invoice values or delivery status changes ambiguously.
- **Typography system:** The supplied Roboto family is embedded locally. Headings use Roboto Bold/SemiBold with compact tracking; operational body and invoice copy use Roboto Regular/Medium; monetary totals use tabular numerals where available.
- **Brand essence:** “Welfare Pride Invoices gives organizations a precise, trustable way to create and deliver branded financial documents.” Personality: warm, accountable, organized.
- **Brand voice:** Direct and considerate. Examples: “Ready to send when you are.” and “Your client will receive a branded PDF and a complete delivery record.”
- **Wordmark & logo:** The supplied Welfare Pride logo remains the primary mark; no substitute wordmark will be invented. It will be preserved at original aspect ratio across web, document, and thumbnail placements.
- **Signature brand color:** Welfare Pride blue `#5A92C9`.

## Data and service design

- `companies`: branding, address/contact data, footer, invoice sequence, invoice logo sizing settings, and default delivery preferences.
- `company_members`: tenant membership and a constrained company role.
- `contacts`: address book records, scoped to one company.
- `invoices` / `invoice_line_items`: immutable finalized invoice data, generated invoice number, amount fields in minor currency units, status, and delivery timestamps.
- `email_provider_configs`: company configuration metadata and AES-GCM encrypted connection payload (never sent back to the client).
- `email_logs`: provider, recipient, BCC state, invoice reference, status, response summary, correlation ID, and timestamps.
- `audit_logs`: structured change/event history scoped to tenant and actor.
- `webhook_events`: protected inbound-event receipt data and replay token/key material reference.
- `recurring_invoice_schedules` / `recurring_invoice_line_items`: tenant-scoped recurring template, cadence, UTC run time, next callback state, optional automatic delivery, and immutable schedule line items.
- `recurring_invoice_runs`: unique schedule-occurrence ledger used to make scheduler retries idempotent and retain the resulting invoice and safe status summary.

The PDF generator, logo-storage service, encryption helper, delivery adapters, HMAC verifier, audit service, and request security middleware will be isolated under `server/services/` and `server/security/`. This prevents the UI from owning secrets or business-critical authorization logic.

## Project structure

```text
client/
  public/brand/                 # supplied original logo, dark/light variants, small document assets, Roboto web fonts
  public/manus-routes.json      # declared product routes
  src/components/               # shell, invoice form, logo fit control, reusable operational UI
  src/pages/                    # dashboard, invoices, recurring schedules, clients, branding, delivery, email logs, security
  src/styles/                   # Welfare Pride design tokens and document preview styles
server/
  security/                     # tenant authorization, HMAC verification, request limits, correlation IDs
  services/                     # PDFs, encrypted settings, Graph adapter, SMTP adapter, logo storage, audit service
  routes/                       # raw-body webhook, authenticated PDF download, and scheduler callback HTTP routes
  db.ts                         # scoped Drizzle persistence helpers
  routers.ts                    # validated tRPC business procedures
drizzle/
  schema.ts                     # persistent multi-tenant application model and role-safe data tables
docs/
  DEPLOYMENT.md                 # Hostinger, Docker/VPS, Cloudflare and secret configuration guidance
  SECURITY.md                   # security model, role boundaries, webhook signing, operational limits
brand-assets/
  README.md                     # asset catalogue plus original/optimized logo files and letterhead source
plan.md
TODO.md
```

## Dependencies and operational constraints

The build will add only the production dependencies needed for server PDF generation, SMTP delivery, image validation, and encryption-compatible handling. Provider credentials will be introduced through protected platform secrets after the code is ready; they will not be committed or written to `.env` files. The tenant-held provider payload will additionally require a runtime `APP_CONFIG_ENCRYPTION_KEY` for encryption. The app will present a secure configuration state rather than falsely claiming live email delivery until those credentials are supplied.

Invoice sending is an external action. The user has authorized building the capability; actual outbound test and client email messages will only be initiated by an authenticated administrator inside the application after provider configuration.
