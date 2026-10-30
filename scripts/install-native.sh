#!/usr/bin/env bash
# Native Node.js installer for a VPS or bare-metal Linux host.
# Optional: INSTALL_SYSTEMD=1 ./scripts/install-native.sh
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

require_command() { command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 1; }; }
require_command node
require_command corepack

node -e 'const [major] = process.versions.node.split(".").map(Number); if (major < 22 || major > 24) { console.error("Node.js 22, 23, or 24 is required."); process.exit(1); }'
"$ROOT_DIR/scripts/prepare-environment.sh"

if grep -Eq 'CHANGE_THIS|example\.com|__GENERATE__' .env; then
  echo "Edit .env before continuing: DATABASE_URL, APP_ORIGIN, and S3 storage values must use production values." >&2
  exit 1
fi

corepack enable
corepack prepare pnpm@10.18.0 --activate
pnpm install --frozen-lockfile
pnpm build
pnpm db:migrate
pnpm bootstrap:admin

if [[ "${INSTALL_SYSTEMD:-0}" == "1" ]]; then
  require_command sudo
  PNPM_EXECUTABLE="$(command -v pnpm)"
  RUN_USER="$(id -un)"
  RUN_GROUP="$(id -gn)"
  ESCAPED_DIR="$(printf '%s' "$ROOT_DIR" | sed 's/[&|]/\\&/g')"
  ESCAPED_PNPM="$(printf '%s' "$PNPM_EXECUTABLE" | sed 's/[&|]/\\&/g')"
  sed -e "s|__APP_DIRECTORY__|$ESCAPED_DIR|g" -e "s|__PNPM_EXECUTABLE__|$ESCAPED_PNPM|g" -e "s|__RUN_USER__|$RUN_USER|g" -e "s|__RUN_GROUP__|$RUN_GROUP|g" deploy/systemd/welfare-pride-invoices.service | sudo tee /etc/systemd/system/welfare-pride-invoices.service >/dev/null
  sudo systemctl daemon-reload
  sudo systemctl enable --now welfare-pride-invoices
  echo "Installed and started systemd service: welfare-pride-invoices"
else
  echo "Native installation complete. Start the application with: pnpm start"
  echo "For systemd, rerun with: INSTALL_SYSTEMD=1 ./scripts/install-native.sh"
fi

echo "Confirm GET /api/health, then sign in with the bootstrap administrator and complete password change plus MFA."
