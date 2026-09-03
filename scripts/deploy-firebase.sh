#!/usr/bin/env bash
set -euo pipefail

echo "Building SignRelay for Firebase Hosting..."
npm install
npm run build:firebase

echo "Deploying to Firebase project signrelay-76f34, site signrelay..."
firebase use signrelay-76f34 --add >/dev/null 2>&1 || firebase use signrelay-76f34
firebase deploy --only hosting

echo "Done: https://signrelay.web.app"
