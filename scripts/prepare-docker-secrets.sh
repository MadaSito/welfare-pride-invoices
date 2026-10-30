#!/usr/bin/env bash
# Keeps the MySQL root password out of the application/migration container environment.
set -Eeuo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  echo "Missing .env. Run scripts/prepare-environment.sh first." >&2
  exit 1
fi

secret_dir=".secrets"
secret_file="${secret_dir}/mysql_root_password"
mkdir -p "$secret_dir"
chmod 700 "$secret_dir"

read_env() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- || true; }
remove_env() {
  KEY="$1" node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const key = process.env.KEY;
let text = readFileSync(".env", "utf8");
text = text.replace(new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=.*\\n?`, "m"), "");
writeFileSync(".env", text, { mode: 0o600 });
NODE
}

if [[ -f "$secret_file" && -s "$secret_file" ]]; then
  # A repeatable update may have reintroduced a new generated .env value; retain the existing database root secret.
  remove_env MYSQL_ROOT_PASSWORD
  chmod 600 "$secret_file"
  echo "Retained existing local MySQL root secret."
  exit 0
fi

password="$(read_env MYSQL_ROOT_PASSWORD)"
if [[ ! "$password" =~ ^[A-Za-z0-9_-]{16,}$ ]]; then
  echo "MYSQL_ROOT_PASSWORD must be a generated URL-safe value before Docker deployment." >&2
  exit 1
fi
printf '%s' "$password" > "$secret_file"
chmod 600 "$secret_file"
remove_env MYSQL_ROOT_PASSWORD
echo "Prepared local Docker MySQL root secret outside the application environment."
