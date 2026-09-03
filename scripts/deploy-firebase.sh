#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != "--deploy-only" ]]; then
  echo "Building SignRelay for Firebase Hosting..."
  npm install
  npm run build:firebase
else
  echo "Using existing out/ build..."
  test -d out
  test -f out/index.html
fi

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
