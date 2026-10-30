// Test-only module worker for tests/cooperative-yield-browser-smoke.mjs.
// Real ASL-2000 weights on a kinematic fixture: scheduling, cancellation and
// output stability in a browser worker, never sign accuracy.
import { recognizeAsl1000 } from "../lib/asl1000-runtime";
import { recognizePsl776 } from "../lib/psl776-runtime";
import { prepareCalibrationSequence, recognizePersonalTemplateAsync } from "../lib/personalized-recognition";
import { makeSign } from "./fixtures/asl-motion";

let pings = 0;
let cancel: (() => void) | null = null;
const ask = (type: string) => self.postMessage({ type });

self.onmessage = async ({ data }: MessageEvent<{ type: string }>) => {
  if (data.type === "ping") { pings++; return; }
  if (data.type === "cancel") { cancel?.(); return; }
  if (data.type !== "run") return;
  try {
    const frames = makeSign("NO");
    const warm = await recognizeAsl1000(frames);
    const same = (value: unknown) => JSON.stringify(value) === JSON.stringify(warm);

    // 1. Messages from the page and this worker's own timers keep running
    // between slices of one warm inference.
    let ticks = 0;
    const interval = setInterval(() => ticks++, 0);
    ask("ping-start");
    await new Promise(resolve => setTimeout(resolve, 20));
    pings = 0; ticks = 0;
    let started = performance.now();
    const during = await recognizeAsl1000(frames, { onPhase: phase => { if (phase === "inference") started = performance.now(); } });
    const inferenceMs = performance.now() - started;
    const handled = { pings, ticks };
    clearInterval(interval);
    ask("ping-stop");
    if (!same(during)) throw new Error("Output changed while other tasks ran");
    if (handled.pings < 2) throw new Error(`Page messages were not handled during inference (${handled.pings})`);
    if (handled.ticks < 2) throw new Error(`Worker timers were starved during inference (${handled.ticks})`);

    // 2. A cancel message from the page aborts a running inference.
    const viaMessage = new AbortController();
    cancel = () => viaMessage.abort();
    const byMessage = recognizeAsl1000(frames, { signal: viaMessage.signal,
      onPhase: phase => { if (phase === "inference") ask("cancel-me"); } })
      .then(() => "completed", error => error.name);
    if (await byMessage !== "AbortError") throw new Error("A page cancel message did not abort inference");

    // 3. A timer in this worker aborts a running inference.
    const viaTimer = new AbortController();
    const byTimer = recognizeAsl1000(frames, { signal: viaTimer.signal,
      onPhase: phase => { if (phase === "inference") setTimeout(() => viaTimer.abort(), 0); } })
      .then(() => "completed", error => error.name);
    if (await byTimer !== "AbortError") throw new Error("A worker timer did not abort inference");
    if (!same(await recognizeAsl1000(frames))) throw new Error("Cached weights changed after cancellation");

    // 4. The personal matcher yields through the same helper.
    const template = { id: "a", gloss: "NO", text: "no", createdAt: 1, frames: prepareCalibrationSequence(makeSign("NO")) };
    const scan = new AbortController();
    cancel = () => scan.abort();
    ask("cancel-me");
    const personal = await recognizePersonalTemplateAsync(frames, Array(300).fill(template), { signal: scan.signal, sliceMs: 0 })
      .then(() => "completed", error => error.name);
    if (personal !== "AbortError") throw new Error("A page cancel message did not abort personal matching");

    const samples: number[] = [];
    for (let run = 0; run < 5; run++) {
      let begin = performance.now();
      await recognizeAsl1000(frames, { onPhase: phase => { if (phase === "inference") begin = performance.now(); } });
      samples.push(performance.now() - begin);
    }
    samples.sort((a, b) => a - b);
    // Timing only: PSL's 775-reference scan yields through the same helper.
    const psl: number[] = [];
    for (let run = 0; run < 6; run++) {
      let begin = performance.now();
      await recognizePsl776(frames, { onPhase: phase => { if (phase === "matching") begin = performance.now(); } });
      if (run) psl.push(performance.now() - begin);
    }
    psl.sort((a, b) => a - b);
    self.postMessage({ type: "result", passed: true, handled, inferenceMs: Math.round(inferenceMs),
      warmMedianMs: Math.round(samples[2]), pslWarmMedianMs: Math.round(psl[2]), checks: ["page messages and worker timers ran during inference",
        "page cancel aborted ASL-2000", "worker timer aborted ASL-2000", "cached output unchanged after cancellation",
        "page cancel aborted personal matching"] });
  } catch (error) {
    self.postMessage({ type: "result", passed: false, error: error instanceof Error ? error.message : String(error) });
  }
};
