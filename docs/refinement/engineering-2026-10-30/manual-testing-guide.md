# Manual testing guide: Windows laptop, Android and iPhone

For the operator running supervised device tests of PR #46 (worker `afd4bf13f6e5`). It adds four things to the existing [operator kit](../sprint-6/operator-kit.md) and [field-test protocols](../sprint-6/field-test-protocols.md), which remain the authority for setup, MAN-1 to MAN-5 and stop rules:

- how to read `?perf`
- recording ASL-2000 model latency
- a deliberate tracking-recovery test
- personal-sign checks

It also defines how to record *why* a THANK YOU or YES attempt was missed.

**Before you start:**

- **The worker is not validated.** This worker has no real-video pilot result yet ([report §7](README.md#7-blocked-the-asl-video-pilot)). Treat every device session as an observation of an unvalidated build. Do not present results as accuracy, and never as a percentage.
- **Nothing here changes recognition.** Do not change thresholds, rules or experiments because of what you see; send observations to the owner.
- **Log every attempt, including failures.** Never retry until an attempt works and keep only the success.
- **Keep results private.** Results stay under the git-ignored `evaluation/results/`. Never commit them, attach them to a PR, or post them. Use pseudonyms only.

## 1. Which build each device uses

| Device | Build and address | How you know which worker it runs |
| --- | --- | --- |
| Windows laptop | Local demo build of `claude/nifty-davinci-fgv665`: `npm run demo:prepare`, then `npm run demo:serve`, then `http://127.0.0.1:3000/?perf` in Chrome | `demo:serve` prints the recognition-worker fingerprint and `(matches committed bundle: true)`. It must start `afd4bf13f6e5`. |
| Android | Either the laptop's demo over USB (§4a), or the PR preview over HTTPS (§4b) | USB: the laptop's `demo:serve` line. Preview: record the commit the Vercel deployment was built from (the PR's Vercel comment links to it). |
| iPhone | PR preview over HTTPS: `https://signrelay-git-claude-nifty-davinci-fgv665-adam-s-team4.vercel.app/?perf` | Record the deployment's commit, as above |

**About the preview.** It is a full multilingual build, deployed automatically by the existing Vercel integration on every push to the branch. It is not the offline demo build. Use it only with the owner's agreement (operator kit §10), and record its commit, because it changes when the branch changes.

## 2. Reading `?perf`

With `?perf` in the address, a line appears under **Camera options** once the camera is **Active**. It updates every second. Copy it as text (or photograph it; on phones a screenshot is easiest).

```
Tracking 95/150 ms (p50/p95) · recognition round trip … · queue wait … · 9.8 forwarded/s, 3 dropped (2%) · 10.4 frames analysed/s · assets self-hosted · recognition running, 0 recoveries · hand tracked in 62% of frames · tracker worker/GPU · capture … · hands … · auxiliary … · transport … · overlay … · age … · classification … · communication … · model 1180/1650 ms · personal 4/9 ms · reference —
```

| Field | Meaning | What to do with it |
| --- | --- | --- |
| **frames analysed/s** | Camera frames the tracker processed per second, since the camera started | **Preflight:** must be **≥ 10** after 60 s of signing (P1). Below 10, words are lost for software reasons; stop recognition trials on that device. |
| **hand tracked in N% of frames** | Share of analysed frames with a detected hand | Record it per trial block. A low value during signing points to tracking loss, not recognition (§6). |
| **tracker** `worker/GPU`, `worker/CPU` or `main/CPU` | Where hand tracking runs | Record it at start and end. A change from `GPU` to `CPU` during a session means **tracking recovered** from a failure: a failed GPU is never reused. `main/CPU` is the compatibility fallback: expect lower fps. |
| **recognition running, N recoveries** | Restarts of the *recognition* worker, not of tracking | P3: must stay 0 in the ten-minute run |
| **model p50/p95** | ASL-2000 neural inference time over its last 120 runs. It shows `—` until the model has run. | **Model latency** (§3). The model runs only while a hand is held still in view after movement. |
| **personal p50/p95** | Personal-sign matching time | Record it in the personal-sign test (§5) |
| **reference** | PSL reference matching, PSL only | `—` in ASL |
| **age p50/p95** | Capture start to hand overlay drawn | Record it. This is internal timing, not sensor-to-screen latency. |
| **dropped (N%)** | Frames superseded while recognition was busy | Record it. Not a failure by itself. |

## 3. Recording ASL-2000 model latency

Why it matters: a word confirmed by the neural model alone needs one inference to finish in **under about 1.1 s**, with a 2 s still hold (PR #45's latency envelope). PR #44 measured a 2,116 ms median on the Windows laptop. On devices above the envelope, only the starter rules can confirm the six demo words.

1. Reload the page with `?perf`, start the camera and pass the fps preflight.
2. Ten times, sign any word, then **hold the final handshape still, in view, for 3 s**, then lower the hands for 3 s. The hold is when the model runs.
3. Copy the full `?perf` line. Record the `model` p50/p95 and the frames analysed/s from the same line.
4. If `model` still shows `—`, the model never ran: record "model did not run". Typical causes are the hand leaving the frame or the hold being too short.
5. Repeat at the end of the ten-minute session (field protocols C6) and record both.

Record it; it is not a pass/fail gate. Compare across devices only when they used the same build.

## 4. Device runbooks

Each runbook is: field protocols part C (C1–C7), then MAN-1 (part A), then MAN-2 (part B), with the additions below. Use `npm run eval:log` on the laptop for every MAN-1 and MAN-2 attempt, including phone attempts, with the device named in the session.

### Windows laptop

1. **Once, after pulling this branch,** convert the existing checkout to LF line endings. Run it on a clean tree; it discards uncommitted changes:

   ```bash
   git rm -r --cached -q . && git reset --hard
   ```

   Then run `git ls-files --eol`; no line may show `w/crlf`.
2. Run `npm test` (the full suite, not one file). Record passed, failed and skipped, and the name of any failure. This run is the Windows verification engineering could not do.
3. Run `npm run demo:prepare`, then `npm run demo:serve`. Check the fingerprint line (§1). Open `http://127.0.0.1:3000/?perf` in Chrome, plugged in, with other apps closed.
4. Do field protocols part C, then §3 (model latency), §5 (tracking recovery), §6 (personal signs), then MAN-1 with §7 notes, then MAN-2.
5. Memory: Chrome Task Manager (`Shift+Esc`), the SignRelay tab's memory at 1 min and 10 min.

### Android (Chrome)

**4a. Laptop demo over USB.** Not yet tried by engineering.

1. Enable USB debugging on the phone and connect it.
2. On the laptop, open `chrome://inspect/#devices` and turn on **Port forwarding** with `3000` → `localhost:3000`.
3. On the phone, open `http://localhost:3000/?perf`.

If this does not work, record why and use 4b.

**4b. PR preview (HTTPS).** Open the preview URL from §1 with `?perf`.

Then:

1. Do field protocols part C (including C5 rotation), §3, §5 and §6, then MAN-1 with §7 notes, then MAN-2.
2. Remote DevTools for §5 and for memory: with the phone on USB, `chrome://inspect` on the laptop, then **inspect** the phone's tab. Memory: Performance monitor, JS heap at 1 and 10 min.
3. Record the phone model, Android version, Chrome version, battery % and charging state.

### iPhone (Safari)

1. Open the preview URL from §1 with `?perf`. Allow the camera.
2. Do field protocols part C (including rotation and lock/unlock), §3 and §6, then MAN-1 with §7 notes, then MAN-2.
3. §5 needs Safari Web Inspector from a **Mac** (Safari → Develop → *iPhone* → the page). Without a Mac, record "tracking recovery: not run (no Mac)". Do not substitute another method.
4. Memory is not measurable without a Mac; record "not measured".
5. Record the iPhone model, iOS version, battery % and Low Power Mode on/off.

## 5. Tracking-recovery test

This checks the PR #46 fix: when hand tracking fails, the hand overlay and partial recognition evidence must be cleared at once, and tracking must come back by itself, with no stale word added.

**Trigger** (desktop Chrome, Android via `chrome://inspect`, or iPhone via Mac Safari Web Inspector):

1. Open DevTools on the SignRelay tab and go to **Console**.
2. In the context drop-down at the top left of the console (it normally says `top`), choose **`vision.worker.js`**.
3. Paste this and press Enter:

   ```js
   self.postMessage({ type: "error", message: "Manual tracking interruption test" })
   ```

This sends the app the same message a failing tracker sends. Verified on the built export in headless Chromium: a replacement tracking worker started 0.19 s later, the camera stayed **Active**, analysis resumed, and there were no page errors.

*Optional second trigger:* `self.close()` in the same context simulates a tracker that stops responding. Recovery should start after the 8 s frame timeout (8.2 s in the same check).

**Procedure** (three rows in the log, using the note field):

| # | What to do | Expected | Record |
| --- | --- | --- | --- |
| R1 | Hand held still in view, overlay visible. Trigger. | Overlay disappears within about 1 s. Camera stays **Active**. The overlay returns by itself within a few seconds. `tracker` may change `GPU` → `CPU`. | Seconds until the overlay returned (stopwatch), tracker before/after, any message shown |
| R2 | Start signing THANK YOU; trigger **during the stroke**; finish the sign. | **No word is added** from that attempt within 4 s. | `w` with the word if any word appeared; otherwise `m` with note `recovery R2` |
| R3 | After recovery, sign HELLO normally. | Recognized as for any MAN-1 attempt | Normal MAN-1 outcome, note `after recovery` |

Any word added in R2 is a **wrong acceptance**: log it and report it to the owner the same day. If the camera stops, the page freezes, or the overlay stays visible for more than about 2 s after the trigger, log it as a `failure` with a description.

## 6. Personal-sign test

1. Open **Teach a sign** and type a word that is **not** one of the six demo signs (for example `COFFEE`). Choose it, then **Record example** three times: sign once per countdown, then lower the hands. The meter must reach "3 of 3 examples recorded".
2. Reload the page, start the camera and check the word is still listed with 3 examples.
3. Sign the taught word 6 times; log each attempt in `eval:log` as attempted `COFFEE`, with note `personal`. Copy the `?perf` line afterwards and record `personal` p50/p95.
4. Teach a second word with a **very similar** movement (for example the same sign at a different height), 3 examples. Sign each word 3 times. **Abstaining is the correct outcome for near-identical signs; a wrong word is a wrong acceptance.**
5. Remove one word (**Remove**), reload, and check it is gone and is never recognized again (3 attempts).
6. *(Laptop only, optional scale check)* With 100+ saved examples from earlier sessions, record `personal` p50/p95 while signing a saved word. Recognition should feel the same as with 3 examples.

## 7. Recording why a THANK YOU or YES was missed

PR #45 found that real-clip misses stop at identifiable stages, mostly because the hand is not tracked through the movement. The app already shows which stage stopped an attempt. For **every** `m` (no match) or `w` (wrong) outcome on THANK YOU and YES (and optionally the other words), watch the line under the transcript heading during the attempt. Put the **last** message you saw, as a code, in the `eval:log` note, with the `hand tracked` % from `?perf` at the end of the block:

| Last thing shown before the miss | Note code | Stage |
| --- | --- | --- |
| "Keep your signing hand in view. Tracking will resume automatically." | `stage=hand-lost` | Hand not tracked; no movement to analyse |
| "Following your movement…" and nothing after it | `stage=lost-moving` | Hand lost during the stroke; the movement never finished in view |
| "This movement resembles more than one sign. Pause and try again." | `stage=ambiguous` | Ambiguity veto: a safeguard working as designed |
| "Possible match · not confirmed" with a word, then nothing | `stage=one-proposal:<WORD>` | Only one observation; the two-evidence rule (a safeguard) |
| The chip says **No confident match** | `stage=declined` | Movement seen; no recognizer matched it |
| Not sure or not watched | `stage=unknown` | — |

Example note: `stage=lost-moving hand%=41`. This turns live misses into the same categories as PR #45's clip analysis without recording any video. Do not repeat the attempt "to get it right"; the next attempt is a new row.

Also note, per session: lighting (window behind the signer?), distance (about 1 m?), whether both elbows were in frame, and whether the signer's YES used a clear wrist nod. These are the likeliest causes of tracking loss, but nothing has confirmed them yet.

## 8. Documenting results

Per device, write one file: `evaluation/results/device-<YYYY-MM-DD>-<device-pseudonym>.md` (git-ignored). The MAN-1 and MAN-2 rows go to the `eval:log` JSONL file. Summarize them with `npm run eval:live -- evaluation/results/<file>.jsonl`.

```markdown
# Device session — <date> — <device pseudonym>

- Device / OS / browser + versions:
- Build: <commit> · worker fingerprint: <first 12 characters, or "preview, commit …">
- Power: plugged / battery % · Low Power Mode:
- Conditions: lighting, background, distance, signer pseudonym, dominant hand

| Check | Result |
| --- | --- |
| C1 cold start (s) / C2 warm start (s) | |
| Preflight frames analysed/s at 60 s (P1 ≥ 10) | |
| tracker at start / at end | |
| Model latency p50/p95 at start / at 10 min (§3), or "did not run" | |
| hand tracked % during MAN-1 | |
| Tracking recovery R1 (s to overlay back) / R2 word added? / R3 outcome | |
| Personal: 3 examples saved and reloaded? personal p50/p95 | |
| Interruptions C5 (each: reported? recovered with one press?) | |
| 10-minute run: fps, recoveries, throughput warnings | |
| Memory at 1 / 10 min (or "not measured") | |
| MAN-1 counts per word: correct / wrong / no match / failure | |
| MAN-2 words added (movement → word) | |
| Raw `?perf` lines (60 s, after §3, 10 min) | |
| Anything unexpected | |
```

Send the owner the device file and the `eval:live` summary, never raw video or landmarks. A device that fails P1 is not suitable for recognition demos, whatever else passes.
