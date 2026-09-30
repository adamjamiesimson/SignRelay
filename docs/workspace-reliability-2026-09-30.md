# Workspace reliability — 30 September 2026

This update builds on the September 28 reliability branch (`1c06b71`) and
includes that work. The current Figma landing page, animation, language menu,
seven automatic language choices and installed models are retained.

## Changes

- Load saved speech/overlay settings before changing them. Previously, the
  initial persistence effect overwrote saved preferences with defaults before
  the delayed read. Only explicit preference changes now write storage.
- Keep separate in-memory transcript drafts for each sign language. Switching
  away and back restores the correct draft, including edits. Saved sessions
  retain their original language and start time, even after home navigation.
- Add Copy and Download for the current transcript and Download for saved
  history. Downloads contain corrected text, language and ISO timestamps.
  No upload or new automatic transcript storage is introduced. Reloading the
  page still discards unsaved drafts; use Save & clear or Download first.
- Keep transcripts when local saving fails, and update repeated saves of the
  same session without duplicating history. History remains limited to eight
  saved sessions.
- Save and prune personal examples in a single IndexedDB transaction. Keep
  the newest three per language and gloss, including overlapping writes and
  updates to an existing example. Resolve only after transaction completion,
  reject aborted transactions, and close connections on completion/failure.
- Serialize this tab's vocabulary writes so a pending recording cannot finish
  after a later Clear request and restore deleted data. Invalidate stale UI
  reads, stop the camera before clearing, and report partial storage failure.
- Allow cancellation while camera permission or tracking startup is pending.
  A late permission grant is released; the camera never starts after cancel.
- Cancel speech on language changes and when automatic speech is turned off.
  Show a camera-off prompt instead of a misleading movement-buffer message.
- Update the two `brace-expansion` build-tool dependencies to the compatible
  patched releases (1.1.21 and 5.0.12). No runtime dependency or framework
  version changes; the dependency audit reports zero known vulnerabilities.

## Verification

Local verification: 239 unit tests, two HTTP asset tests, TypeScript, lint,
production Firebase build, three rendered-export tests, repository asset guard
and whitespace checks passed. The new workspace browser regression passed in
Chromium with real IndexedDB, no page exceptions and no upload requests.

`tests/workspace-browser-smoke.mjs` exercises the built application with
controlled camera permission and recognition messages, plus real Chrome
IndexedDB transactions. It checks saved settings, language switching, transcript
export, storage denial, concurrent example limits, aborted transactions,
connection cleanup, data clearing, mobile overflow and no uploads.
The Firebase build workflow repeats it alongside the existing real Spanish and
Bangla model/camera browser checks. Local headless-shell tracking worked, but
that browser does not reproduce real tab activation for the existing Spanish
visibility test; the full Chrome check runs in GitHub Actions.

These checks establish software behavior, not live signing accuracy. No new
trained model or expanded accuracy claim is introduced. The September 28 CPU
ASL experiment remains uninstalled.

## Cloud Shell handoff

The changes are delivered on `improve/recognition-reliability-2026-09-28`.
Pull that branch when ready, then build and deploy to Firebase. A GitHub update
alone does not change the live site. Existing untracked `ml/` work is untouched.

```bash
cd ~/SignRelay
git fetch origin
git switch improve/recognition-reliability-2026-09-28
git pull --ff-only origin improve/recognition-reliability-2026-09-28
npm ci
npm run build:firebase
firebase deploy --only hosting --project signrelay-76f34
```

Run these commands in order; stop if a command reports an error. If Git reports
local changes, preserve them before switching branches; do not reset or clean
the working tree. Dataset training is not part of this deployment.
