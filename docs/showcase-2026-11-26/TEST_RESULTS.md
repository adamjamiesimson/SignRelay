# Executed verification

All local checks used Node 24.22.3 on the cloud Linux host and Chromium 156.0.8078.79. The tested worker is `3510843cc821cbbdb9dc227d1f68dff8ded10dce77620bde0198bf4e7e2456c1`. Browser camera checks used browser-generated media. Model probes used controlled inputs and the installed checkpoints. Physical camera, device audio and signing accuracy need independent acceptance evidence.

| Check | Observed result |
| --- | --- |
| Production Firebase export | Passed Next compile, TypeScript, prerender, private-route exclusion, CSP generation and full runtime/model integrity verification |
| Rehearsal export | Passed with the synthetic rehearsal hook confined to its profile |
| Offline ASL export | Passed with verified local MediaPipe, ASL model, workers and WASM |
| Typecheck and ESLint | Passed |
| Rendered HTML checks | Passed |
| Full unit suite before final assertion correction | 917 passed, 1 failed, 1 skipped across 89 files. The failed assertion required no duplicate starter words in a pre-existing synthetic THANK YOU tail case |
| Corrected tail regression | 10 passed. Requires the research-model word to stay out of both transcripts and records the production starter tail limitation |
| Workspace Chromium smoke | Passed permission denial/recovery, late grant cleanup, language and transcript isolation, editing, speech queue, refresh persistence, concurrent IndexedDB limits and storage failures |
| Lifecycle stress | Passed 12 start/pause cycles, 6 rapid toggles, hidden calibration interruption, processing fault reset, ended track recovery, 3 workspace re-entry cycles and pagehide cleanup. Heap sample 26 to 6 MB after collection. Contended cloud throughput was 2.9 frames/s |
| Landmark model lifecycle | Real ASL, BSL, ISL and LSE runs passed cancellation, fresh/cached runs and output consistency |
| RSL and Bangla browser smokes | Real ONNX checkpoints loaded and ran. Fake-camera capture, duplicate activation, cancellation, navigation, mobile layout and no-upload checks passed |
| LSE browser smoke | Three actual ONNX inferences, mobile layout, camera release, navigation and no-upload checks passed |
| ASL packed model browser probe | Passed through a deny-all proxy. Eleven local model requests, 2,592 ms cold load, 3,523 ms cold inference and 2,354 ms warm inference under concurrent cloud load |
| Desktop/mobile screenshot parity | Four PNGs matched baseline bytes exactly for landing and camera-prompt workspace at 1280×900 and 390×844. Other dynamic states require physical review |
| Fault injection | Passed worker crashes and restart exhaustion/recovery, failed worker construction, missing/corrupt vision model cleanup and retry, and storage denial |
| Strict offline check | Passed 110 observed page/worker requests with zero external requests, camera stop/release and uncached restart. Cloud tracking throughput was 1.4 frames/s under concurrent load, below the demo target |
| Offline detector self-test | Passed detection of planted page and worker leaks, including a page request to a browser-internal host |
| Dependency audit | Baseline 11 findings, patched full and production audit zero. No exceptions |
| Secret scan and repository asset guard | Passed for fetched refs and working tree. A shallow clone limits historical coverage |
| Real recorded-sign replay | One completed abstention and ten seek/runtime errors across eleven clips. The run failed its completeness gate |

The strict offline test initially rejected Chromium's own HTTP component updater request. An independent about:blank run reproduced it. The check now recognizes only that updater path as browser traffic while retaining separate CDP page/worker checks and the leak self-test. The deny proxy refused the updater request. The first broad local test attempt also hit sandbox process restrictions. Network-enabled tool execution allowed the required local processes and loopback servers.

The aggregate evidence is under [evidence/](evidence/). Full suite and hosted CI outcomes are recorded in the final release status. [PR #66 checks](https://github.com/adamjamiesimson/SignRelay/pull/66/checks)
