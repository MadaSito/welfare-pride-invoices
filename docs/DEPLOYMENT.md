# Welfare Pride Invoices — Standalone Hostinger Deployment

For the exact Hostinger hPanel values, GitHub branch/build/entry settings, first-admin deployment sequence, and portable native/Docker installer paths, use [HOSTINGER_DEPLOYMENT.md](HOSTINGER_DEPLOYMENT.md).

## Runtime

This is a standalone Node 22 Express/tRPC and React application. It has no platform OAuth, platform JWT, platform object-storage proxy, or platform scheduler dependency. Hostinger must provide a MySQL-compatible `DATABASE_URL`, an S3-compatible object store, HTTPS, and a Node process that receives `PORT`. The health check is `GET /api/health`.

Install and start:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm bootstrap:admin   # run once; capture output in a password manager
pnpm build
NODE_ENV=production node dist/index.js
```

Run `pnpm bootstrap:admin` before retiring the legacy login. It creates `admin@welfarepride.local` only when absent, prints a strong one-time password once, requires a password change, and then requires TOTP MFA enrollment. After that first full login, open **Set up Welfare Pride Invoices** to configure branding, optional Welfare Pride SSO, Graph/SMTP delivery, email copy, and backups. The root encryption key remains a Hostinger server setting—not an in-browser setup field—because it is the root of trust for all stored credentials.

## Required environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | MySQL-compatible connection string |
| `APP_CONFIG_ENCRYPTION_KEY` | 32-byte base64/hex AES-256-GCM key for Graph/SMTP settings and TOTP seeds |
| `WEBHOOK_SIGNING_SECRET` | HMAC secret for `/api/webhooks/delivery` |
| `APP_ORIGIN` | Exact public HTTPS origin, e.g. `https://invoices.example.org` |
| `RECURRING_SCHEDULER_SECRET` | High-entropy secret accepted only by the recurring cron endpoint |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET` | S3-compatible logo storage location |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | S3 storage credentials |
| `S3_PUBLIC_BASE_URL` | Optional public logo base URL; omit to use a short-lived signed redirect |

Keep values in Hostinger environment configuration, not source, `.env` uploads, screenshots, or browser-visible variables. Set `FORCE_SECURE_COOKIES=true` if Hostinger does not set `NODE_ENV=production` itself.

## Microsoft Entra ID

Entra sign-in is optional. To enable it, create a confidential web application and add exactly this redirect URI:

```text
https://your-domain.example/api/auth/entra/callback
```

During the first full platform-administrator login, the setup assistant prompts for Welfare Pride SSO configuration. It stores the tenant ID, client ID, and client secret encrypted at rest from **Security & access**. Alternatively, set `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, and `ENTRA_CLIENT_SECRET` as Hostinger environment variables for immutable infrastructure-managed configuration. The app uses Authorization Code with PKCE, validates state, nonce, issuer, tenant, audience, and JWKS signatures. A platform administrator must first provision an SSO user by email in **Security & access**; a valid Entra token alone never creates a company role or invoice access.

## Local authentication and MFA

Local accounts use an application-owned opaque session cookie, CSRF header/cookie verification, scrypt password hashes, TOTP MFA, and hashed one-time recovery codes. Every temporary or administrator-reset local password forces a change at next sign-in, then forces authenticator enrollment before a full session is issued. Entra users follow the tenant’s Entra MFA policy.

## S3-compatible company logos

Create a private bucket/prefix for this application. The server validates image bytes before upload, stores non-guessable tenant-prefixed keys, and serves a short-lived signed redirect unless `S3_PUBLIC_BASE_URL` is deliberately configured. Do not reuse the old platform storage endpoint.

## Recurring invoices

Hostinger cron invokes the protected endpoint for each active schedule:

```bash
curl --fail --silent --show-error -X POST \
  -H "x-wp-scheduler-secret: $RECURRING_SCHEDULER_SECRET" \
  -H "x-wp-schedule-key: SCHEDULE_KEY" \
  https://your-domain.example/api/internal/cron/recurring-invoices
```

Schedule it frequently enough for the configured UTC cadence (for example, every five minutes). The persistent schedule key is generated when a recurring template is created and must be treated as operational configuration, not a browser credential. The handler still resolves all business data server-side, checks company/schedule active state, uses its durable occurrence ledger and leases, and never trusts request body invoice identifiers. Review-first invoices enter **awaiting approval**; automatic delivery requires an active Graph/SMTP configuration.

## Mail, TLS, and production checks

Configure or reconfigure Graph or SMTP within **Email delivery** after deployment. Existing Graph client secrets and SMTP passwords may be left blank when changing non-secret details; the server retains the saved encrypted credential. The same workspace manages the client-facing invoice subject and sanitized HTML body. Allowed invoice placeholders are resolved and HTML-escaped only at send time. Continue to restrict Graph `Mail.Send` and mailbox scope according to Microsoft 365 policy.

**Email logs** records initial sends, connection tests, explicit administrator resends, and uncertain outcomes. A resend requires a stated administrator reason, creates a new delivery attempt, keeps the original invoice number/PDF, and never happens automatically after an uncertain provider response.

## Backups and exports

Platform administrators use **Backups & exports** to download a credential-free local JSON export or create an encrypted `.wpbk` cloud archive. The export/archive excludes database and application secrets, password hashes, TOTP seeds, recovery codes, live sessions, and Graph/SMTP/Entra/backup credentials.

Cloud destinations are configured in the application and encrypted with `APP_CONFIG_ENCRYPTION_KEY`:

- **Amazon S3, Wasabi, or Backblaze B2 S3-compatible storage:** public HTTPS endpoint, region, bucket, prefix, access key ID, and secret access key.
- **Microsoft SharePoint (global Microsoft 365):** enter Entra tenant/client credentials and the normal HTTPS SharePoint site address (for example, `https://contoso.sharepoint.com/sites/Finance`). The administrator console safely resolves the site, paginates accessible document libraries, and provides a breadcrumb folder picker; it saves the selected site ID, drive ID, and path without requiring manual Graph-ID lookup. Destination tests verify that the selected library belongs to the selected site and that the exact configured path is an accessible folder. Grant the application only the required site/library permissions (for example, an approved `Sites.Selected` assignment or an appropriately scoped read/write permission). Sovereign-cloud SharePoint tenants require a Graph-authority deployment extension and are explicitly rejected rather than failing silently.

Test each destination before relying on it. Store independent recovery material: GitHub source, MySQL-provider backups, a current encrypted export, and the exact root encryption key. Rotating or losing that key prevents decryption of existing in-app credentials and cloud archives. Terminate TLS at Hostinger or a hardened reverse proxy; set `APP_ORIGIN` to the exact HTTPS origin; do not cache authenticated pages, PDFs, APIs, exports, or webhooks. Verify health, bootstrap login, forced password change, MFA enrollment, a second local user, an Entra provisioned user, tenant role assignment, logo upload, PDF download, mail test, local export, backup destination test, protected scheduler rejection without its secret, and webhook HMAC rejection before go-live.
