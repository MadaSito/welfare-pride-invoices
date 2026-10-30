# Ubuntu VPS installation

This guide deploys Welfare Pride Invoices as a self-hosted service on an **Ubuntu or Debian VPS**. The interactive installer supports two production modes:

- **Native** — Node.js 22, a non-root `welfarepride` system account, systemd, Nginx, and your existing MySQL-compatible database.
- **Docker** — Docker Compose, persistent local MySQL, application containers, and Nginx.

It installs missing system prerequisites, clones or safely fast-forwards the `main` branch, protects an `.env` file, generates missing application secrets locally, applies additive migrations, starts the service, and creates the initial local administrator only when that account does not already exist.

## Before starting

Prepare these values:

- A DNS hostname for the app, such as `invoices.example.com`, pointed at the VPS public IP.
- A private S3-compatible bucket plus endpoint, region, access key, and secret for company logos.
- For **Native** mode, a MySQL `DATABASE_URL` with a user allowed to run migrations.
- For **Docker** mode, no external MySQL is needed; Docker Compose creates an isolated persistent MySQL service.

The installer asks for these values interactively. It never prints entered database or object-storage credentials.

## Recommended: verify and run from a clone

Connect to the VPS through SSH, then run:

```bash
sudo apt-get update && sudo apt-get install -y git
sudo git clone https://github.com/MadaSito/welfare-pride-invoices.git /opt/welfare-pride-invoices
cd /opt/welfare-pride-invoices
sudo ./scripts/install-vps-ubuntu.sh --mode native
```

For Docker with the bundled persistent MySQL database, replace `native` with `docker`:

```bash
sudo ./scripts/install-vps-ubuntu.sh --mode docker
```

The installer will:

1. Install Nginx plus Node.js 22 (**Native**) or Docker Engine/Compose (**Docker**).
2. Create the non-root `welfarepride` service account.
3. Ask for the public HTTPS origin, logo-storage configuration, and initial local administrator email. Native mode also asks for `DATABASE_URL`.
4. Generate an `APP_CONFIG_ENCRYPTION_KEY`, webhook secret, scheduler secret, and required Docker database passwords only when they are absent.
5. Install dependencies, build the application, run migrations, and create the initial administrator when absent.
6. Configure a non-root systemd service (**Native**) or start Docker Compose (**Docker**) and create an Nginx reverse-proxy site.

The first time it creates the administrator, the terminal displays:

```text
BOOTSTRAP_ADMIN_EMAIL=...
BOOTSTRAP_ADMIN_PASSWORD=...
```

Save the password immediately in an approved password manager. It is a one-time password: the account is required to change it and enroll TOTP MFA on first sign-in. Later installer runs preserve the password, MFA enrollment, and active account state.

## Optional remote bootstrap command

For a newly provisioned Ubuntu/Debian server, this downloads the versioned installer from the repository and lets it clone the application itself:

```bash
curl -fsSLO https://raw.githubusercontent.com/MadaSito/welfare-pride-invoices/main/scripts/install-vps-ubuntu.sh
chmod 700 install-vps-ubuntu.sh
sudo ./install-vps-ubuntu.sh --mode native
```

For a higher-assurance deployment, use the clone method above and inspect the script before running it.

## Finish HTTPS after DNS is active

The script configures Nginx on port 80. After DNS has propagated, issue a TLS certificate. On Ubuntu, one common approach is:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d invoices.example.com
```

Replace `invoices.example.com` with your actual hostname. Do not allow production sign-ins until the certificate is active and `APP_ORIGIN` exactly matches the HTTPS origin.

## Verify and complete initial setup

1. Open `https://your-domain/api/health`; it must return `{"status":"ok"}`.
2. Sign in with the bootstrap credentials printed by the installer.
3. Change the temporary password and scan the MFA QR code. Save recovery codes.
4. Complete **Set up Welfare Pride Invoices**: branding, invoicing address, Welfare Pride SSO, Graph/SMTP mail, templates, backups, and optional Clarity analytics.
5. Confirm a logo upload, PDF download, and mail test before entering production data.

## Service operations

Native mode uses systemd:

```bash
sudo systemctl status welfare-pride-invoices
sudo journalctl -u welfare-pride-invoices -f
sudo systemctl restart welfare-pride-invoices
```

Docker mode uses Compose from `/opt/welfare-pride-invoices`:

```bash
cd /opt/welfare-pride-invoices
sudo docker compose ps
sudo docker compose logs -f app
sudo docker compose restart app
```

## Updates

Re-run the same installer from the application checkout:

```bash
cd /opt/welfare-pride-invoices
sudo ./scripts/install-vps-ubuntu.sh --mode native
```

It permits only a clean fast-forward update of the selected `main` branch, runs additive migrations, and never overwrites `.env` or resets the existing administrator.

## Recurring invoices

Create a protected cron job for each active schedule after HTTPS is working. Use the schedule key shown by the application and the saved `RECURRING_SCHEDULER_SECRET` from `/opt/welfare-pride-invoices/.env`:

```bash
curl --fail --silent --show-error -X POST \
  -H "x-wp-scheduler-secret: YOUR_RECURRING_SCHEDULER_SECRET" \
  -H "x-wp-schedule-key: THE_SCHEDULE_KEY" \
  https://your-domain/api/internal/cron/recurring-invoices
```

Keep the secret and schedule keys out of shell histories, source control, and monitoring logs.
