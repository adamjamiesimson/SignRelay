#!/usr/bin/env bash
set -euo pipefail

echo "Building SignRelay for Firebase Hosting..."
npm install
npm run build:firebase

echo "Deploying to Firebase project signrelay-76f34, site signrelay..."
firebase deploy --only hosting --project signrelay-76f34

echo "Done: https://signrelay.web.app"
