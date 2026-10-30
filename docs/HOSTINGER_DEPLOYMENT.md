# Deploy Welfare Pride Invoices on Hostinger

## GitHub source

Deploy this repository and branch:

- Repository: `https://github.com/MadaSito/welfare-pride-invoices.git`
- Branch: `main`
- Application root: the repository root (`/`)

The application is a standalone Node.js 22 Express service with a Vite-built React client. It does not require a proprietary runtime, browser token, or hosted authentication service.

## Before you begin

Use a Hostinger plan that supports **Node.js Web App** hosting. In hPanel, create a MySQL database and collect its hostname, database name, username, and password. Create a private S3-compatible bucket for company logo uploads before enabling production logo uploads. Amazon S3, Cloudflare R2, Wasabi, and Backblaze B2 S3-compatible storage are suitable choices.

Decide the public production domain first, for example `https://invoices.example.com`. The exact HTTPS URL must be set as `APP_ORIGIN` and, if Welfare Pride SSO is later enabled, registered in Microsoft Entra ID as:

```text
https://invoices.example.com/api/auth/entra/callback
```

## Create the web application

1. Sign in to hPanel and go to **Websites → Add website → Node.js Web App**.
2. Choose **Import Git Repository**, authorize the Welfare Pride GitHub account, then select `MadaSito/welfare-pride-invoices` and the `main` branch.
3. Choose **Node 22.x** and **pnpm**. If automatic detection asks for a framework, select **Express.js**. If Express is not offered, select **Other**.
4. Use the repository root as the root directory. Use `dist` as the output directory if hPanel requests one, and use `dist/index.js` as the server entry file.
5. Set the build command to:

   ```bash
   pnpm deploy:hostinger
   ```

   It builds the application, applies all checked-in Drizzle migrations, and creates the bootstrap administrator only if that account does not already exist. The start command is `pnpm start` if hPanel presents a command field; otherwise use `dist/index.js` as the entry file.

Hostinger supports Node.js 22 and its Node.js app workflow can import a GitHub repository, configure the package manager/build settings, and restart the server when a new build is deployed. See Hostinger’s [Node.js Web App guide](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/) for the current hPanel screens.

## Configure environment variables

In the deployment review page, open **Environment variables** and add the following values. Never commit these values to GitHub or upload a real `.env` file.

```dotenv
NODE_ENV=production
APP_ORIGIN=https://invoices.example.com
FORCE_SECURE_COOKIES=true
DATABASE_URL=mysql://DATABASE_USER:URL_ENCODED_DATABASE_PASSWORD@DATABASE_HOST:3306/DATABASE_NAME

APP_CONFIG_ENCRYPTION_KEY=BASE64_OR_HEX_32_BYTE_KEY
WEBHOOK_SIGNING_SECRET=RANDOM_HIGH_ENTROPY_SECRET
RECURRING_SCHEDULER_SECRET=RANDOM_HIGH_ENTROPY_SECRET

S3_ENDPOINT=https://YOUR-S3-ENDPOINT
S3_REGION=us-east-1
S3_BUCKET=YOUR_PRIVATE_BUCKET
S3_ACCESS_KEY_ID=YOUR_ACCESS_KEY
S3_SECRET_ACCESS_KEY=YOUR_SECRET_ACCESS_KEY
S3_PUBLIC_BASE_URL=

BOOTSTRAP_ADMIN_EMAIL=admin@yourdomain.com
BOOTSTRAP_ADMIN_PASSWORD=UNIQUE_FIRST_LOGIN_PASSWORD_AT_LEAST_14_CHARACTERS
```

Do **not** set `PORT` unless Hostinger specifically asks for it; the managed Node.js environment supplies the listening port.

`APP_CONFIG_ENCRYPTION_KEY` must encode exactly 32 random bytes. Use one of these commands on a secure machine, then paste the output into Hostinger as the value:

```bash
# 44-character base64 encoding (recommended)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 64-character hexadecimal encoding
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set a unique `BOOTSTRAP_ADMIN_PASSWORD` for the initial deployment. The deployment script uses it only if the bootstrap administrator does not exist. After you complete the first login, remove `BOOTSTRAP_ADMIN_PASSWORD` from hPanel and redeploy once. Do not remove `BOOTSTRAP_ADMIN_EMAIL`; it identifies the account idempotently.

Hostinger detects variable names from the repository but requires you to enter secret values yourself. Its environment-variable guide also confirms that environment changes can require a redeploy to take effect: [Hostinger environment variables](https://www.hostinger.com/support/how-to-add-environment-variables-during-node-js-application-deployment/).

## First login and application setup

After Hostinger reports a successful deployment:

1. Visit `https://your-domain/api/health`. It should return `{"status":"ok"}`.
2. Sign in as `BOOTSTRAP_ADMIN_EMAIL` using `BOOTSTRAP_ADMIN_PASSWORD`.
3. Set a permanent password and scan the displayed QR code with Microsoft Authenticator, Google Authenticator, or another TOTP app. The manual setup key is also available as a fallback.
4. Save the recovery codes in an approved password manager.
5. Open **Set up Welfare Pride Invoices** and configure company branding, optional Welfare Pride Single Sign On (SSO), Graph/SMTP delivery, email templates, and backup destinations.
6. Remove `BOOTSTRAP_ADMIN_PASSWORD` from Hostinger after confirming sign-in, then redeploy or restart the app.

The bootstrap account is **not recreated or reset on later deployments**. Each later build runs the bootstrap check but finds the existing user and leaves its password, MFA state, and sessions untouched. Use **Security & access** inside the application for a future audited administrator reset.

## Recurring-invoice cron

Create a Hostinger cron job for each active recurring schedule. Use the schedule key generated by the application and keep it private. A typical job runs every five minutes:

```bash
curl --fail --silent --show-error -X POST \
  -H "x-wp-scheduler-secret: YOUR_RECURRING_SCHEDULER_SECRET" \
  -H "x-wp-schedule-key: THE_SCHEDULE_KEY" \
  https://invoices.example.com/api/internal/cron/recurring-invoices
```

The recurring endpoint verifies both secrets and resolves schedule data server-side. It does not trust an invoice ID supplied in the request body.

## Deploying later changes

Keep Hostinger connected to the `main` branch. A push to `main` triggers the connected Node.js web app deployment workflow. Each deployment runs the production build and additive database migrations. Review the Hostinger deployment log after every release. If a migration fails, the application should not be used until the database issue is resolved.

## Self-hosted alternatives

For a fully automated Ubuntu/Debian VPS deployment, use the [one-command VPS installation guide](VPS_INSTALLATION.md). It installs the required runtime, asks for only the deployment-specific configuration, creates a non-root service, configures Nginx, runs migrations, and prints the bootstrap administrator credential only when it creates that account.

For a VPS or bare-metal Linux host, use the deployment selector from a cloned repository:

```bash
chmod +x scripts/*.sh
./scripts/install.sh
```

Choose **Native Node.js** for a systemd-capable VPS or **Docker Compose** for a containerized application plus MySQL database. The scripts create a local `.env` from `.env.example`, generate missing root secrets locally, apply migrations, and bootstrap the first administrator only when absent. They intentionally stop until you supply real database, `APP_ORIGIN`, and S3 values. For a native reverse proxy, use `deploy/nginx/welfare-pride-invoices.conf` as a starting point and configure TLS before accepting production traffic.

To install the native service after configuration, run `INSTALL_SYSTEMD=1 ./scripts/install-native.sh`. The generated service runs as the account that executes the installer rather than as root.

The Docker Compose path starts a private MySQL service first, runs migration/bootstrap as a one-shot service, and exposes the web service only after that service succeeds. Keep the generated `MYSQL_PASSWORD` base64url-safe (`A-Z`, `a-z`, `0-9`, `_`, `-`); the installer enforces this because Compose builds the container database URL from that value.

## Pre-launch checklist

Confirm the domain has HTTPS, `APP_ORIGIN` exactly matches it, health is green, first-login password change/MFA works, a logo upload and PDF download work, Graph or SMTP test delivery succeeds, S3 logo storage works, a backup destination test succeeds, and the recurring endpoint rejects a request without both secrets. Retain the GitHub repository, MySQL-provider backups, encrypted exports, and the original `APP_CONFIG_ENCRYPTION_KEY` in separate approved recovery locations.
