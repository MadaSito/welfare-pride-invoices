# Welfare Pride Invoices — Standalone Security Model

## Identity and sessions

Authentication is application-owned. Local passwords use scrypt with a random salt. Browser sessions are random opaque values kept only as SHA-256 hashes in MySQL, are short-lived for incomplete sign-in stages, and are revocable through session versioning. An `HttpOnly`, `Secure` (production), `SameSite=Lax` session cookie is paired with a readable CSRF cookie and required `x-wp-csrf-token` header on authenticated tRPC mutations. No platform OAuth, platform JWT, bearer-token fallback, browser session-storage token, or public platform configuration remains.

The bootstrap `admin@welfarepride.local` account starts with a generated one-time password, forced password change, and forced TOTP enrollment. Administrator password resets repeat that sequence. Local MFA uses encrypted RFC 6238 TOTP seeds and hashed, one-time recovery codes. Resetting MFA or revoking sessions invalidates active sessions.

## Microsoft Entra ID

Entra uses Authorization Code with PKCE, one-time hashed state, nonce validation, a fixed HTTPS callback, discovery/JWKS signature validation, and exact tenant, issuer, and audience checks. Users must be provisioned by a platform administrator before Entra sign-in; a token email never grants access. First sign-in links a stable tenant/object ID, and later mismatch fails closed. The customer Entra tenant remains authoritative for Entra MFA policy.

## User lifecycle and tenancy

Global platform administrators may create local or Entra accounts, disable/enable accounts, create one-time local passwords, reset MFA/recovery data, revoke sessions, and manage company memberships. Every privileged action has an immutable audit record. Company roles remain server-enforced for every company, contact, invoice, schedule, branding, provider configuration, email log, and asset request. Global administration and company membership are deliberately separate.

## Financial, mail, and tenant safeguards

Server-side Zod validation recomputes invoice totals and protects lifecycle transitions. Review-first recurring documents enter `awaiting_approval`; only a tenant creator/admin can approve before finalization or delivery. Draft-only discard, protected sequence allocation, separate one-off/recurring series, durable outbox uncertainty, Graph/SMTP encryption, HMAC webhook verification, PDF `private, no-store`, tenant archive barriers, and immutable audit safeguards remain active.

## S3 storage and Hostinger cron

Company logos use S3-compatible storage configured only through server environment values. Private storage uses short-lived signed redirects. Hostinger cron must send both `RECURRING_SCHEDULER_SECRET` and the schedule key to the internal recurring endpoint. The server ignores request-body identifiers, verifies archived/paused state, and retains the durable run lease and occurrence ledger, so retries cannot create duplicate invoices. Rotate scheduler and encryption secrets under an approved operating procedure.

## Operational baseline

The application disables `X-Powered-By`, sends security headers and correlation IDs, and rate-limits API traffic in-process. Use Hostinger/Cloudflare HTTPS, WAF and distributed rate limiting for multi-instance production workloads. Never expose database, S3, Graph, SMTP, Entra, scheduler, encryption, or webhook secrets in source, browser variables, logs, or Git history.
