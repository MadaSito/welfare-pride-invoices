#!/usr/bin/env bash
# Use as the Hostinger Node.js Web App build command: pnpm deploy:hostinger
# Hostinger installs dependencies using the selected pnpm package manager before this runs.
set -Eeuo pipefail

pnpm build
pnpm db:migrate
pnpm bootstrap:admin

echo "Hostinger build preparation finished. The server entry file is dist/index.js."
