#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MOBILE_DIR="$ROOT_DIR/mobile"
API_URL="${PRODUCTION_API_URL:-}"

if [[ -z "$API_URL" ]]; then
  echo "Set your production API URL first:"
  echo "  export PRODUCTION_API_URL='https://api.yourdomain.com/api/v1'"
  echo "  ./deploy/build-mobile-android.sh"
  exit 1
fi

echo "==> Building Android release APK"
echo "    API URL: $API_URL"

ENV_FILE="$MOBILE_DIR/src/config/env.ts"
if grep -q "api.yourdomain.com" "$ENV_FILE"; then
  echo "==> Updating PRODUCTION_API_URL in mobile/src/config/env.ts"
  perl -pi -e "s|export const PRODUCTION_API_URL = '.*';|export const PRODUCTION_API_URL = '$API_URL';|" "$ENV_FILE"
fi

cd "$MOBILE_DIR"
npm ci
cd android
./gradlew assembleRelease

APK="app/build/outputs/apk/release/app-release.apk"
if [[ -f "$APK" ]]; then
  echo ""
  echo "Release APK ready:"
  echo "  $MOBILE_DIR/android/$APK"
else
  echo "Build finished but APK not found at expected path."
  exit 1
fi
