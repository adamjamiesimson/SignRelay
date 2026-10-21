# Dependency audit — 21 October 2026

Commands run from a clean `npm ci` on the mega-sprint branch (Node 22.22, npm lockfile v3).

| Audit | Before | After |
| --- | --- | --- |
| `npm audit` (full, dev + prod) | 6 high | 5 high |
| `npm audit --omit=dev` (production) | 0 | 0 |

## Fixed

- **vite 8.3.0 → 8.3.4** (transitive via `vitest@4.1.11`, inside its existing semver range; lockfile-only change). Clears GHSA-698v-4r3x-3vcv, GHSA-r825-w8mm-5pxw and GHSA-587h-7wmj-h5pm (`launch-editor` command handling, dev server only). The full unit suite, typecheck and lint pass on the updated lockfile.

## Resolved later on 21 October: the `braces` chain (GHSA-vfj7-8cjw-p6xm)

`braces <=3.0.3` has a stack-exhaustion DoS advisory and no patched release (3.0.3 is the newest version). It reached the tree through one development-only chain:

`eslint-config-next@16.4.2 → @next/eslint-plugin-next@16.4.2 → fast-glob@3.3.1 → micromatch@4.0.8 → braces@3.0.3`

Upstream offers no way out: the latest and canary `@next/eslint-plugin-next` still pin `fast-glob@3.3.1`, every `fast-glob` and `micromatch` release depends on `braces`, and `npm audit fix --force` would downgrade `eslint-config-next` to 14.2.35, which is incompatible with Next 16.

The plugin makes exactly one `fast-glob` call, in `dist/utils/get-root-dirs.js`: `globSync(rootDir, { onlyDirectories: true })`, reached only when an ESLint config sets `settings.next.rootDir`. So the chain is now removed, not excepted:

- [`tooling/fast-glob-shim`](../../tooling/fast-glob-shim/index.cjs) is a reviewed, 60-line in-repo package named `fast-glob@3.3.1`. It implements `globSync`/`sync` with Node's built-in `fs.globSync` and throws on any option it does not implement, rather than ignoring it.
- `package.json` lists it as the dev dependency `"fast-glob": "file:tooling/fast-glob-shim"`. The plugin's exact `3.3.1` requirement dedupes onto it through normal hoisting, so no `overrides` are needed. (npm's nested `file:` overrides write a broken relative symlink, so that route was rejected.)
- `fast-glob`, `micromatch`, `braces`, `@nodelib/*`, `fastq`, `glob-parent`, `merge2`, `run-parallel`, `queue-microtask` and `reusify` are no longer installed.
- `tests/fast-glob-shim.test.ts` checks that the plugin resolves the shim, that the lockfile contains no `braces`/`micromatch`, that the shim matches fast-glob's results for the plugin's call, and that `@next/next/no-html-link-for-pages` still reports with a configured `rootDir`.

If a future dependency asks for a `fast-glob` range the shim does not satisfy, npm installs the real package again, `braces` comes back, and both audits fail closed. The fix for that is to review the new caller, not to add an exception.

| Audit (clean `npm ci`) | Before | After |
| --- | --- | --- |
| `npm audit` (full) | 5 high | 0 |
| `npm audit --omit=dev` | 0 | 0 |

## Gates

- `npm run audit:deps` (Core CI) fails on any production advisory, and on any development advisory without an exact, unexpired review in [`dependency-exceptions.json`](dependency-exceptions.json). That file now holds **no** exceptions; the retired braces review is kept under `history`.
- `npm run audit:security`, the strict release gate in `SECURITY.md`, is **unchanged**: `npm audit --audit-level=moderate`, the secret scan, and the rendered-export checks.
