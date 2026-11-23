# Matching isolation follow-up to PR #21

Baseline: PR #21 at `84e239e9a9a9b1423831c7560af39f050f158f8b`. Original PR branches are unchanged. No model bytes, stored records, recognition cutoffs or ambiguity margins change.

## Architecture and cancellation

Personal and PSL scans each use a dedicated nested Web Worker. The recognition worker never awaits either scan before acknowledging a camera frame. Each lane has one active snapshot and one replaceable latest snapshot; intermediate snapshots are discarded before serialization. Results carry request and generation IDs, expire after 2.5 seconds of incoming frame time, and require independent results for confirmation. Losing hand tracking, resetting, confirming, or switching languages invalidates previous personal results. Reset cancels queued work and cooperatively aborts active scans at 6ms compute boundaries. A stuck matcher is terminated independently with exponential retry backoff; it cannot trigger a camera-worker restart.

Legacy 208-feature personal recordings remain readable. Templates are compiled/validated once per immutable frame array and cached with weak references. DTW retains Float64 precision, all five personal windows, the 0.5 acceptance cutoff and 0.06 competing-gloss veto. Feature-presence decisions run once per group rather than per coordinate. Partial best-so-far results are never published.

## Measurements on this container

Node 24.19.0, CPU only, local files. Run `node scripts/benchmarks/matching-isolation.mjs`. This harness bundles the exact baseline source from Git and runs both recognition workers on real Node worker threads, using the existing one-active/one-latest camera delivery protocol at 20Hz. Similar personal examples are grouped as three examples per word.

| Personal examples | PR #21 p95 frame acknowledgement | Follow-up p95 | Acknowledged / 80, baseline → follow-up |
| ---: | ---: | ---: | ---: |
| 150 | 491.16ms | 4.26ms | 24 → 80 |
| 300 | 266.06ms | 0.84ms | 51 → 80 |

Single runs; baseline coalescing can drop enough frames to break its continuous-tracking window, so the 300-example baseline does less matching work than the 150-example run. These figures measure responsiveness, not recognition throughput or signing accuracy. Cold worker/template serialization produced maxima of 53–68ms in the isolated version; warm camera acknowledgement remained responsive.

The existing independent full-DTW benchmark measured 300 closely similar examples at 631.88ms warm on PR #21 versus 187.26ms after the kernel/cache changes. That synthetic harness has one example per gloss; it is a different workload from the thread test.

| Actual installed 775 PSL references | PR #21 | Follow-up |
| --- | ---: | ---: |
| Cold local asset decode + scan | 639.48ms | 370.14ms |
| Warm scan, median of 5 | 287.65ms | 81.55ms |

Cold figures include local file reading, gzip decompression, JSON parsing and compilation; they do not simulate internet speeds. PSL's own lane can still stall during cold JSON parsing (111ms observed); it is isolated from camera-frame processing. The scan returned the same abstention for the benchmark input. The independent test compares every one of the 775 actual reference distances to the original full-matrix implementation, retaining all scores that can accept or veto a result.

## Verification and remaining manual work

250 tests pass, typecheck/lint and all four worker bundles pass at this checkpoint. Tests cover bounded queues, replacement, stale/duplicate/terminated results, session cancellation, isolated timeout/backoff, legacy recordings and ambiguous references. Synthetic inputs protect behavior; they do not establish a real false-positive rate. Mobile browser nested-worker startup, physical camera responsiveness, natural signing and held-out signer accuracy still require manual testing. No participant frames or recordings are persisted by this change.
