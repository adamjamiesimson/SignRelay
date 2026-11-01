// Synthetic controller cost only. No model, webcam, signing or overlay measurement.
import { performance } from "node:perf_hooks";
import { LetterConfirmation, ASL_ALPHABET } from "../../lib/fingerspelling";
const c = new LetterConfirmation({ minScore: .9, dwellMs: 400, minSamples: 3, maxGapMs: 250, maxAgeMs: 200 }, ASL_ALPHABET);
const count = 100000;
const samples: number[] = [];
let committed = 0;
for (let i = 0; i < count; i++) {
  const start = performance.now();
  const time = i * 200;
  c.observe({ letter: "L", time, score: .95, hand: "Right", motionComplete: false });
  if (c.commit(time)) committed++;
  samples.push(performance.now() - start);
}
samples.sort((a,b) => a-b);
console.log(JSON.stringify({ kind: "synthetic controller microbenchmark, NOT recognition or webcam performance",
  node: process.version, platform: process.platform, samples: count, committed,
  medianMs: samples[Math.floor(count*.5)], p95Ms: samples[Math.floor(count*.95)],
  classificationMs: null, captureToOverlayMs: null, realLetterConfirmationMs: null }));
