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
  - Let administrators upload a company logo only after validated authorization, image type, byte size, and dimensions checks. Store it under a non-guessable tenant-prefixed key and retain its ownership record.
  - Provide controls and a live invoice-header preview for logo scale and alignment. Render every invoice logo with aspect ratio preserved in a bounded contain box so it cannot be stretched, cropped, or oversized.

- [x] **Invoice lifecycle and branded PDF rendering**
  - Support draft invoices with client, issue and due dates, generated invoice numbers, currency, taxable line items, line descriptions, quantity, unit price, discounts, configurable tax, notes, payment terms/conditions, and payment instructions for Stripe/ACH/check workflows.
  - Enforce server-side total calculation and protected status transitions. Creators/admins can create, edit and send permitted invoices; viewers can only view and download permitted invoices.
  - Generate a real server-side PDF using Roboto and company branding. The downloadable PDF must include sender and client contact details, invoice details, line-item table, totals, terms, notes, payment instructions, and a proportionally fitted logo.

- [x] **Administrator-selected Graph and SMTP email delivery**
  - Provide an admin delivery settings screen in which a company selects Microsoft Graph API or SMTP as its active provider. Graph settings include tenant ID, client ID, client secret, sender mailbox, and display name. SMTP settings include host, port, TLS mode, username, password, from address, and display name.
  - Encrypt provider connection payloads at rest with an application-held AES-256-GCM key; never send saved credential values to the browser, source tree, logs, or audit response.
  - Provide a Microsoft Graph **Send Test Email** action that sends through the configured Graph provider and displays the configured DisplayName in the test payload. Support a protected SMTP test path as well.
  - Send branded invoice email with PDF attachment through the selected provider, optional BCC archive, delivery correlation data, and a persisted email log state of `queued`, `sent`, or `failed`. Provide an admin email-log page.

- [x] **Security, webhook, and operational safeguards**
  - Validate all inputs with strict server schemas; rate-limit sensitive API routes; set security response headers compatible with embedded HTTPS Preview; and avoid exposing secrets in browser code or error messages.
  - Include an HMAC-SHA256 raw-body webhook verification endpoint with an event timestamp/replay window, correlation ID, and audit receipt. Document the webhook signing secret requirement.
  - Maintain Cloudflare/Hostinger/Docker deployment documentation, environment-secret requirements, CORS/cookie considerations, health checks, and operational limits. Do not claim identity-provider SSO or TOTP are active until the organization supplies their required provider configuration.

- [ ] **Quality, delivery, and GitHub source transfer**
  - Maintain TypeScript diagnostics, run type checks/build/tests applicable to modified code, and fix actionable errors.
  - Confirm the application has `/manus-routes.json`, an unauthenticated `/api/health`, durable object storage usage for uploaded logos/generated PDFs, and a production-capable Docker configuration.
  - Connect the finished project to a new private GitHub repository using the managed GitHub transfer confirmation flow, preserve project history, push the completed `main` branch, and confirm the resulting checkpoint/transfer status.
  - Status: application checks/build, health/route validation, PDF verification, responsive preview review, and migration application are complete; managed GitHub transfer remains pending user confirmation.
