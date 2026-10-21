# Sprint 2 ledger — GITEX coding hardening (started 21 October 2026)

Branch `sprint/gitex-coding-hardening-2026-10-21`, created from Sprint 1 head `d9fcc3b` (PR #36). No newer Sprint 2 work existed on any remote branch at the start.

Baseline (`docs/gitex/sprint-2/baseline-d9fcc3b.{json,md}`) was taken from a clean worktree of `d9fcc3b` with its own `npm ci`. Results: typecheck, lint, 678/678 unit tests (69 files), worker build, repo guard, secret scan, `audit:deps`, production audit, workspace and offline-vision browser smokes and rendered-export checks all pass. The strict `audit:security` fails (5 dev-only `braces` advisories). The full `build:firebase` cannot run in this sandbox because the RSL model host is denied by network policy; the baseline export was built with every other `build:firebase` step. CI on `d9fcc3b` was Core ✅, pilot ✅, capture ✅, Firebase ❌ (strict audit only).

Statuses: **DONE**: the acceptance criteria are met and the evidence is recorded. **PARTIAL**: part of the criteria is met, with the gap stated. **BLOCKED**: needs people, devices or authorization. **TODO**: not started.

| # | Objective | Status | Evidence / gap |
| --- | --- | --- | --- |
| 1 | Verified Sprint 2 baseline | DONE | `scripts/readiness.mjs` (4 tests); baseline JSON/MD above |
| 2 | Build vs strict-audit separation | DONE | `firebase-build-check.yml`: the build job runs secrets, rendered-export and fail-closed `audit:deps`; a separate `strict-dependency-audit` job (needs build, no `continue-on-error`) runs the unchanged `audit:security`. Tests in `ci-triggers.test.ts` and `audit-dependencies.test.ts` (an exception cannot be widened to production, emptied, given a bad expiry or reused for another advisory). The strict gate still fails and blocks release. |
| 3 | ASL-only GITEX build profile | DONE | `npm run build:asl-demo` (`scripts/build-profile.mjs`, `lib/build-profile.ts`, `scripts/prune-profile.mjs`). Other languages are visible but disabled and labelled. Their weights, labels, templates and clip workers are pruned; their attribution and licence notices are kept. Private-route exclusion and secure-export run unchanged. Local build: verify-runtime ok, rendered-export 2/2, offline smoke passed (BSL disabled, worker `ccce84c8`). The full export (every step except the network-blocked RSL download) still passes workspace, offline and rendered checks. 5 tests in `tests/build-profile.test.ts`. |
| 4 | Asset/runtime verifier | DONE | `npm run verify:runtime` (`scripts/verify-runtime.mjs`) checks MediaPipe WASM against the locked package, pinned vision models by size and SHA-256, ASL-2000 files against `sha256.txt` (never verified before), ORT files and the worker against the committed bundle. It writes `out/runtime-manifest.json` and links the worker to `docs/evaluation/evaluated-runtimes.json`. It runs at the end of `build:firebase` and `build:asl-demo`. 9 tests (tampered, missing, stale, uncommitted, no evidence, profile leakage). |
| 5 | One-command offline demo | DONE | Added `npm run demo:prepare`, `demo:serve` and `demo:check` (`scripts/demo.mjs`, runbook `docs/gitex/offline-demo.md`). `demo:serve` refuses a missing, full-profile or unverified export and binds loopback only. `tests/offline-demo-strict-smoke.mjs` routes all traffic through a deny-all proxy and auto-attaches workers. Result: 0 non-loopback requests across 85 page and worker requests; the only refused hosts were Chrome's own idle sign-in hosts. `--self-test` caught a planted page leak and a planted worker leak. 4 tests in `tests/demo-command.test.ts`. Analytics is forced off in the asl-demo profile. |
| 6 | Evaluation provenance | TODO | |
| 7 | Adversarial non-sign tests | TODO | |
| 8 | HELLO investigation | TODO | |
| 9 | THANK YOU vs PLEASE | TODO | |
| 10 | YES and sparse tracking | TODO | |
| 11 | SORRY circular motion | TODO | |
| 12 | Cross-sign confusion | TODO | |
| 13 | Temporal segmentation stress | TODO | |
| 14 | Paired regression gates | TODO | |
| 15 | Long-running stress | TODO | |
| 16 | Verified bottleneck optimization | TODO | |
| 17 | Performance instrumentation | TODO | |
| 18 | Lifecycle stress suite | TODO | |
| 19 | Fault injection / recovery | TODO | |
| 20 | Intake hardening | TODO | |
| 21 | Review tooling hardening | TODO | |
| 22 | Evaluation/triage report generator | TODO | |
| 23 | Transcript & accessibility hardening | TODO | |
| 24 | Automated GITEX rehearsal | TODO | |
| 25 | Readiness package | TODO | |
