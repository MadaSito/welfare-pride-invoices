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
