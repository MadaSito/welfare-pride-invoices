# Welfare Pride Invoices — Deployment Guide

## Runtime model

Welfare Pride Invoices is a Node 22 application that serves the React workspace and Express/tRPC API from the same process. It requires a MySQL-compatible database, durable object storage for company logos, and a protected runtime-secret store. The application listens on `PORT` (default `3000`) and exposes the unauthenticated health response at `GET /api/health`.

The supplied `Dockerfile` installs the pinned `pnpm@10.18.0` toolchain, builds the browser and server output, and starts `node dist/index.js`. Build-time environments must not contain production secrets; the database connection and protected values are only required at runtime.

## Required protected runtime values

| Name | Purpose | When needed |
| --- | --- | --- |
| `DATABASE_URL` | MySQL-compatible application connection | Always; supplied by managed database in this project |
| `MANUS_JWT_SECRET` and OAuth values | Validated Manus OAuth session handling | Supplied by the platform |
| `MANUS_API_URL`, `MANUS_API_KEY` | Durable company-logo storage signing | Supplied by the platform |
| `APP_CONFIG_ENCRYPTION_KEY` | 32-byte base64 or hexadecimal AES-256-GCM key that encrypts saved Graph/SMTP payloads | Before an administrator saves delivery credentials |
| `WEBHOOK_SIGNING_SECRET` | HMAC-SHA256 secret for `/api/webhooks/delivery` | Before accepting signed webhooks |

Generate a deployment-specific encryption key securely, for example with `openssl rand -base64 32`, then store it only through the protected-secret input flow. Do not put either application secret in source files, browser variables, screenshots, Git history, or a client-accessible configuration endpoint.

## Microsoft Graph delivery setup

1. Create or select a Microsoft Entra application in the tenant that owns the sending mailbox.
2. Grant Microsoft Graph **application** permission `Mail.Send` and complete administrator consent. Restrict the application to approved mailboxes through Exchange application access policy where organizational policy requires it.
3. Create a client secret and capture the tenant ID, client ID, sender mailbox, and configured display name.
4. In **Email delivery**, choose **Microsoft Graph API**, enter the details, and save. The server AES-encrypts the saved payload.
5. Send a test email to an administrator-controlled mailbox and inspect **Email logs**. Microsoft 365 mailbox settings remain authoritative for the final visible From display name.

## SMTP delivery setup

Use the administrator-provided SMTP host, port, transport-security mode, username, password, From mailbox, and display name. Save it from **Email delivery**, then send a test to an administrator-controlled mailbox. The application never sends a saved password back to the browser.

## Cloudflare / edge configuration

Run the app behind HTTPS and keep the Cloudflare proxy/WAF in front of the origin. Enable managed WAF rules, bot protection appropriate to the organization, rate limiting for `/api/*`, and explicit administrative CIDR allow/block policies at the edge. Do not cache authenticated pages, APIs, PDF responses, or webhook endpoints. The application trusts one reverse proxy hop and adds correlation IDs plus a conservative in-process rate limit; high-volume production deployments should enforce distributed rate limiting and dynamic CIDR controls at Cloudflare/Redis rather than relying on process memory.

## Hostinger Node.js / Passenger deployment

In Hostinger's Node.js app controls, select Node 22, use the repository root as the application root, install dependencies with `pnpm install --frozen-lockfile`, build with `pnpm build`, and start with `node dist/index.js`. Configure the required protected runtime values in Hostinger's environment configuration rather than an uploaded `.env` file. Point the domain/proxy to the Node app, set `NODE_ENV=production`, and make sure the configured application port is passed through as `PORT`.

For a Passenger-style setup, the production startup target is the built server entry point, `dist/index.js`; do not use the Vite development server. Verify `GET /api/health` only after the process is bound and behind the intended HTTPS proxy.

## Docker / VPS deployment

A representative production invocation is:

```bash
docker build -t welfare-pride-invoices .
docker run --rm -p 3000:3000 \
  -e DATABASE_URL='…' \
  -e APP_CONFIG_ENCRYPTION_KEY='…' \
  -e WEBHOOK_SIGNING_SECRET='…' \
  welfare-pride-invoices
```

Terminate TLS at Cloudflare or a hardened reverse proxy, never expose the raw Node listener directly to the public internet, and route `/api/health` only for trusted infrastructure health checks where possible.

## Go-live verification

Confirm that the health endpoint answers, a user can complete real OAuth login, the first administrator can see the default Welfare Pride company, an authorized logo can be uploaded, a PDF downloads, the selected provider test appears in Email logs, and a rejected webhook receives no processing acknowledgement. Ensure test clients and test invoices are removed or clearly marked before production use.

## Recurring invoices

Recurring schedules are application-owned platform Heartbeat jobs. They run only against a **published** version that contains `POST /api/scheduled/recurring-invoices`; a local preview or an un-published Git push cannot execute a live schedule. Create schedules from **Recurring invoices** after deployment, choose a weekly or monthly UTC run time, and either leave the default review-first mode or enable auto-send only after a protected Graph/SMTP provider is active.

The scheduler is created and managed through the application’s shared platform service identity, so any appropriately authorized company operator can pause, resume, or archive a schedule regardless of who created it. Archival stops future runs while retaining its invoice-series reservation, run ledger, and historical invoice links. It authenticates callbacks with a platform-issued signed ticket; the handler resolves the schedule from that ticket’s task UID and ignores request-body identifiers. Each schedule occurrence is stored in an idempotency ledger with a recoverable lease and a durable invoice link, so retries or a process interruption cannot create a duplicate invoice.

Invoice drafts and finalized review documents use provisional references. One-off invoices allocate a company-scoped `PREFIX-YEAR-NNNN` number atomically on their first send attempt. Every recurring schedule owns its own series and can be migrated from prior documents—for example, set prefix `HPP` and next number `35` after `HPP033` and `HPP034`, producing `HPP035`. Overlapping prefixes such as `HPP` and `HPP1` are rejected because they could render the same number. Known pre-dispatch failures may be safely retried; any failure after provider dispatch begins is marked **uncertain**, stays out of automatic resend, and requires a company administrator to reconcile it in **Email logs** after checking the provider. A number is never reused.
