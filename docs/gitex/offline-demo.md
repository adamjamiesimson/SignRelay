# Offline ASL demo runbook

The GITEX demo runs from the ASL demo build (`asl-demo` profile). Only the ASL workspace is usable. Other languages are shown as disabled, and their models are not shipped.

## Prepare (needs network once)

```sh
npm ci
npm run demo:prepare      # build:asl-demo + runtime verification
npm run demo:check -- /path/to/chrome   # optional: strict no-outbound browser check
```

`demo:prepare` downloads the pinned MediaPipe models if they are missing. Analytics is never configured in this build.

It builds `out/` and writes `out/runtime-manifest.json`. The manifest records the recognition worker hash, whether it matches the committed bundle, and the recorded real-video development evidence for that worker.

## Run (no network needed)

```sh
npm run demo:serve        # serves out/ on http://127.0.0.1:3000 only
```

`demo:serve` refuses to start in three cases:
- `out/` is missing;
- `out/` holds the full multilingual build;
- the runtime in `out/` no longer verifies (any tampered, stale or missing model, WASM file or worker).

## What `demo:check` proves

`demo:check` runs the strict browser check. It walks this path:
1. Hydrate the welcome screen.
2. Start ASL with a synthetic fake camera.
3. Check the `?perf` readout says the assets are self-hosted.
4. Pause the camera and check every camera track is released.
5. Visit `/languages`, `/models` and `/privacy`.

During that walk it checks three things:
- **No request leaves the machine.** Chrome uses a local deny-all proxy.
- **Every request stays local.** All requests from the page and from every worker it starts must be loopback, `data:` or `blob:`. Workers are auto-attached over DevTools.
- **The proxy log has no SignRelay traffic.** It may contain only the hosts that idle headless Chrome contacts by itself on `about:blank`: `www.google.com` and `accounts.google.com`, both refused. Any other host fails the check.

`--self-test` checks the detector itself. It plants a fetch in the page and another in a worker, with CSP bypassed, and passes only when both are caught.

This proves offline operation of the software path. It says nothing about recognition accuracy. The physical-camera manual gates in `docs/gitex/demo-contract.json` remain pending, and release status is NO-GO.
