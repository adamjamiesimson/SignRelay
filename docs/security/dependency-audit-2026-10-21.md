# Dependency audit — 21 October 2026

Commands run from a clean `npm ci` on the mega-sprint branch (Node 22.22, npm lockfile v3).

| Audit | Before | After |
| --- | --- | --- |
| `npm audit` (full, dev + prod) | 6 high | 5 high |
| `npm audit --omit=dev` (production) | 0 | 0 |

## Fixed

- **vite 8.3.0 → 8.3.4** (transitive via `vitest@4.1.11`, inside its existing semver range; lockfile-only change). Clears GHSA-698v-4r3x-3vcv, GHSA-r825-w8mm-5pxw and GHSA-587h-7wmj-h5pm (`launch-editor` command handling, dev server only). The full unit suite, typecheck and lint pass on the updated lockfile.

## Remaining (not fixable without breaking changes)

GHSA-vfj7-8cjw-p6xm — `braces <=3.0.3` stack-exhaustion DoS. 3.0.3 is the newest published release, so no patched version exists. The five reported packages are one chain:

`eslint-config-next@16.4.2 → @next/eslint-plugin-next@16.4.2 → fast-glob@3.3.1 → micromatch@4.0.8 → braces@3.0.3`

- Exploit relevance: low. Linting expands glob patterns from this repository's own ESLint configuration, not untrusted input. Nothing in the chain is a production dependency or ships in `out/`.
- `npm audit fix --force` would downgrade `eslint-config-next` to 14.2.35, which is incompatible with Next 16.4.2 and was not applied.
- An `overrides` entry cannot help because no fixed `braces` version exists.

## Gates

- `npm run audit:deps` (new, run in Core CI): fails on any production advisory and on any development advisory without an exact, unexpired review in [`dependency-exceptions.json`](dependency-exceptions.json). The braces review expires on **2026-11-30**.
- `npm run audit:security` is **unchanged** and still exits non-zero on these five findings. It is the strict release gate in `SECURITY.md`. Accepting or removing the residual chain is an owner decision; this sprint does not bypass it.
