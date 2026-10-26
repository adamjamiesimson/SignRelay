# Field-test protocols: MAN-1, MAN-2, devices, new signers

Prepared 23 October 2026. **None of these tests has been performed.** No result in this repository comes from a real camera, a phone, a new signer or a fluent reviewer. Setup and screen states: [operator-kit.md](operator-kit.md).

Rules for every part:

- Log **every** attempt the moment it ends. Never repeat an attempt until it works and keep only the success. A retry is a new row; the earlier row stays.
- A camera, tracking or recognition failure during an attempt is a **failure** row. It is never removed from the count.
- Do not change thresholds, rules, the tail guard or the HELLO / THANK YOU / YES experiments because of these observations, and do not re-run the same takes after any change. Results go to the owner; any change needs a separate decision and fresh recordings.
- Pseudonyms only (`P01`, `S01`). No names, e-mail addresses, camera device names, video or landmarks in any log.
- Results stay under `evaluation/results/` (git-ignored; `npm run repo:guard` fails if anything there is ever tracked). Never commit, upload to CI, or post them publicly.
- These are **unreviewed operator observations**, not accuracy. Do not present a percentage.

## A. MAN-1: six-word recognition trial

**Who:** operator plus one signer. **Where:** the demo laptop and its own webcam, prepared build (`npm run demo:serve`), `http://127.0.0.1:3000/?perf`.

**Pre-flight (mandatory):**
1. Camera **Active**, Camera options says *loaded from this site*.
2. The signer signs freely for 60 s. The `?perf` line must show **≥ 10 frames analysed/s** and no red throughput warning. Write the number down. If it is below 10, stop and fix the laptop first (operator kit §8); do not run the block, because words are lost below that rate for software reasons.
3. Auto speak **off** (speech is MAN-5). Transcript empty (**Save & clear**).
4. In a second terminal: `npm run eval:log`. Enter session `S01` (next session `S02`, …), participant `P01`, device (e.g. `demo-laptop built-in webcam`), conditions (e.g. `indoor bright, plain wall, 1 m`), and the frames/s from step 2.

**Order (fixed, 12 attempts).** Round 1 is forward, round 2 reversed, so no word always follows the same one:

| # | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Sign | HELLO | THANK YOU | PLEASE | SORRY | YES | NO | NO | YES | SORRY | PLEASE | THANK YOU | HELLO |
| `eval:log` key | 1 | 2 | 3 | 4 | 5 | 6 | 6 | 5 | 4 | 3 | 2 | 1 |

**Each attempt:**
1. Signer rests the hands below the chest or out of frame for **3 s**; the chip shows *Ready* ("waiting for hands" before Sprint 7).
2. Operator says the word; the signer signs it **once**, naturally, then lowers the hands.
3. Watch the transcript for **4 s** after the hands are lowered. Ignore "Possible match · not confirmed"; only transcript entries count.
4. Log it in `eval:log` immediately:

| Key | Outcome | Definition |
| --- | --- | --- |
| `c` | correct | only the attempted word was added |
| `w` | wrong | any other word was added, alone or with the attempted word; type every word that appeared |
| `m` | no match | nothing was added within 4 s |
| `f` | failure | the camera stopped, the chip showed *camera unavailable* / *recognition unavailable*, or the page froze; describe it |

   If the attempted word was added **twice**, log `c` with the note `added twice` (the logger counts it as correct; the note keeps the duplicate visible).
5. **Remove** any wrong entry before the next attempt so it cannot be confused with the next one; note `removed` in the row.

A signer's own mistake (false start, wrong sign) is still logged, with the note `signer error`. Complete all 12 attempts whatever happens. One optional extra block (another 12, same order) is allowed per session if the owner wants more rows; it is logged as additional rows, never instead of the first block.

**Repeat MAN-1 for MAN-3** once with the network off (condition `offline`, operator kit §9).

**Summary:** `npm run eval:live -- evaluation/results/<file>.jsonl`. Report the counts per word (correct / wrong / no match / failure) with the frames/s, never a percentage.

## B. MAN-2: everyday movements and unknown signs (false accepts)

The quantity of interest is **words that were added when no supported sign was made**. Successful detections are not counted here.

Same setup and pre-flight as part A, same `eval:log` session or a new one. Each movement is performed **3 times**, with a 3 s rest (hands down) before each. Watch the transcript for 4 s after each one. Log every repetition as `n` (no-sign movement) or `u` (unsupported sign), outcome `m` if nothing was added or `w` with the word(s) that appeared. Put the movement name in the note.

| # | Movement (note text) | Why it is included |
| --- | --- | --- |
| 1 | `rest 30 s` — hands at rest in the lap or at the chest for 30 s (once) | baseline |
| 2 | `adjust glasses` | synthetic risk: THANK YOU (36/36 synthetic runs) |
| 3 | `push glasses up nose` | synthetic risk: THANK YOU |
| 4 | `push hair aside at forehead` | synthetic risk: HELLO |
| 5 | `tuck hair behind ear` | synthetic risk: HELLO (12/36) |
| 6 | `hand from chin up to forehead` | synthetic risk: HELLO |
| 7 | `lower hand from mouth to rest` | synthetic risk: THANK YOU |
| 8 | `shield eyes from light` | synthetic risk: THANK YOU (28/36) |
| 9 | `wave across the room` | synthetic risk: HELLO (36/36) |
| 10 | `blow a kiss` | synthetic risk: HELLO (24/36) |
| 11 | `scratch chin`, `touch face`, `rub eye` | face touching (no synthetic word) |
| 12 | `talk with hand gestures` for 10 s | conversational beats |
| 13 | `cough into hand`, `drink from cup` | ordinary actions |
| 14 | `smile, nod, shake head, talk` (no hands) | face movement only |
| 15 | `reach toward camera`, `reach across chest` | large arm movements |
| 16 | `u`: three ASL signs outside the six, chosen by the signer (e.g. WATER, MOTHER, NAME); note the gloss | unknown signs |

Movements 2–10 come from `docs/gitex/known-false-accept-risks.json` and `docs/gitex/adversarial-inventory.json`. The synthetic figures in that file are **not** a false-accept rate and the live result may be better or worse.

**Report:** for each movement, how many of its repetitions added a word and which word. Any added word is a false accept, even HELLO for a wave. Do not change any recognition rule because of the result (see the rules above); hand the log to the owner.

## C. Device measurement: demo laptop and two phones

Software timings on this repository's CI and container are regression records only. This part produces the first device numbers. Do not fill any field from another device, an emulator or a headless browser.

**Devices:** the demo laptop, plus at least two phones (ideally one Android, one iPhone). Phone access: operator kit §10. Record for each: device model, OS version, browser and version, power state (plugged / battery %), and the exact URL and commit tested.

**Procedure per device** (open `/?perf`, choose ASL, Start signing; on a fresh browser profile skip the first-run tour, then Start camera):

| Step | Measure | How |
| --- | --- | --- |
| C1 Cold start | seconds from pressing *Start signing* (or *Start camera* after the tour) to **Active** | stopwatch; first load after a browser restart |
| C2 Warm start | the same after **Pause camera** → **Start camera** | stopwatch |
| C3 Throughput | the full `?perf` line after 60 s of continuous signing | copy the line as text (or photograph it); it contains tracking p50/p95, round trip p50/p95, queue wait, forwarded/s, dropped %, **frames analysed/s**, recoveries and hand-tracked % |
| C4 Responsiveness | does Edit / Remove / Pause react at once (< 0.5 s by eye)? | yes / no per control |
| C5 Interruptions | after each: switch tab and back; lock the screen 10 s and unlock; (phones) rotate; unplug or cover the camera (laptop) | does the page say what happened, and does one press of **Start camera** / **Retry camera** recover? |
| C6 Sustained use | 10 minutes: sign MAN-1's order every 2 minutes, idle in between | at 1 min and 10 min copy the `?perf` line; note any throughput warning, *recognition unavailable* or recovery count above 0 |
| C7 Memory (laptop) | Chrome Task Manager (`Shift+Esc`, or ⋮ → More tools → Task manager): memory of the SignRelay tab at 1 min and 10 min | numbers in MB |
| C7 Memory (phones) | Android: `chrome://inspect` → inspect → Performance monitor (JS heap), if available; iPhone: not measurable without a Mac, record "not measured" | numbers or "not measured" |

**Pass / fail per device:**

| | Criterion | Source |
| --- | --- | --- |
| P1 | frames analysed/s **≥ 10** in C3 and at 10 min in C6 | established MAN-1 threshold (`MIN_ANALYSED_PER_SECOND`) |
| P2 | no throughput warning during C3 | the app's own 5 s window |
| P3 | 0 recoveries and no *recognition unavailable* in C6 | `?perf` "recognition running, 0 recoveries" |
| P4 | every interruption in C5 is reported and recovers with one press | MAN-4 |
| P5 | memory at 10 min no more than 1.5 × the 1-min value | **proposed** by this sprint; the owner should confirm or change it before the test |

A device that fails P1 is **not suitable** for recognition demos, whatever else passes. Record failures exactly; do not repeat a step until it passes.

**Preserve results:** write one file per device to `evaluation/results/device-<YYYY-MM-DD>-<device-pseudonym>.md` (git-ignored) with the fields above and the raw `?perf` lines. Photos of the screen may contain faces: store them only in the same ignored folder and delete them once transcribed.

## D. New signers and independent fluent review (privacy-safe)

**State verified by this sprint (software only):** the private recorder (`/field-test`) is excluded from public exports (`scripts/exclude-private-routes.mjs`, `tests/private-routes.test.ts`); its CI smoke (*Private ASL Capture Browser Smoke*) passes on `c3b7fcf`; the intake (`scripts/capture-intake.mjs`) refuses paths outside the ignored `evaluation/raw/` and `evaluation/videos/`, symlinks, oversize files, mislabelled containers and a concurrently changed intake; the blind review packet (`scripts/review-packet.mjs`) hides trial IDs, planned glosses, pseudonyms and every model output; the live log refuses e-mail addresses and non-pseudonymous IDs. All of this is covered by unit tests in the passing suite. **No participant has been recorded and no reviewer recruited.**

**Steps (owner-led):**
1. **Consent first.** Written informed consent (guardian consent for minors) stored privately, outside Git. Assign a pseudonym (`P05`, …) privately. Explain that video shows the face and will be seen by one independent reviewer.
2. **Record locally.** On the owner's machine: `npm run dev`, open `http://localhost:3000/field-test` (the route exists only in dev or in a build with `SIGNRELAY_INCLUDE_PRIVATE_CAPTURE=1`, which the deploy script refuses). Choose the planned slot, record one unmodified take per slot, download the video **and** its `.capture.json`.
3. **Store privately.** Media under `evaluation/videos/<plan id>/`, intake under `evaluation/raw/` (both git-ignored). Import: `node scripts/capture-intake.mjs docs/evaluation/development-collection-plan-2026-10-17.json evaluation/raw/<intake>.json evaluation/videos/<plan id>`.
4. **Blind review.** `node scripts/review-packet.mjs packet evaluation/raw/<intake>.json evaluation/raw/review-batch-N`. Give the reviewer only `review-packet.json` and `media/` through a private channel. The reviewer must be fluent in ASL, independent of every participant and must not have seen SignRelay's output. Then merge with `node scripts/review-packet.mjs merge …` as in `docs/gitex/independent-review-guide.md`.
5. **Never** commit recordings, intakes, review packets or consent records; never attach them to a PR, issue or CI run; delete review copies after the merge. Withdrawal means deleting the participant's media, review copies and intake rows.
6. **The sealed holdout stays sealed** (`docs/evaluation/popsign-reserved-holdout-2026-10-16.json`). It is opened only once, for a frozen candidate, with the owner's separate authorisation.
