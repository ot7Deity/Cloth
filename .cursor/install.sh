#!/usr/bin/env bash
# Idempotent bootstrap for the Cloth dev environment.
# Runs after the repository is checked out. Safe to run repeatedly.
set -euo pipefail

cd "$(dirname "$0")/.."

# 1. Install dependencies from the lockfile.
npm ci

# 2. Create a local dev env file if one does not already exist.
#    These are non-secret, dev-only defaults; .env is gitignored.
if [ ! -f .env ]; then
  AUTH_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
  cat > .env <<EOF
DATABASE_URL="file:./dev.db"
AUTH_SECRET="${AUTH_SECRET}"
AUTH_URL="http://localhost:3000"
CRON_SECRET="cloth-local-cron-secret"
EOF
fi

# 3. Generate the Prisma client and sync the SQLite schema.
npm run db:generate
npm run db:push
