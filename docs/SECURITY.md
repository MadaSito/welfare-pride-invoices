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

Invoice values are accepted as minor currency units on the server after strict Zod validation. Subtotal, discount, taxable base, tax, and total are recomputed server-side; status changes block editing after finalization. PDF downloads use an authenticated route and `Cache-Control: private, no-store`.

## Webhook verification

`POST /api/webhooks/delivery` requires the raw request bytes and headers:

- `x-wp-timestamp`: Unix seconds or milliseconds.
- `x-wp-signature`: `sha256=<hex hmac>` computed over `<timestamp>.<raw body>`.

The endpoint rejects unknown/malformed signatures using a timing-safe comparison, rejects timestamps outside a five-minute replay window, emits a correlation ID, and records accepted/rejected receipt data without persisting the raw payload. Protect `WEBHOOK_SIGNING_SECRET` through the same protected-secret flow used for runtime configuration.

## Auditing and operational boundaries

Security-sensitive actions including invoice creation/finalization/sending, logo upload, role assignment, branding changes, and delivery configuration/test attempts produce structured audit records with an actor, resource type, tenant, outcome, and correlation ID. Delivery attempts also create `queued`, `sent`, or `failed` email logs.

The included in-process rate limiter is a conservative baseline. For production multi-instance traffic, use Cloudflare WAF/rate limiting and a shared store such as Redis for gateway limits, CIDR controls, webhook queues, and dynamic blocklists. Configure Entra ID/Google/SAML/TOTP only after their provider metadata, policies, and organization-required enrollment controls are available; they are not represented as falsely active in this baseline.
