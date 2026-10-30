#!/usr/bin/env bash
# Welfare Pride Invoices portable installation selector.
# Run from a cloned release checkout, not from the web browser or Hostinger hPanel.
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-}"

usage() {
  cat <<'EOF'
Usage: ./scripts/install.sh [native|docker|vps]

  native  Install a bare-metal/VPS Node.js service (optionally with systemd).
  docker  Install Docker Compose with the application and a persistent MySQL database.
  vps     Run the interactive Ubuntu/Debian bootstrap (installs prerequisites, app, Nginx, and service).
EOF
}

if [[ "$MODE" == "-h" || "$MODE" == "--help" ]]; then usage; exit 0; fi
if [[ -z "$MODE" ]]; then
  echo "Choose an installation method:"
  select selected in "Ubuntu/Debian one-command VPS bootstrap" "Native Node.js (already provisioned host)" "Docker Compose (already provisioned host)" "Cancel"; do
    case "$REPLY" in
      1) MODE="vps"; break ;;
      2) MODE="native"; break ;;
      3) MODE="docker"; break ;;
      4) exit 0 ;;
      *) echo "Choose 1, 2, 3, or 4." ;;
    esac
  done
fi

case "$MODE" in
  native) exec "$ROOT_DIR/scripts/install-native.sh" ;;
  docker) exec "$ROOT_DIR/scripts/install-docker.sh" ;;
  vps) exec sudo bash "$ROOT_DIR/scripts/install-vps-ubuntu.sh" ;;
  *) usage; exit 2 ;;
esac
