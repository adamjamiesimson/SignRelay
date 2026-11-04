#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != "--deploy-only" ]]; then
  echo "Building SignRelay for Firebase Hosting..."
  npm ci
  npm run build:firebase
else
  echo "Using existing out/ build..."
  test -d out
  test -f out/index.html
fi

# Development exports that include the private capture studio are never deployed.
if [[ -e out/.signrelay-private-capture-included || -e out/field-test.html || -e out/field-test || -e out/study.html || -e out/study ]]; then
  echo "Refusing to deploy: out/ includes the private /field-test capture route. Rebuild without SIGNRELAY_INCLUDE_PRIVATE_CAPTURE."
  exit 1
fi

# The artifact itself must be a public production export: starter-rule words as
# suggestions, no research export, fingerspelling or private routes.
node scripts/assert-public-export.mjs out

echo "Deploying to Firebase project signrelay-76f34, site signrelay..."

max_attempts=5
attempt=1
until firebase deploy --only hosting --project signrelay-76f34; do
  if (( attempt >= max_attempts )); then
    echo "Firebase Hosting deploy failed after ${max_attempts} attempts."
    exit 1
  fi
  wait_seconds=$((attempt * 10))
  echo "Upload failed on attempt ${attempt}; retrying in ${wait_seconds}s..."
  sleep "${wait_seconds}"
  attempt=$((attempt + 1))
done

echo "Done: https://signrelay.web.app"
