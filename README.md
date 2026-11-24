# SignRelay GameShow

**Spin. Sign. Score.** A standalone webcam game for the SignRelay university exhibition on 26 November 2026. Five unique rounds per participant, 20 seconds per round, and 10 points per correct sign. Participant records live in the booth browser profile. Camera frames stay in memory.

## Run the prepared offline release

Extract the release ZIP. Install Node.js 22 or newer beforehand, then open a terminal in the extracted folder.

```sh
node scripts/serve.mjs 8787
```

Open [http://127.0.0.1:8787](http://127.0.0.1:8787) in desktop Chrome. Keep using this exact address, port and profile. The release contains all assets and needs neither npm nor an internet connection. See [Booth operations](docs/BOOTH.md) for camera, cache, backup and recovery steps.

## Build from source

Requires Node.js 22+, pnpm 11.25.0 and Chrome or Chromium for browser tests. Provisioning requires network access once. The four large model files are fetched from pinned public URLs and verified. The teaching clips and logo are included in this release.

```sh
pnpm install --frozen-lockfile
pnpm assets
pnpm build
pnpm test
pnpm test:browser
node scripts/fullscreen-test.mjs
node scripts/camera-lifecycle-test.mjs
pnpm start
```

Set the environment variable **GAMESHOW_CHROME** to the full browser executable path when Chrome is installed elsewhere. Run **pnpm test:browser** after building. Test artifacts are written to **test-output/**. The app needs a secure context for camera and service workers. Use HTTPS for a remote host and the exact loopback address for the booth.

- [Recognition architecture, sign selection and evaluation](docs/RECOGNITION.md)
- [Final exhibition benchmarks, stress results and publication checks](docs/READINESS.md)
- [Release and offline verification](docs/VERIFICATION.md)
- [Booth operations and physical checks](docs/BOOTH.md)
- [Asset credits and licences](docs/ASSETS.md)
- [Firebase release](docs/DEPLOY.md)

