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
SKIP_NGINX=0

usage() {
  cat <<'EOF'
Usage: sudo bash scripts/install-vps-ubuntu.sh [--mode native|docker] [options]

Options:
  --mode native|docker  Native Node.js 22 + systemd (default), or Docker Compose + MySQL.
  --app-directory PATH Installation directory (default: /opt/welfare-pride-invoices).
  --app-user NAME      Non-root service account (default: welfarepride).
  --branch NAME        Repository branch to deploy (default: main).
  --repository URL     Git repository URL to deploy.
  --skip-nginx         Do not install or configure the Nginx reverse proxy.
  -h, --help           Show this help.

The installer asks for your HTTPS origin, private S3-compatible logo storage, and first
administrator email. Native mode also asks for an external MySQL DATABASE_URL. It generates
missing encryption, webhook, scheduler, and Docker database secrets locally. The initial local
administrator password is generated and shown only when the account is first created.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="${2:-}"; shift 2 ;;
    --app-directory) APP_DIRECTORY="${2:-}"; shift 2 ;;
    --app-user) APP_USER="${2:-}"; shift 2 ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --repository) REPOSITORY_URL="${2:-}"; shift 2 ;;
    --skip-nginx) SKIP_NGINX=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ "$MODE" != "native" && "$MODE" != "docker" ]]; then
  echo "--mode must be native or docker." >&2; exit 2
fi

if [[ "${EUID}" -ne 0 ]]; then
  echo "Re-running through sudo so packages, service files, and Nginx can be configured."
  exec sudo -E bash "$0" --mode "$MODE" --app-directory "$APP_DIRECTORY" --app-user "$APP_USER" --branch "$BRANCH" --repository "$REPOSITORY_URL" $([[ "$SKIP_NGINX" == "1" ]] && printf '%s' '--skip-nginx')
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

configure_environment() {
  as_app_user "cd '$APP_DIRECTORY' && ./scripts/prepare-environment.sh"
  chmod 600 "$APP_DIRECTORY/.env"
  chown "$APP_USER:$APP_USER" "$APP_DIRECTORY/.env"

  prompt_value APP_ORIGIN "Public HTTPS origin, for example https://invoices.example.com"
  local origin
  origin="$(current_env_value APP_ORIGIN)"
  if [[ ! "$origin" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]]; then
    echo "APP_ORIGIN must be a simple HTTPS origin without a path, for example https://invoices.example.com." >&2; exit 1
  fi

  if [[ "$MODE" == "native" ]]; then
    prompt_value DATABASE_URL "External MySQL DATABASE_URL" "" 1
  fi

  prompt_value S3_ENDPOINT "Private S3-compatible endpoint, for example https://s3.us-east-1.amazonaws.com"
  prompt_value S3_REGION "S3 region" "us-east-1"
  prompt_value S3_BUCKET "Private S3 bucket name"
  prompt_value S3_ACCESS_KEY_ID "S3 access key ID" "" 1
  prompt_value S3_SECRET_ACCESS_KEY "S3 secret access key" "" 1
  prompt_value BOOTSTRAP_ADMIN_EMAIL "Initial local administrator email" "admin@welfarepride.local"
  set_env_value FORCE_SECURE_COOKIES true
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
After=network.target

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
  # DATABASE_URL is overridden by Compose. It may remain a native-install placeholder.
  (cd "$APP_DIRECTORY" && docker compose up -d --build)
  for _ in $(seq 1 72); do
    local container status
    container="$(cd "$APP_DIRECTORY" && docker compose ps -q migrate || true)"
    if [[ -n "$container" ]]; then
      status="$(docker inspect -f '{{.State.Status}}:{{.State.ExitCode}}' "$container")"
      if [[ "$status" == "exited:0" ]]; then
        echo "Initial migration/bootstrap output (save the displayed one-time administrator password now):"
        (cd "$APP_DIRECTORY" && docker compose logs migrate)
        return
      fi
      if [[ "$status" == exited:* ]]; then
        (cd "$APP_DIRECTORY" && docker compose logs migrate >&2)
        echo "Migration/bootstrap failed; the web service was not started." >&2
        exit 1
      fi
    fi
    sleep 5
  done
  echo "Timed out waiting for migration/bootstrap." >&2; exit 1
}

configure_nginx() {
  [[ "$SKIP_NGINX" == "1" ]] && return
  local origin domain upstream
  origin="$(current_env_value APP_ORIGIN)"
  domain="${origin#https://}"
  upstream="127.0.0.1:3000"
  cat > /etc/nginx/sites-available/welfare-pride-invoices <<EOF
server {
  listen 80;
  server_name ${domain};
  client_max_body_size 8m;

  location / {
    proxy_pass http://${upstream};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
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
if [[ "$MODE" == "native" ]]; then install_native_application; else install_docker_application; fi
configure_nginx

ORIGIN="$(current_env_value APP_ORIGIN)"
echo
echo "Installation complete."
echo "Health check: ${ORIGIN}/api/health"
echo "Next: point DNS at this server, then issue a TLS certificate (for example with certbot) before production sign-in."
echo "Sign in with the bootstrap email shown above, change the temporary password, scan the MFA QR code, and save recovery codes."
echo "After HTTPS is active, configure branding, mail, SSO, backups, and recurring cron jobs in the application."
