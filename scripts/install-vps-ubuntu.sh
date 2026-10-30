#!/usr/bin/env bash
# Welfare Pride Invoices — one-command Ubuntu/Debian VPS bootstrap.
# Run from a fresh server as root or via sudo. It never overwrites an existing .env,
# never resets an existing bootstrap administrator, and only fast-forwards an existing checkout.
set -Eeuo pipefail
umask 077

REPOSITORY_URL="${REPOSITORY_URL:-https://github.com/MadaSito/welfare-pride-invoices.git}"
BRANCH="${BRANCH:-main}"
APP_DIRECTORY="${APP_DIRECTORY:-/opt/welfare-pride-invoices}"
APP_USER="${APP_USER:-welfarepride}"
MODE="native"
DATABASE_MODE="local"
DATABASE_MODE_EXPLICIT=0
SKIP_NGINX=0
CLOUDFLARE_PROXY=1
LOCK_CLOUDFLARE_ORIGIN=0
LOCK_CLOUDFLARE_ORIGIN_EXPLICIT=0

usage() {
  cat <<'EOF'
Usage: sudo bash scripts/install-vps-ubuntu.sh [--mode native|docker] [options]

Options:
  --mode native|docker  Native Node.js 22 + systemd (default), or Docker Compose + MySQL.
  --database local|external  Native mode database source: provision local MySQL (default) or use an existing external MySQL URL.
  --app-directory PATH Installation directory (default: /opt/welfare-pride-invoices).
  --app-user NAME      Non-root service account (default: welfarepride).
  --branch NAME        Repository branch to deploy (default: main).
  --repository URL     Git repository URL to deploy.
  --skip-nginx         Do not install or configure the Nginx reverse proxy.
  --no-cloudflare-proxy  Do not configure Nginx to trust Cloudflare real-IP headers.
  --lock-cloudflare-origin  Configure UFW to permit HTTP/HTTPS only from Cloudflare IP ranges (keeps OpenSSH allowed).
  -h, --help           Show this help.

The installer asks for your HTTPS origin, private S3-compatible logo storage, and first
administrator email. Native mode provisions a local MySQL server by default; use
--database external to supply an external MySQL DATABASE_URL. It generates missing encryption,
webhook, scheduler, and database secrets locally. The initial local administrator password is
generated and shown only when the account is first created.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="${2:-}"; shift 2 ;;
    --database) DATABASE_MODE="${2:-}"; DATABASE_MODE_EXPLICIT=1; shift 2 ;;
    --app-directory) APP_DIRECTORY="${2:-}"; shift 2 ;;
    --app-user) APP_USER="${2:-}"; shift 2 ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --repository) REPOSITORY_URL="${2:-}"; shift 2 ;;
    --skip-nginx) SKIP_NGINX=1; shift ;;
    --no-cloudflare-proxy) CLOUDFLARE_PROXY=0; shift ;;
    --lock-cloudflare-origin) LOCK_CLOUDFLARE_ORIGIN=1; LOCK_CLOUDFLARE_ORIGIN_EXPLICIT=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ "$MODE" != "native" && "$MODE" != "docker" ]]; then
  echo "--mode must be native or docker." >&2; exit 2
fi
if [[ "$DATABASE_MODE" != "local" && "$DATABASE_MODE" != "external" ]]; then
  echo "--database must be local or external." >&2; exit 2
fi
if [[ "$MODE" == "docker" && "$DATABASE_MODE" == "external" ]]; then
  echo "Docker mode always provisions its persistent local MySQL container; omit --database external." >&2; exit 2
fi
if [[ "$LOCK_CLOUDFLARE_ORIGIN" == "1" && "$SKIP_NGINX" == "1" ]]; then
  echo "--lock-cloudflare-origin requires the managed Nginx proxy; omit --skip-nginx." >&2; exit 2
fi
if [[ "$LOCK_CLOUDFLARE_ORIGIN" == "1" && "$CLOUDFLARE_PROXY" == "0" ]]; then
  echo "--lock-cloudflare-origin requires Cloudflare proxy mode; omit --no-cloudflare-proxy." >&2; exit 2
fi

if [[ "${EUID}" -ne 0 ]]; then
  echo "Re-running through sudo so packages, service files, and Nginx can be configured."
  sudo_args=(bash "$0" --mode "$MODE" --database "$DATABASE_MODE" --app-directory "$APP_DIRECTORY" --app-user "$APP_USER" --branch "$BRANCH" --repository "$REPOSITORY_URL")
  [[ "$SKIP_NGINX" == "1" ]] && sudo_args+=(--skip-nginx)
  [[ "$CLOUDFLARE_PROXY" == "0" ]] && sudo_args+=(--no-cloudflare-proxy)
  [[ "$LOCK_CLOUDFLARE_ORIGIN_EXPLICIT" == "1" ]] && sudo_args+=(--lock-cloudflare-origin)
  exec sudo -E "${sudo_args[@]}"
fi

if [[ ! -r /etc/os-release ]]; then
  echo "This installer supports Ubuntu or Debian only." >&2; exit 1
fi
# shellcheck disable=SC1091
. /etc/os-release
if [[ "${ID:-}" != "ubuntu" && "${ID:-}" != "debian" ]]; then
  echo "Unsupported operating system: ${PRETTY_NAME:-unknown}. Use Ubuntu or Debian." >&2; exit 1
fi

require_value() {
  local value="$1" message="$2"
  if [[ -z "$value" ]]; then echo "$message" >&2; exit 1; fi
}

as_app_user() {
  runuser -u "$APP_USER" -- env HOME="$(getent passwd "$APP_USER" | cut -d: -f6)" bash -lc "$1"
}

apt_install_basics() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y --no-install-recommends ca-certificates curl git gnupg nginx
}

install_node_22() {
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -p 'process.versions.node.split(".")[0]')"
    if [[ "$major" -ge 22 && "$major" -lt 25 ]]; then
      return
    fi
  fi
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  chmod a+r /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get install -y nodejs
}

install_docker() {
  if docker compose version >/dev/null 2>&1; then return; fi
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  local codename="${VERSION_CODENAME:-$(. /etc/os-release && echo "$VERSION_CODENAME")}" arch
  arch="$(dpkg --print-architecture)"
  echo "deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${codename} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
}

install_local_mysql() {
  if ! command -v mysql >/dev/null 2>&1; then
    if apt-cache show mysql-server >/dev/null 2>&1; then
      apt-get install -y mysql-server
    else
      apt-get install -y default-mysql-server
    fi
  fi
  if systemctl list-unit-files --type=service | grep -q '^mysql\.service'; then
    systemctl enable --now mysql
  else
    systemctl enable --now mariadb
  fi
}

provision_local_mysql_database() {
  local database user password
  database="$(current_env_value MYSQL_DATABASE)"
  user="$(current_env_value MYSQL_USER)"
  password="$(current_env_value MYSQL_PASSWORD)"
  require_value "$database" "MYSQL_DATABASE is required for local MySQL provisioning."
  require_value "$user" "MYSQL_USER is required for local MySQL provisioning."
  require_value "$password" "MYSQL_PASSWORD is required for local MySQL provisioning."
  if [[ ! "$database" =~ ^[A-Za-z0-9_]{1,64}$ || ! "$user" =~ ^[A-Za-z0-9_]{1,32}$ ]]; then
    echo "MYSQL_DATABASE and MYSQL_USER may contain only letters, numbers, and underscores." >&2; exit 1
  fi
  if [[ ! "$password" =~ ^[A-Za-z0-9_-]{16,}$ ]]; then
    echo "MYSQL_PASSWORD must contain at least 16 URL-safe base64url characters. Run with a fresh .env or replace it with a generated value." >&2; exit 1
  fi
  mysql --protocol=socket -uroot <<SQL
CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${user}'@'127.0.0.1' IDENTIFIED BY '${password}';
ALTER USER '${user}'@'127.0.0.1' IDENTIFIED BY '${password}';
GRANT ALL PRIVILEGES ON \`${database}\`.* TO '${user}'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
  set_env_value DATABASE_URL "mysql://${user}:${password}@127.0.0.1:3306/${database}"
}

prepare_checkout() {
  if ! id "$APP_USER" >/dev/null 2>&1; then
    useradd --system --create-home --home-dir "/var/lib/${APP_USER}" --shell /usr/sbin/nologin "$APP_USER"
  fi

  if [[ -d "$APP_DIRECTORY/.git" ]]; then
    local active_branch
    active_branch="$(git -C "$APP_DIRECTORY" branch --show-current)"
    if [[ "$active_branch" != "$BRANCH" ]]; then
      echo "Existing checkout is on '${active_branch}', not '${BRANCH}'. Switch branches manually or choose --branch '${active_branch}'." >&2
      exit 1
    fi
    if [[ -n "$(git -C "$APP_DIRECTORY" status --porcelain)" ]]; then
      echo "Existing checkout has local changes. The installer will not overwrite it." >&2
      exit 1
    fi
    git -C "$APP_DIRECTORY" fetch origin "$BRANCH"
    git -C "$APP_DIRECTORY" pull --ff-only origin "$BRANCH"
  elif [[ -e "$APP_DIRECTORY" ]]; then
    echo "${APP_DIRECTORY} exists but is not a Git checkout. Choose another --app-directory or remove it manually." >&2
    exit 1
  else
    git clone --branch "$BRANCH" --single-branch "$REPOSITORY_URL" "$APP_DIRECTORY"
  fi
  chown -R "$APP_USER:$APP_USER" "$APP_DIRECTORY"
}

set_env_value() {
  local key="$1" value="$2"
  KEY="$key" VALUE="$value" ENV_FILE="$APP_DIRECTORY/.env" node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const key = process.env.KEY;
const value = process.env.VALUE;
const file = process.env.ENV_FILE;
let text = readFileSync(file, "utf8");
const pattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=.*$`, "m");
const line = `${key}=${value}`;
text = pattern.test(text) ? text.replace(pattern, line) : `${text.replace(/\n?$/, "\n")}${line}\n`;
writeFileSync(file, text, { mode: 0o600 });
NODE
}

current_env_value() {
  local key="$1"
  grep -E "^${key}=" "$APP_DIRECTORY/.env" | tail -n1 | cut -d= -f2- || true
}

needs_value() {
  local value="$1"
  [[ -z "$value" || "$value" == *"CHANGE_THIS"* || "$value" == *"example.com"* || "$value" == "__GENERATE__" ]]
}

prompt_value() {
  local key="$1" question="$2" default="${3:-}" secret="${4:-0}" current value
  current="$(current_env_value "$key")"
  if ! needs_value "$current"; then return; fi
  if [[ -n "$default" ]]; then question+=" [${default}]"; fi
  if [[ "$secret" == "1" ]]; then
    read -r -s -p "$question: " value; echo
  else
    read -r -p "$question: " value
  fi
  value="${value:-$default}"
  require_value "$value" "${key} is required."
  set_env_value "$key" "$value"
}

resolve_persisted_deployment_options() {
  local stored_database_mode stored_origin_lock
  stored_database_mode="$(current_env_value DATABASE_MODE)"
  if [[ "$stored_database_mode" == "local" || "$stored_database_mode" == "external" ]]; then
    if [[ "$DATABASE_MODE_EXPLICIT" == "1" && "$DATABASE_MODE" != "$stored_database_mode" ]]; then
      echo "This installation already uses DATABASE_MODE=${stored_database_mode}. The bootstrap refuses to switch database sources automatically." >&2
      echo "Perform a separately reviewed data migration and update .env deliberately before changing database modes." >&2
      exit 1
    fi
    DATABASE_MODE="$stored_database_mode"
  fi
  if [[ "$MODE" == "docker" && "$DATABASE_MODE" == "external" ]]; then
    echo "This installation records DATABASE_MODE=external and cannot be converted to Docker's local database automatically." >&2
    exit 1
  fi
  stored_origin_lock="$(current_env_value CLOUDFLARE_ORIGIN_LOCKED)"
  if [[ "$stored_origin_lock" == "1" && "$LOCK_CLOUDFLARE_ORIGIN_EXPLICIT" == "0" ]]; then
    LOCK_CLOUDFLARE_ORIGIN=1
  fi
  if [[ "$LOCK_CLOUDFLARE_ORIGIN" == "1" && "$CLOUDFLARE_PROXY" == "0" ]]; then
    echo "This installation has a persisted Cloudflare origin lock. Do not combine it with --no-cloudflare-proxy." >&2
    exit 1
  fi
}

configure_environment() {
  as_app_user "cd '$APP_DIRECTORY' && ./scripts/prepare-environment.sh"
  chmod 600 "$APP_DIRECTORY/.env"
  chown "$APP_USER:$APP_USER" "$APP_DIRECTORY/.env"
  resolve_persisted_deployment_options

  prompt_value APP_ORIGIN "Public HTTPS origin, for example https://invoices.example.com"
  local origin
  origin="$(current_env_value APP_ORIGIN)"
  if [[ ! "$origin" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]]; then
    echo "APP_ORIGIN must be a simple HTTPS origin without a path, for example https://invoices.example.com." >&2; exit 1
  fi

  if [[ "$MODE" == "native" && "$DATABASE_MODE" == "external" ]]; then
    prompt_value DATABASE_URL "External MySQL DATABASE_URL" "" 1
  fi

  prompt_value S3_ENDPOINT "Private S3-compatible endpoint, for example https://s3.us-east-1.amazonaws.com"
  prompt_value S3_REGION "S3 region" "us-east-1"
  prompt_value S3_BUCKET "Private S3 bucket name"
  prompt_value S3_ACCESS_KEY_ID "S3 access key ID" "" 1
  prompt_value S3_SECRET_ACCESS_KEY "S3 secret access key" "" 1
  prompt_value BOOTSTRAP_ADMIN_EMAIL "Initial local administrator email" "admin@welfarepride.local"
  set_env_value FORCE_SECURE_COOKIES true
  set_env_value TRUST_PROXY true
  set_env_value CLOUDFLARE_PROXY_ENABLED "$CLOUDFLARE_PROXY"
  set_env_value CLOUDFLARE_ORIGIN_LOCKED "$LOCK_CLOUDFLARE_ORIGIN"
  set_env_value DATABASE_MODE "$DATABASE_MODE"
  if [[ "$MODE" == "native" ]]; then set_env_value BIND_HOST 127.0.0.1; else set_env_value BIND_HOST 0.0.0.0; fi
  chmod 600 "$APP_DIRECTORY/.env"
  chown "$APP_USER:$APP_USER" "$APP_DIRECTORY/.env"
}

install_native_application() {
  as_app_user "cd '$APP_DIRECTORY' && corepack enable && corepack prepare pnpm@10.18.0 --activate && pnpm install --frozen-lockfile && pnpm build && pnpm db:migrate && pnpm bootstrap:admin"
  local node_bin run_group
  node_bin="$(command -v node)"
  run_group="$(id -gn "$APP_USER")"
  cat > /etc/systemd/system/welfare-pride-invoices.service <<EOF
[Unit]
Description=Welfare Pride Invoices
After=network.target mysql.service mariadb.service

[Service]
Type=simple
WorkingDirectory=${APP_DIRECTORY}
User=${APP_USER}
Group=${run_group}
EnvironmentFile=${APP_DIRECTORY}/.env
Environment=NODE_ENV=production
UMask=0077
ExecStart=${node_bin} ${APP_DIRECTORY}/dist/index.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now welfare-pride-invoices
}

install_docker_application() {
  usermod -aG docker "$APP_USER" || true
  (cd "$APP_DIRECTORY" && ./scripts/install-docker.sh)
}

download_cloudflare_networks() {
  local output="$1" ipv4 ipv6
  ipv4="$(curl --fail --silent --show-error https://www.cloudflare.com/ips-v4)"
  ipv6="$(curl --fail --silent --show-error https://www.cloudflare.com/ips-v6)"
  if [[ -z "$ipv4" || -z "$ipv6" ]]; then
    echo "Unable to download Cloudflare IP ranges. Refusing to configure trusted Cloudflare real-IP handling." >&2
    exit 1
  fi
  {
    echo "# Generated by Welfare Pride Invoices VPS bootstrap. Refresh when Cloudflare changes its published ranges."
    while IFS= read -r cidr; do [[ -n "$cidr" ]] && printf 'set_real_ip_from %s;\n' "$cidr"; done <<< "$ipv4"
    while IFS= read -r cidr; do [[ -n "$cidr" ]] && printf 'set_real_ip_from %s;\n' "$cidr"; done <<< "$ipv6"
    echo "real_ip_header CF-Connecting-IP;"
    echo "real_ip_recursive on;"
  } > "$output"
}

configure_cloudflare_origin_lock() {
  local source="/etc/nginx/conf.d/welfare-pride-cloudflare-realip.conf" target="/etc/nginx/conf.d/welfare-pride-cloudflare-origin-lock.conf" cidr
  if [[ "$LOCK_CLOUDFLARE_ORIGIN" != "1" ]]; then rm -f "$target"; return; fi
  [[ -f "$source" ]] || download_cloudflare_networks "$source"
  {
    echo "# Generated by Welfare Pride Invoices VPS bootstrap. Only Cloudflare may reach this public origin."
    while IFS= read -r cidr; do
      cidr="${cidr#*set_real_ip_from }"; cidr="${cidr%;}"
      printf 'allow %s;\n' "$cidr"
    done < <(grep '^set_real_ip_from ' "$source")
    echo "deny all;"
  } > "$target"
  echo "Cloudflare-only Nginx origin lock enabled. Re-running this installer refreshes the protected Cloudflare network ranges."
}

configure_nginx() {
  [[ "$SKIP_NGINX" == "1" ]] && return
  local origin domain upstream cloudflare_include="" origin_lock_include=""
  origin="$(current_env_value APP_ORIGIN)"
  domain="${origin#https://}"; domain="${domain%%:*}"
  upstream="127.0.0.1:3000"
  if [[ "$CLOUDFLARE_PROXY" == "1" ]]; then
    download_cloudflare_networks /etc/nginx/conf.d/welfare-pride-cloudflare-realip.conf
    cloudflare_include="  include /etc/nginx/conf.d/welfare-pride-cloudflare-realip.conf;"
  else
    rm -f /etc/nginx/conf.d/welfare-pride-cloudflare-realip.conf
  fi
  configure_cloudflare_origin_lock
  [[ "$LOCK_CLOUDFLARE_ORIGIN" == "1" ]] && origin_lock_include="  include /etc/nginx/conf.d/welfare-pride-cloudflare-origin-lock.conf;"
  cat > /etc/nginx/sites-available/welfare-pride-invoices <<EOF
server {
  listen 80;
  server_name ${domain};
  client_max_body_size 8m;

${cloudflare_include}
${origin_lock_include}

  location / {
    proxy_pass http://${upstream};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }
}
EOF
  ln -sfn /etc/nginx/sites-available/welfare-pride-invoices /etc/nginx/sites-enabled/welfare-pride-invoices
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl enable --now nginx
  systemctl reload nginx
}

apt_install_basics
install_node_22
if [[ "$MODE" == "docker" ]]; then install_docker; fi
prepare_checkout
configure_environment
if [[ "$MODE" == "native" ]]; then
  if [[ "$DATABASE_MODE" == "local" ]]; then
    install_local_mysql
    provision_local_mysql_database
  fi
  install_native_application
else
  install_docker_application
fi
configure_nginx

ORIGIN="$(current_env_value APP_ORIGIN)"
echo
echo "Installation complete."
echo "Health check: ${ORIGIN}/api/health"
echo "Next: point a Cloudflare DNS-only record at this server, issue/install an origin certificate, then enable Cloudflare proxying with SSL/TLS Full (strict) before production sign-in."
echo "Sign in with the bootstrap email shown above, change the temporary password, scan the MFA QR code, and save recovery codes."
echo "After HTTPS is active, configure branding, mail, SSO, backups, and recurring cron jobs in the application."
