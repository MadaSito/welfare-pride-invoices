#!/usr/bin/env bash
# Creates a private local .env from .env.example and generates only placeholder secrets.
# Do not use this in Hostinger Web App Hosting; set its environment variables in hPanel instead.
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  cp .env.example .env
  chmod 600 .env
  echo "Created .env from .env.example."
fi

node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
import crypto from "node:crypto";

const path = ".env";
let text = readFileSync(path, "utf8");
const generated = {
  APP_CONFIG_ENCRYPTION_KEY: () => crypto.randomBytes(32).toString("base64"),
  WEBHOOK_SIGNING_SECRET: () => crypto.randomBytes(48).toString("base64url"),
  RECURRING_SCHEDULER_SECRET: () => crypto.randomBytes(48).toString("base64url"),
  MYSQL_PASSWORD: () => crypto.randomBytes(24).toString("base64url"),
  MYSQL_ROOT_PASSWORD: () => crypto.randomBytes(32).toString("base64url"),
};
let changed = [];
for (const [key, create] of Object.entries(generated)) {
  const expression = new RegExp(`^${key}=(.*)$`, "m");
  const existing = text.match(expression)?.[1]?.trim();
  if (existing && existing !== "__GENERATE__") continue;
  const value = create();
  text = expression.test(text) ? text.replace(expression, `${key}=${value}`) : `${text.replace(/\n?$/, "\n")}${key}=${value}\n`;
  changed.push(key);
}
writeFileSync(path, text, { mode: 0o600 });
console.log(changed.length ? `Generated values for: ${changed.join(", ")}` : "Deployment secrets were already configured; nothing was overwritten.");
NODE

echo "Next: set DATABASE_URL, APP_ORIGIN, and private S3-compatible storage values in .env before installing."
