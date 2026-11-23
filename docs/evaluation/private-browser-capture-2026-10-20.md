# Local ASL development recording tool (GITEX sprint, 20 Oct 2026)

**Route:** `/field-test` — a standalone browser recorder built from the 144 planned ASL development slots. It is **not a translator accuracy test** and is not an approval portal. It never calls a recording-upload endpoint or auto-commits recordings.

## Intended workflow
1. Obtain genuine informed consent, including guardian permission if applicable. Assign one of the four plan pseudonyms privately; do not write names into filenames. Independently arrange a fluent ASL reviewer.
2. Use HTTPS/localhost on the participant's device and open `/field-test`. Choose the correct participant slot, one of six positive glosses or an ordinary/unsupported-sign category, the exact take number, real dominant/physical hands, and device. The original [frozen plan](development-collection-plan-2026-10-17.json) controls slot IDs.
3. Frame face, torso and signing hand(s); record one unmodified take of at most 30 seconds. The camera's source image is **not mirrored by the capture UI**. Avoid adding pauses, re-encoding, cropping or duplicate clips to influence evaluation.
4. Download the **original video** and its **.capture.json** sidecar. Treat both as sensitive and transfer only through a private channel. A downloadable sidecar says `pending-independent-fluent-review`; it is **not** the official approved intake. Avoid public GitHub commits, public attachments and public media URLs.
5. In a local checkout, place media under ignored `evaluation/videos/asl-development-2026-10-17/` and consent/review history under ignored `evaluation/raw/`. Generate the intake with `node scripts/prepare-reviewed-development.mjs template docs/evaluation/development-collection-plan-2026-10-17.json evaluation/raw/reviewed-development-2026-10-17/intake.json`. Copy media paths into the corresponding intake `trial_id` rows (the template uses `.mp4`; browser MediaRecorder may download `.webm` or `.mp4`; use the **actual** container/extension and do not rename a WebM to `.mp4`).
6. Have the reviewer annotate the real signs/activities, variant, independent decision and genuine consent reference **before viewing predictions**. If an unsupported-sign label is used, the reviewer must independently establish it is absent from the **installed** recognizer's vocabulary. Only after approval and full cohort integrity checks, use the documented `freeze` command in [reviewed-development-collection-2026-10-17.md](reviewed-development-collection-2026-10-17.md).

## Limitations & safeguards
- The page contains a consent **checkbox**, not a consent mechanism; it cannot verify a participant's approval, guardian authorization or review independence.
- It does not upload or persist footage. Navigating/reloading discards the in-memory result unless saved with the browser download control. Download both artifacts before leaving. Camera tracks are released on leaving the route.
- `robots: noindex` reduces accidental discoverability; it is **not access control**. The capture route is included in static exports and is not an authenticated private portal. Only capture with a trusted participant and environment.
- Downloaded clips are not automatically integrated with `intake.json`; integrity, labels, cohort split and fingerprint checks remain enforced downstream. A partially completed batch may not be frozen by the existing importer.
- Desktop/mobile MediaRecorder format support varies. The browser chooses supported WebM/MP4 and matches the filename extension; test a sample before arranging participants.
- Current isolated-sign pilot remains **5 correct / 0 wrong / 6 abstentions across 11 reused development clips**; this tool creates **no new sign evaluation result** by itself. The five reserved holdout clips remain sealed.

## 21 October 2026 hardening (sidecar schema 2)

- `/field-test` is omitted from public Firebase/Vercel exports. Run it with `npm run dev`, or build with `SIGNRELAY_INCLUDE_PRIVATE_CAPTURE=1` for local synthetic tests (that export is marked and `scripts/deploy-firebase.sh` refuses it).
- A take is rejected (no download offered) when it is shorter than 1 second, empty, over 100 MB or 30 seconds, in an unsupported format, or interrupted. Interruptions include the camera track ending, the device muting/pausing the camera, the page becoming hidden, recorder errors, closing the camera, and withdrawing the consent acknowledgement.
- "Physical hands used" no longer defaults to Right; it must be chosen explicitly, like the dominant hand.
- The sidecar (`schema: 2`) adds `recording_sha256` (computed in the browser over the exact downloaded bytes), `duration_ms`, `stop_reason` (`manual` or `time-limit`), `capture_tool` and `camera_settings` (resolution, frame rate and facing mode only). Camera device labels are deliberately **not** recorded because browsers can expose names such as "<name>'s iPhone Camera".
- These are local tooling checks. They do not establish consent, a correct gloss, signing quality or review status. Every sidecar remains `pending-independent-fluent-review`.
