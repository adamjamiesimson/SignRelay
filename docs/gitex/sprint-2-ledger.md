# Sprint 2 ledger — GITEX coding hardening (started 21 October 2026)

Branch `sprint/gitex-coding-hardening-2026-10-21`, created from Sprint 1 head `d9fcc3b` (PR #36). No newer Sprint 2 work existed on any remote branch at the start.

Baseline (`docs/gitex/sprint-2/baseline-d9fcc3b.{json,md}`) was taken from a clean worktree of `d9fcc3b` with its own `npm ci`. Results: typecheck, lint, 678/678 unit tests (69 files), worker build, repo guard, secret scan, `audit:deps`, production audit, workspace and offline-vision browser smokes and rendered-export checks all pass. The strict `audit:security` fails (5 dev-only `braces` advisories). The full `build:firebase` cannot run in this sandbox because the RSL model host is denied by network policy; the baseline export was built with every other `build:firebase` step. CI on `d9fcc3b` was Core ✅, pilot ✅, capture ✅, Firebase ❌ (strict audit only).

Statuses: **DONE**: the acceptance criteria are met and the evidence is recorded. **PARTIAL**: part of the criteria is met, with the gap stated. **BLOCKED**: needs people, devices or authorization. **TODO**: not started.

| # | Objective | Status | Evidence / gap |
| --- | --- | --- | --- |
| 1 | Verified Sprint 2 baseline | DONE | `scripts/readiness.mjs` (4 tests); baseline JSON/MD above |
| 2 | Build vs strict-audit separation | TODO | |
| 3 | ASL-only GITEX build profile | TODO | |
| 4 | Asset/runtime verifier | TODO | |
| 5 | One-command offline demo | TODO | |
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
