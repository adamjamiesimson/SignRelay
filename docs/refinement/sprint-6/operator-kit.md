# SignRelay demo operator kit (laptop)

For whoever runs SignRelay on a real laptop. No knowledge of the code is needed. SignRelay is a **research prototype**: it recognizes six isolated ASL signs (HELLO, THANK YOU, PLEASE, SORRY, YES, NO). It does not translate sentences, and no accuracy figure exists for it.

## 1. What you need

- A laptop with a webcam, power adapter, and macOS, Windows or Linux.
- **Google Chrome** (desktop). Other browsers have not been tested.
- **Node.js 22.13 or newer** (`node --version`) and Git.
- Internet **once**, for setup. After setup the demo runs with no network at all.
- A plain background and light from the front.

## 2. Setup (the day before, with internet)

```bash
git clone https://github.com/adamjamiesimson/SignRelay
cd SignRelay
git checkout <candidate commit given by the project owner>   # see readiness.md for the current candidate
npm ci                       # installs the exact locked dependencies
npm run demo:prepare         # builds the ASL demo and verifies every model file by checksum
```

`demo:prepare` must end with `Demo export prepared. Next: npm run demo:serve`. If it stops with an error, do not continue; send the last 20 lines of output to the project owner.

Optional, but recommended once on this laptop (it proves nothing leaves the machine):

```bash
npm run demo:check -- "<path to Chrome>"
```

| System | Chrome path |
| --- | --- |
| macOS | `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` |
| Windows | `C:\Program Files\Google\Chrome\Application\chrome.exe` |
| Linux | output of `command -v google-chrome` |

It must print `"passed": true` with `"non_loopback_requests": 0`; any failure names the address that was contacted. Keep the printed JSON.

## 3. Start the demo

```bash
npm run demo:serve
```

Expected first line: `SignRelay ASL demo build — http://127.0.0.1:3000/`, followed by the recognition worker's fingerprint, `(matches committed bundle: true)` and `Release status: NO-GO`. Leave this terminal open.

It **refuses to start**, with a reason, when:

| Message starts with | Meaning | Do this |
| --- | --- | --- |
| `no export in out/` or `runtime-manifest.json is missing` | not prepared | `npm run demo:prepare` |
| `out/ is the full build` / `the rehearsal build` | another build is in `out/` | `npm run demo:prepare` |
| `runtime verification failed` | a model or worker file changed or is damaged | `npm run demo:prepare`; if it repeats, report it |
| `Port 3000 on 127.0.0.1 is already in use` | another program (often `npm run dev` or an earlier `demo:serve`) holds the port; that address would show the wrong app | stop that program, or `npm run demo:serve -- --port 3001` and use port 3001 below |

Then, in Chrome, open **`http://127.0.0.1:3000/?perf`** (`?perf` adds a timing line; nothing is stored or sent).

## 4. Chrome settings

- Use `127.0.0.1` or `localhost` exactly. Chrome only allows the camera on these addresses or on `https://`. **Do not open the laptop's network address (for example `http://192.168.1.20:3000`) from another device:** the page will not work there at all.
- Camera permission: when Chrome asks, choose **Allow**. To change it later: the icon left of the address bar → **Site settings** → Camera.
- Close other apps that use the camera (video calls, camera apps).
- Keep the laptop plugged in and close other heavy tabs; recognition needs speed.
- Zoom and text size can be changed freely; the page reflows.

## 5. Camera permission check

1. Choose **American Sign Language**, then **Start signing**. On a browser profile that has not used SignRelay before, a four-step tour opens first and the camera stays off: choose **Skip tour** (or finish it), then **Start camera**. The tour is remembered, so later starts open the camera directly; **Clear local data** brings it back (Sprint 7).
2. Allow the camera. Within a few seconds the camera badge shows **Active** and the transcript chip shows **Ready** ("Show your hands to begin").
3. Open **Camera options**. It must say *"Hand tracking loaded from this site, so it does not depend on an external CDN."* If it says *public CDN fallback*, the demo is not running from the prepared build; go back to step 3.
4. With `?perf`, the line under Camera options shows `… frames analysed/s …`. After you have signed for about 60 seconds it must stay **at or above 10**. If a red message says *"Only N frames analysed per second…"*, close other apps and tabs and plug in the laptop. Below 10, YES and other words are lost; do not run the recognition trials until it is fixed.

## 6. What the screen should show

| Chip next to "Transcript" | Meaning |
| --- | --- |
| Camera off / Waiting for permission / Starting | not analysing yet |
| Camera blocked | permission denied: allow it in Site settings, then **Retry camera** |
| Camera unavailable | camera disconnected, busy or stalled: read the message, then **Retry camera** / **Start camera** |
| Ready | analysing; no hand in view (was "waiting for hands" before Sprint 7) |
| Watching movement | building evidence (was "watching" / "following movement") |
| Checking sign + "Possible match · not confirmed" | a candidate only; **not** a result |
| No confident match | it saw movement and declined to guess (this is correct behaviour for unknown movements) |
| Recognition unavailable + **Restart recognition** | the recogniser stopped twice within a minute; press Restart recognition |

Only words in the **transcript list** are results. Each needs two consistent observations; the same word cannot be added again within about 2.6 seconds. Every entry shows its source (rule match / model match) and a match score, which is **not** a probability of being right. Any entry can be edited (Edit, then Enter) or removed.

Rules for the signer: hands resting below the chest or out of frame between signs; do not touch the face, glasses or hair; do not wave; face, shoulders and hands in view.

## 7. Safe stop and restart

- **Pause camera** stops the camera and speech; the transcript stays. **Start camera** resumes.
- **Save & clear** stores the transcript in this browser's history and empties it.
- To stop completely: close the tab, then press `Ctrl+C` in the terminal.
- To restart: `npm run demo:serve` again and reload the page. No rebuild is needed.
- **Clear local data** (under *Privacy & model details*) removes transcripts, settings and taught signs from this browser.

## 8. Troubleshooting

| Symptom | Likely cause | Recovery |
| --- | --- | --- |
| Buttons do nothing, page looks static | opened from a network address over `http://` | use `http://127.0.0.1:3000/` on the laptop itself |
| "Camera permission was denied" | permission blocked | Site settings → Camera → Allow → **Retry camera** |
| "No camera was found" / "camera is busy" | unplugged, or used by another app | reconnect / close the other app → **Retry camera** |
| "The camera was disconnected…" / "stopped sending video" | webcam unplugged or driver stall | reconnect → **Start camera** |
| "The camera opened, but the tracking models could not load" | build incomplete | stop, `npm run demo:prepare`, restart |
| Throughput warning (fewer than 10 frames/s) | laptop too busy, on battery saver | plug in, close apps/tabs, reload |
| A wrong word appears | recogniser error | press **Remove**; record it in the trial log (it counts) |
| Nothing appears for a sign | abstention or missed sign | record it as *no match*; do not repeat until it works (see the trial protocol) |
| Switched to another tab and back | analysis pauses while hidden; evidence restarts | sign again |
| Speech says nothing | Auto speak off, volume, or no voices installed | turn on Auto speak; check system volume; **Speak** says so if speech is not supported |

## 9. Offline test (manual gate MAN-3)

1. Complete steps 2–5 with the network on, then close the tab.
2. Turn off Wi-Fi and unplug Ethernet. Check that a website (for example `https://example.com`) fails to load.
3. Keep `npm run demo:serve` running (or start it now). Open `http://127.0.0.1:3000/?perf`, start the camera and confirm *"loaded from this site"*.
4. Repeat the MAN-1 trial block once (see [field-test-protocols.md](field-test-protocols.md)) and log it with condition `offline`.
5. Reconnect the network only after the block is logged.

## 10. Phones

The demo server listens only on the laptop itself, and phones cannot use a camera on a plain `http://` network address. Two working options:

- **Android Chrome, by USB:** enable USB debugging on the phone, connect it, open `chrome://inspect/#devices` on the laptop, turn on **Port forwarding** with `3000` → `localhost:3000`, then open `http://localhost:3000/?perf` on the phone. The phone then reaches the laptop's demo as `localhost`, which Chrome allows. (Not yet tried by this sprint.)
- **iPhone / any phone:** needs an `https://` copy of the site. The pull request preview deployments are HTTPS, but they are the full multilingual build and are controlled by the project owner. Use one only with the owner's agreement, and record which URL and commit was tested.

What to measure on each device: [field-test-protocols.md](field-test-protocols.md), part C.
