# Model download and recovery follow-up

This branch builds on #23. It does not alter model weights, thresholds or the production deployment.

BSL, ISL and LSE now download labels and complete ONNX bytes with an AbortController before asking ORT to compile. A progressing download has a 300-second total limit and a separate 45-second idle limit. Empty/truncated/oversized streams fail; incomplete models never enter the cache. Model compilation has its own 90-second deadline, and a session created after cancellation is released. Successful sessions remain cached even when recognition abstains.

The recognition worker tracks loading and inference phases separately. Its fallback load deadline is 400 seconds; the inference watchdog starts afresh after the runtime reports inference, including a model that returns null. Reset and language switching abort the previous session's download. Old completions and failures cannot update a new session or delete its pending request. A download failure backs off without restarting the camera worker. The existing capped recovery mechanism remains available for a genuinely hung inference.

PSL uses the same abortable download helper, validates all 775 unique reference contracts once, and keeps its successful bundle cached in its dedicated matching worker. Loading and scan watchdogs are separate there too. Personal matching errors now produce explicit retry feedback while frame acknowledgements continue.

Verification: 262 tests pass; typecheck, lint and worker bundles pass locally. Added tests exercise a progressing stream lasting 120 seconds, idle/disconnected/truncated streams, camera/language cancellation, late runtime cleanup, compilation timeout, null predictions followed by a hung inference, and independent matcher loading/compute deadlines. Existing WASM tests execute the actual installed BSL, ISL and Spanish models. These automated checks do not establish physical-camera recognition accuracy or phone memory behavior. Verify on a throttled mobile connection before release.
