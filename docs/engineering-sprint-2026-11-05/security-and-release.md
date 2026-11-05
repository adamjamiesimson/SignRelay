# Security and release isolation

Baseline is PR #56 at `900dca8e14ef0daa985c40729304628bde97024c`. The functional Core CI steps passed through the secret scan, then the dependency gate failed. Firebase built and verified the full export and passed its browser checks before failing its combined security step. Core CI reported one root advisory across 16 moderate package entries and zero production findings. [Core CI](https://github.com/adamjamiesimson/SignRelay/actions/runs/41790119046) · [Firebase build check](https://github.com/adamjamiesimson/SignRelay/actions/runs/41790119066)

## Change register

| Finding | Root cause and impact | Correction | Verification |
| --- | --- | --- | --- |
| P1 · Research and private assets could reach a hosted export | Vercel previews enabled fingerspelling by default. The build bypassed export preflight and had no final artifact gate. A production build with an acknowledgement could ship fingerspelling, or opt into private routes. | `vercel.json` runs hosted preflight, pruning, runtime verification, and the public artifact gate. `lib/release-flags.mjs` and `scripts/prepare-export.mjs` require the public profile for hosted builds, even without Vercel system variables. Hosted previews use the same policy as production. Local rehearsal, local private capture and deliberate research exports still work. | `tests/release-flags.test.ts`, `tests/starter-output-policy.test.ts`, and the hosted rows in `scripts/release-artifact-matrix.mjs`. The sprint branch is excluded from automatic Vercel Git deployments. [Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration#gitdeploymentenabled) |
| P1 · A stale or unverified export could pass the Firebase deployment script | The artifact gate trusted selected manifest flags and ignored standalone private RSC payloads, old research weights and workers, and the compiled rehearsal hook. The verifier also wrote a manifest after failed verification. A direct Firebase CLI deployment bypassed the wrapper. | `scripts/assert-public-export.mjs` inspects those files and the compiled hook, and checks the recognition bundle SHA-256 and current Git commit against the manifest. `scripts/verify-runtime.mjs` clears old manifests and writes one only on success. The guard and build steps share the route and asset inventories. `firebase.json` calls the same guard before direct Hosting deployments. | Regressions for stale `study.txt`, weights, workers, compiled rehearsal hook, changed recognition bundle, failed verification, and an export verified against a different commit. [Firebase CLI hooks](https://firebase.google.com/docs/cli#predeploy_and_postdeploy_hooks) |
| P1 · A registry failure could produce a clean dependency gate | npm can exit nonzero with JSON containing an `error` object. `scripts/audit-dependencies.mjs` parsed that object and treated its missing vulnerabilities as zero findings. | Require a complete v2 report and consistent totals for each scope. The production policy and strict release audit retain their original thresholds and exception policy. | Unit regressions feed registry errors, missing reports, and inconsistent totals into both scopes. [npm audit report format](https://github.com/npm/cli/blob/latest/workspaces/arborist/lib/audit-report.js) |

## Dependency evidence

`npm ls minimatch --package-lock-only --all` traced the affected dependency through `eslint-config-next@16.4.2 → typescript-eslint@8.69.0 → @typescript-eslint/typescript-estree@8.69.0 → minimatch@10.2.6`. The root `minimatch@3.1.5` used by ESLint 9 and other lint plugins falls outside the reviewed range `>=7.0.0 <11.0.1`. `npm ls minimatch --package-lock-only --all --omit=dev` was empty. SignRelay's exposure is lint tooling. The advisory describes resource amplification when untrusted patterns reach the optimized matcher. [GitHub advisory GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)

The latest verified upstream release, typescript-eslint 8.72.1, still declares `minimatch: ^10.2.2`. The scoped override resolves `11.0.3` under typescript-estree and retains `3.1.5` for the existing ESLint consumers. npm reported zero vulnerabilities when resolving the new lockfile. The patch adds one transitive development dependency, `@isaacs/nonrecursive-glob-match@1.0.3`. Both minimatch versions declare the same supported Node engines, which include the repository's Node 22.13 CI runtime. [Upstream package manifest](https://github.com/typescript-eslint/typescript-eslint/blob/v8.72.1/packages/typescript-estree/package.json) · [Upstream issue](https://github.com/typescript-eslint/typescript-eslint/issues/13125) · [Patched minimatch release](https://github.com/isaacs/minimatch/releases/tag/v11.0.3)

The installed typescript-estree package has one minimatch import. It calls the named matcher with `dot: true` while checking default-project allowlists. On Node 24.22.1, the baseline and patched installations passed the same five direct glob cases and three actual TypeScript parser cases. The parser returned a typed program for an included source file and an allowed default-project config file, and rejected an out-of-project file that did not match. The parser regression remains in `tests/audit-dependencies.test.ts`. A future compatible upstream release can replace the override after a clean install and audit.

| npm audit scope | Frozen alpha lockfile | Patched lockfile |
| --- | --- | --- |
| Full | Exit 1, eight moderate package entries from one advisory | Exit 0, zero findings |
| Production only | Exit 0, zero findings | Exit 0, zero findings |

Both lockfiles were audited against the npm registry on 5 November. The difference between the alpha's historical CI count and this rerun follows the advisory's corrected affected range. An isolated clean `npm ci` with npm 10.9.2 on Windows installed 404 packages and reported zero vulnerabilities. npm logged an optional WASI package cleanup warning and exited successfully.

## Verification commands

```sh
npm ci
npm ls minimatch --all
npm ls minimatch --all --omit=dev
npm audit --json
npm audit --omit=dev --json
npm run audit:deps
npm run audit:secrets
npm test -- tests/audit-dependencies.test.ts tests/release-flags.test.ts tests/starter-output-policy.test.ts
node scripts/release-artifact-matrix.mjs --out work/release-artifact-matrix.json
```

Six hostile hosted rows were exercised locally on Windows with Node 24.22.1. All stopped during preflight, before emitting any artifact. The rows covered explicit and acknowledged production fingerspelling, preview dotenv fingerspelling, private capture without Vercel system variables, and automatic starter words on production and acknowledged preview.

## Privacy and residuals

- Recognition uses browser camera permissions without microphone capture. The worker pathways send frames and results within the browser. Transcript text and taught signs remain in browser storage. The two private capture tools retain their own consent and export flows.
- MediaPipe models are pinned by size and SHA-256. The local asset install can download the model files from Google Cloud Storage, and the runtime can fall back to Google and jsDelivr when self-hosted assets are unavailable. RSL's external build-time model download also checks its pinned size and checksum. Opted-in analytics uses Google Tag Manager and Google Analytics. A device or browser speech voice can be an online service. [Vision pins](../../lib/vision-runtime.mjs) · [RSL installer](../../scripts/install-rsl-model.mjs) · [Analytics consent](../../lib/analytics-consent.ts)
- Firebase has static security headers and per-document CSP script hashes. The Vercel build remains independently configured and does not run Firebase's per-document policy step. Actual Vercel project overrides and response headers were outside the local artifact check. A direct `next build` is a compiler step. The supported public release commands add pruning and verification around it.
- The source commit comparison applies when Git metadata is available. Manifest checks still inspect the artifact files without Git, and hosted builds recreate `out/` before compiling. A source commit records the checked-out revision. It does not attest to the cleanliness of the source tree.
- The PopSign/emSign research acquisition still rejects the distrusted certificate. No alternative licensed source was validated in this workstream. [Certificate policy](../../scripts/asl2000-eval/complete-ca-chain.sh)
- The fixes change build and dependency tooling. Roll back through reviewed commits and rebuild an independently verified artifact. No data migration applies. Neither Firebase nor Vercel was deployed from this workstream.
