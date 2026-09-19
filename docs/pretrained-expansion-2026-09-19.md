# Pretrained expansion — 19 September 2026

This continues the 12–17 September installation notes and the same-day
[language expansion research](language-expansion-research-2026-09-19.md).
Work is on `claude/eager-fermi-mbevgh`, rebased from
`feature/pretrained-language-expansion`. No hosting branch or live site was
updated; Firebase deployment remains for the owner.

## Seventh language installed: Pakistan Sign Language (PSL)

775 official signs from the Pakistan Sign Language dictionary recorded at
Hamza Foundation Academy for the Deaf (HFAD), Lahore, released by the
[sign-language-translator/sign-language-datasets](https://github.com/sign-language-translator/sign-language-datasets)
project under CC BY 4.0. Source: GitHub Release `v0.0.4`,
`pk-hfad-1.landmarks-mediapipe-image-csv.zip` (788 files, verified download,
75 MediaPipe landmarks/frame = pose(33) + left hand(21) + right hand(21),
verified against the source project's own `connections.py` index layout, not
assumed).

**This is not a trained classifier, unlike ASL/BSL/RSL/Bangla/LSE/ISL.** Each
sign has exactly one official reference performance. Recognition
(`lib/psl776-runtime.ts`) is one-shot dynamic-time-warping distance matching
against that single reference, reusing the exact same distance function and
reject gate already tested for personal signer templates
(`lib/personalized-recognition.ts`: `prepareCalibrationSequence`,
`sequenceDistance`). No new matching logic was written for correctness-
critical code; only the template source changed. Full detail and honesty
caveats: [PSL attribution](../public/models/psl776-hfad/ATTRIBUTION.md).

775 of 788 released dictionary entries had a usable English gloss (from the
release's own `pk-dictionary-mapping.json`) and at least 8 frames of tracked
hand motion; 13 were skipped rather than guessed. See
`training/prepare_psl_hfad.ts` for the exact, reproducible conversion
(requires a local copy of the release zip and mapping file; raw assets are
not committed).

### Performance check before shipping

A naive full sweep against all 775 templates measured ~400ms median in
Node (5-run benchmark, `sequenceDistance` against every template). Run on
every camera frame, this would stall the worker far longer than the
existing 8-second recovery watchdog tolerates well, and reproduce exactly
the "recognition stopped responding" failure already fixed for ASL. Instead
of approximating (which would add an unverified accuracy risk on top of an
already-unevaluated matcher), PSL is registered as a fifth entry in
`recognition.worker.ts`'s existing `classifiers` map - the same async,
motion-gated, one-inference-at-a-time scheduling already proven for BSL/
ISL/LSE, including the 8-second fault-recovery watchdog and cooldown.
This required no new worker architecture, only wiring PSL into the path
that already exists for exactly this class of problem (see the "BSL/ISL/LSE
shape gate" fix earlier this session, `lib/asl100-runtime.ts`).

### Bundle size

The full landmark bundle is committed as a single gzip'd JSON
(`public/models/psl776-hfad/templates.json.gz`, 6.7 MB; values rounded to 4
decimal places before compression). A separate `labels.json` (9.6 KB, gloss
list only) is imported into the main app bundle for vocabulary display, so
the multi-megabyte template data never ships outside the worker that
actually performs matching. Checksums are pinned and verified at build time
(`scripts/verify-psl-assets.mjs`, wired into `build:firebase`).

### What was NOT done

- No live-camera test. This sandbox has no way to perform one; the sanity
  check that exists is a distance sweep confirming distinct official signs
  are separable (median pairwise distance ~0.58, self-distance 0.0), which
  confirms the pipeline is not obviously broken, not that it recognizes
  real signing accurately.
- No claim of parity with the six neural-network-trained languages. PSL's
  own status text and README entry say plainly that it is one-shot
  matching, not a trained classifier, with zero accuracy evaluation.

## Other language research this session

Documented separately in
[language-expansion-research-2026-09-19.md](language-expansion-research-2026-09-19.md):
NGT200 (Dutch, CC BY 4.0, MediaPipe-native, 200 signs) is a strong 8th-
language candidate blocked only by this sandbox's network policy (`osf.io`
is not reachable here). Seven other candidates were checked and ruled out
for recorded, specific reasons (gated access, too small, wrong data type,
or unreachable hosts).

## Verification

- `npm test -- --run`: 22 test files, 213 tests passed (211 prior + a new
  5-test suite for `lib/psl776-runtime.ts`, plus 2 updated registry-count
  assertions).
- `npm run lint`: clean.
- `npx tsc --noEmit`: clean.
- `npm run build:worker`: `recognition.worker.js` bundles cleanly with the
  new runtime (651.5 KB, was smaller before PSL; still one bundled worker,
  no new worker file needed).
- `node scripts/verify-psl-assets.mjs`: passes against the committed bundle.
- `build:firebase` was not run end-to-end: its RSL step downloads the
  Slovo checkpoint from a Sberbank Cloud domain this sandbox's network
  policy blocks (an existing, unrelated limitation - see the 17 September
  handoff for context). The Bangla and LSE asset-verification steps that
  precede it both pass.
