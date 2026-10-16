// Test-only worker, bundled into out/ and removed after the browser check.
// Uses actual installed checkpoints on synthetic inputs: execution, not accuracy.
import { recognizeAsl1000 } from "../lib/asl1000-runtime";
import { recognizeBsl1064 } from "../lib/bsl1064-runtime";
import { recognizeIsl263 } from "../lib/isl263-runtime";
import { recognizeLse300 } from "../lib/lse300-runtime";
import { makeSign } from "./fixtures/asl-motion";

self.onmessage = async () => {
  try {
    const checks = [];
    for (const [language, recognize] of [
      ["asl", recognizeAsl1000], ["bsl", recognizeBsl1064], ["isl", recognizeIsl263], ["lse", recognizeLse300],
    ] as const) {
      const controller = new AbortController();
      let started!: () => void;
      const running = new Promise<void>(resolve => { started = resolve; });
      const first = recognize(makeSign("HELLO"), { signal: controller.signal,
        onPhase: phase => { if (phase === "inference") started(); },
      }).then(() => ({ cancelled: false }), error => ({ cancelled: error.name === "AbortError" }));
      await running;
      controller.abort();
      const next = recognize(makeSign("HELLO"));
      const [oldResult, prediction] = await Promise.all([first, next]);
      if (!oldResult.cancelled) throw new Error(`${language} accepted a cancelled result`);
      const repeated = await recognize(makeSign("HELLO"));
      if (JSON.stringify(prediction) !== JSON.stringify(repeated)) throw new Error(`${language} cached output changed`);
      checks.push({ language, cancelled_old_result: true, fresh_and_cached_runs_complete: true, matching_outputs: true });
    }
    self.postMessage({ passed: true, execution_only: true, checks });
  } catch (error) { self.postMessage({ passed: false, error: String(error) }); }
};
