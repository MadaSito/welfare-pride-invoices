#!/usr/bin/env bash
# Docker Compose installer. Runs the application and a persistent MySQL database.
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required. Install Docker Engine and the Compose plugin first." >&2
  exit 1
fi

"$ROOT_DIR/scripts/prepare-environment.sh"
for key in APP_ORIGIN S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do
  value="$(grep -E "^${key}=" .env | tail -n1 | cut -d= -f2- || true)"
  if [[ -z "$value" || "$value" == *"example.com"* || "$value" == *"CHANGE_THIS"* || "$value" == "__GENERATE__" ]]; then
    echo "Edit .env before continuing: ${key} must use a production value." >&2
    exit 1
  fi
done

MYSQL_PASSWORD_VALUE="$(grep '^MYSQL_PASSWORD=' .env | cut -d= -f2-)"
if [[ ! "$MYSQL_PASSWORD_VALUE" =~ ^[A-Za-z0-9_-]{16,}$ ]]; then
  echo "MYSQL_PASSWORD must use at least 16 URL-safe base64url characters (A-Z, a-z, 0-9, _ or -) because Docker Compose constructs DATABASE_URL from it." >&2
  echo "Run scripts/prepare-environment.sh to generate a safe value, or supply your own base64url value." >&2
  exit 1
fi

"$ROOT_DIR/scripts/prepare-docker-secrets.sh"

docker compose up -d --build db
for _ in $(seq 1 72); do
  DB_CONTAINER="$(docker compose ps -q db || true)"
  if [[ -n "$DB_CONTAINER" ]] && [[ "$(docker inspect -f '{{.State.Health.Status}}' "$DB_CONTAINER" 2>/dev/null || true)" == "healthy" ]]; then break; fi
  sleep 5
done

if [[ -z "${DB_CONTAINER:-}" ]] || [[ "$(docker inspect -f '{{.State.Health.Status}}' "$DB_CONTAINER" 2>/dev/null || true)" != "healthy" ]]; then
  docker compose logs db >&2
  echo "Timed out waiting for the database; the web application was not started." >&2
  exit 1
fi

echo "Running the current migration/bootstrap task (a new administrator password appears only if an account is created):"
docker compose run --build --rm --no-deps migrate
docker compose up -d --build --no-deps app

echo "Docker installation complete. Verify with: curl http://127.0.0.1:${HOST_PORT:-3000}/api/health"
echo "Place a TLS reverse proxy in front of the container before allowing production sign-in."
