# Ubuntu VPS installation

This guide deploys Welfare Pride Invoices as a self-hosted service on an **Ubuntu or Debian VPS**. The interactive installer supports two production modes:

- **Native** — Node.js 22, a non-root `welfarepride` system account, a locally provisioned MySQL-compatible server, systemd, and Nginx.
- **Docker** — Docker Compose, persistent local MySQL, application containers, and Nginx.

It installs missing system prerequisites, clones or safely fast-forwards the `main` branch, protects an `.env` file, generates missing application secrets locally, applies additive migrations, starts the service, and creates the initial local administrator only when that account does not already exist.

## Before starting

Prepare these values:

- A DNS hostname for the app, such as `invoices.example.com`, pointed at the VPS public IP and proxied through Cloudflare.
- A private S3-compatible bucket plus endpoint, region, access key, and secret for company logos.
- No database credential is required for the default **Native** or **Docker** path: both provision a persistent local MySQL-compatible database and generate its application credentials locally.
- Use `--database external` only when **Native** mode should use an existing remote MySQL-compatible database; the installer then prompts for its `DATABASE_URL`.

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

1. Install Nginx and Node.js 22 plus local MySQL (**Native**) or Nginx, Node.js 22, Docker Engine/Compose, and its persistent MySQL container (**Docker**).
2. Create the non-root `welfarepride` service account.
3. Ask for the public HTTPS origin, logo-storage configuration, and initial local administrator email. It asks for `DATABASE_URL` only when Native mode uses `--database external`.
4. Generate an `APP_CONFIG_ENCRYPTION_KEY`, webhook secret, scheduler secret, and required database passwords only when they are absent. Docker stores its MySQL root password in a local `.secrets/` file mounted only into the database container; it is not passed to the application or migration containers.
5. Install dependencies, build the application, run migrations, and create the initial administrator when absent.
6. Configure a non-root systemd service (**Native**) or start Docker Compose (**Docker**), create an Nginx reverse-proxy site, and configure trusted Cloudflare real-IP handling.

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

## Cloudflare DNS proxy and HTTPS

Create an **A** or **AAAA** DNS record in Cloudflare that points to the VPS. Initially keep it **DNS only** (gray cloud) while issuing the origin certificate, or otherwise ensure a valid origin certificate is already installed. After that, switch it to **Proxied** (orange cloud) and set **Cloudflare → SSL/TLS encryption mode** to **Full (strict)**; do not use Flexible mode. The installer trusts `CF-Connecting-IP` only from Cloudflare's published IP ranges so rate limits and audit records keep the visitor IP instead of the Cloudflare edge IP.

Native mode binds Node.js to `127.0.0.1:3000`; Docker binds its host mapping only to `127.0.0.1:3000` while its internal container listener remains available to Compose. Public traffic therefore passes through Nginx. Do not change `BIND_HOST` or `HOST_BIND_ADDRESS` to a public interface unless a separate protected reverse proxy is in place.

The script configures Nginx on port 80. After DNS has propagated, install a valid origin certificate. One common Ubuntu approach is Let's Encrypt:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d invoices.example.com
```

Replace `invoices.example.com` with your actual hostname. Do not allow production sign-ins until the certificate is active and `APP_ORIGIN` exactly matches the HTTPS origin.

To prevent direct public access to the origin after confirming you have reliable SSH access, use the optional Cloudflare origin-lock mode on an installer run:

```bash
sudo ./scripts/install-vps-ubuntu.sh --mode native --lock-cloudflare-origin
```

It creates an Nginx allow-list for current Cloudflare IP ranges and denies all other public origin traffic without changing firewall or SSH rules. The lock persists across ordinary installer updates and refreshes along with Cloudflare's published ranges. Enable it only after the origin certificate is active; temporarily disable the lock before using any direct origin validation, monitor, VPN, or load balancer that must reach ports 80/443.

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
