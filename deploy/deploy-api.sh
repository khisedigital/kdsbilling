#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
API_DIR="$ROOT_DIR/api"
LOG_DIR="$ROOT_DIR/logs"
UPLOAD_DIR="${UPLOAD_PATH:-/var/www/billing-poz/uploads}"

echo "==> Billing POS API deploy"
echo "    Root: $ROOT_DIR"

cd "$API_DIR"

if [[ ! -f .env ]]; then
  echo "Missing api/.env — copy from .env.production.example first:"
  echo "  cp api/.env.production.example api/.env"
  exit 1
fi

echo "==> Install dependencies"
npm ci

echo "==> Production preflight"
node scripts/preflight-production.js

echo "==> Ensure upload directory"
mkdir -p "$UPLOAD_DIR"
chmod 755 "$UPLOAD_DIR"

echo "==> Ensure log directory"
mkdir -p "$LOG_DIR"

echo "==> Setup master database (if needed)"
npm run setup:master-db

echo "==> Run master migrations"
npm run migrate:master

if [[ "${SKIP_PROVISION:-0}" != "1" ]]; then
  echo "==> Provision demo tenant (skip with SKIP_PROVISION=1)"
  npm run provision:tenant || echo "Tenant may already exist — continuing"
fi

echo "==> Run tenant migrations (all shops)"
npm run migrate:tenant:all

cd "$ROOT_DIR"

echo "==> Start / reload PM2"
if pm2 describe billing-api >/dev/null 2>&1; then
  pm2 reload ecosystem.config.js --update-env
else
  pm2 start ecosystem.config.js
fi

pm2 save

echo "==> Health check"
sleep 2
curl -fsS "http://127.0.0.1:${PORT:-3000}/health" && echo ""

echo ""
echo "Deploy complete."
echo "  API:      http://127.0.0.1:${PORT:-3000}"
echo "  Admin:    http://127.0.0.1:${PORT:-3000}/admin"
echo "  Health:   http://127.0.0.1:${PORT:-3000}/health"
echo "  Logs:     pm2 logs billing-api"
echo ""
echo "Next: configure Nginx + SSL (see docs/DEPLOYMENT.md)"
