# Proposed security-audit treatment — 12 October 2026

**Status: draft proposal for human security review, not approval for deployment.**

## What the build evidence shows

The isolated Next.js 16.4.0 dependency refresh on PR #18 reduced the 10 October baseline from 9 npm findings (8 high and 1 critical) to 5 high, with **no critical findings**. GitHub Actions run [38119177221](https://github.com/adamjamiesimson/SignRelay/actions/runs/38119177221) passed the static export, 229 unit tests, lint, the Bangla and Spanish browser flows, and then failed at `npm run audit:security`. The five reported package names are:

```text
eslint-config-next
  @next/eslint-plugin-next
    fast-glob
      micromatch
        braces
```

The upstream [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) (CVE-2026-93687) concerns stack exhaustion on deeply nested brace patterns. As checked on 12 October 2026, the GitHub advisory lists `braces <=3.0.3` as affected and **no patched version**. Upstream discussion: [micromatch/braces#84](https://github.com/micromatch/braces/issues/84). Do **not** run `npm audit fix --force`: it proposes downgrading `eslint-config-next` to incompatible version 14.2.35.

## Proposed scope of exception

An exception is justifiable **only if** all of these are true:

1. The full `npm audit --json --audit-level=moderate` report contains precisely the five packages and exact single-advisory dependency chain above, with no additional findings.
2. **Every reported affected node** has `dev: true` in the committed lockfile. If any node appears in the production dependency tree, the exception immediately fails.
3. A second independent `npm audit --omit=dev --json --audit-level=moderate` reports **zero vulnerabilities** and exits successfully.
4. Repository-controlled ESLint patterns are the only known input to this development-only tooling. If external/user-supplied glob patterns ever reach this chain, re-open the review.
5. The full audit runs every CI execution. The exception is printed prominently, not omitted from `npm audit` and not concealed as “zero vulnerabilities.”
6. Any changed advisory, affected path, severity, package or new finding causes CI to fail. If upstream publishes a fixed release, upgrade promptly and remove the exception.

`scripts/audit-dependencies.mjs` and `tests/audit-dependencies.test.mjs` implement the first, second, third, fifth and sixth conditions, with conservative fail-closed behavior. The script first checks production dependencies and then checks the complete report. It is not a generic allowlist file. Existing history/secret and rendered-page audits run afterward.

**Limitations:** A dev-only advisory is not automatically harmless; CI can process untrusted contributions. This does not establish exploitability or non-exploitability of `braces`, and it does not resolve the upstream vulnerability. Maintain the advisory on the security backlog, restrict untrusted CI inputs, and reassess at the next release or when upstream changes.

## Acceptance checklist (requires human review)

- [ ] Verify `npm ci`, `npm run typecheck`, `npm test`, `npm run lint`, and `npm run build:firebase` on the exact proposed branch.
- [ ] Inspect the raw `npm audit --json` findings and `npm audit --omit=dev --json` output.
- [ ] Confirm no `braces` or affected transitive package is included in the exported `out/` assets or runtime imports.
- [ ] Review whether any untrusted input can supply glob patterns to ESLint or CI tooling.
- [ ] Review and explicitly accept (or reject) this limited dev-only exception before merging.
- [ ] Keep the recognition experiment PR #17 separate; its real-world accuracy evidence gate remains open.
- [ ] No Firebase production deployment until the security gate and validation are approved.

## Safe rollback

Keep PR #18 as the untouched dependency-only refresh. Close this proposed policy PR if the risk treatment is rejected. Do not silently skip `npm audit`, exclude all dev dependencies from the full audit, or downgrade Next ESLint with `--force`.
