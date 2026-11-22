# November 26 showcase release readiness

The showcase candidate targets operator-led testing of isolated ASL signs at Dubai International Academic City. The [recognition report](RECOGNITION_EVALUATION.md) and [test report](TEST_RESULTS.md) record the evidence for the candidate. Physical webcam behavior, fresh-sign performance, independently reviewed false acceptances, and offline voice availability must clear the [physical checklist](PHYSICAL_TEST_CHECKLIST.md) before public live signing.

The offline ASL export and full Firebase export serve different purposes. Use the [offline booth runbook](OFFLINE_DEMO.md) for the showcase. Keep the loopback server and verified static bundle available as a fallback. Keep the demo script within the signs that pass human acceptance. If the live rehearsal fails its gates, demonstrate the software as a research prototype and disclose the recorded evaluation scope.

## Deployment procedure after explicit approval

Build from the reviewed candidate SHA in a clean checkout. Run the full tests and dependency audit, then build and verify the full profile.

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build:firebase
npm run verify:runtime -- --out out --profile full
npm run audit:security
```

Check that `out/runtime-manifest.json` says `full` and that the private capture route is absent. Review the Firebase Hosting site and project with the production owner, retain the prior release for rollback, and use the repository's `scripts/deploy-firebase.sh --deploy-only` only after explicit production approval. Verify the live origin, camera permissions, worker and model initialization, and asset headers immediately after an approved deployment.

[Repository security policy](../../SECURITY.md) · [Firebase Hosting configuration](../../firebase.json)

## Current acceptance decision

**Engineering candidate available for supervised human acceptance testing. Public live-recognition approval is pending.** Full and offline exports passed, and the approved UI matched the four automated screenshots. Recognition reliability remains limited by local replay decode errors, sparse signed evidence, unmeasured real negatives, a synthetic starter-tail duplicate, and cloud frame rates below the target under concurrent load. Read the full [recognition evaluation](RECOGNITION_EVALUATION.md) before choosing the live vocabulary.

Review is in [draft PR #66](https://github.com/adamjamiesimson/SignRelay/pull/66) on [showcase/november-2026-readiness](https://github.com/adamjamiesimson/SignRelay/tree/showcase/november-2026-readiness). The repository's existing Vercel integration automatically created a preview when the PR was opened. Production Firebase and main remain at the starting revision.

The complete hosted candidate replay passed with 5 correct, 0 wrong, 6 abstentions and 0 errors across the eleven development recordings. All hosted checks passed on d6e6f83. This improves the engineering evidence while preserving the physical acceptance gates.
