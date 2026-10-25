import { VisionEngine as Baseline } from "../../work/vision-engine.baseline.js";
import { LiveVision } from "../../lib/live-vision";
import { RecognitionSession } from "../../lib/recognition-session";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const summary = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: values.length, p50: sorted[Math.floor(sorted.length * 0.5)], p95: sorted[Math.floor(sorted.length * 0.95)] };
};
window.runBenchmark = async (mode) => {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  document.body.append(canvas);
  const ctx = canvas.getContext("2d");
  const overlay = document.createElement("canvas");
  overlay.width = 1280;
  overlay.height = 720;
  document.body.append(overlay);
  const draw = overlay.getContext("2d");
  const stages = Object.fromEntries(["capture", "hands", "auxiliary", "transport", "overlay", "age", "full", "rafGap", "classification", "communication"].map((x) => [x, []]));
  let baselineAuxiliary = 0;
  let recording = false, previous = performance.now(), running = true;
  const tick = (now) => {
    if (recording) stages.rafGap.push(now - previous);
    previous = now;
    if (running) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const engine = mode === "baseline" ? await Baseline.create() : await LiveVision.create(void 0, mode !== "worker-cpu");
  window.benchEngine = { mode: engine.mode, delegate: engine.delegate };
  if (mode === "baseline") {
    for (const [part, method, stage] of [["gesture", "recognizeForVideo", "hands"], ["face", "detectForVideo", "auxiliary"], ["pose", "detectForVideo", "auxiliary"]]) {
      const obj = engine.parts[part], fn = obj[method].bind(obj);
      obj[method] = (...args) => {
        const t = performance.now();
        const result = fn(...args);
        if (recording) {
          const elapsed = performance.now() - t;
          if (stage === "auxiliary") baselineAuxiliary += elapsed;
          else stages[stage].push(elapsed);
        }
        return result;
      };
    }
  }
  const session = new RecognitionSession(() => new Worker("/workers/recognition.worker.js", { type: "module" }), (message) => {
    if (recording && message.type === "analysis") {
      stages.classification.push(message.processingMs ?? 0);
      stages.communication.push(Math.max(0, (session.lastRoundTripMs ?? 0) - (message.processingMs ?? 0)));
    }
  }, () => {
  }, true);
  const totalStart = performance.now();
  for (let i = 0; i < 25; i++) {
    recording = i >= 5;
    ctx.fillStyle = "#20242c";
    ctx.fillRect(0, 0, 1280, 720);
    ctx.fillStyle = "#f0c8a0";
    ctx.fillRect(i * 25 % 1e3, 200, 100, 160);
    baselineAuxiliary = 0;
    const t = performance.now();
    const show = (frame2) => {
      const start = performance.now();
      draw.clearRect(0, 0, 1280, 720);
      for (const hand of frame2.hands) for (const p of hand.landmarks) {
        draw.beginPath();
        draw.arc(p.x * 1280, p.y * 720, 3, 0, 7);
        draw.fill();
      }
      if (recording) {
        stages.overlay.push(performance.now() - start);
        stages.age.push(performance.now() - t);
      }
    };
    const frame = mode === "baseline" ? engine.process(canvas, t) : await engine.process(canvas, t, show);
    if (mode === "baseline") show(frame);
    if (recording) {
      stages.full.push(performance.now() - t);
      if (mode === "baseline") stages.auxiliary.push(baselineAuxiliary);
      if (engine instanceof LiveVision) for (const key of ["capture", "hands", "auxiliary", "transport"]) stages[key].push(engine.timings[key]);
    }
    if (frame) session.postMessage({ type: "frame", frame });
    await sleep(mode === "baseline" ? 50 : 33);
  }
  const info = { mode, source: engine.assetSource, delegate: engine.delegate ?? "CPU", tracker: engine.mode ?? "main", lastError: engine.lastError, seconds: (performance.now() - totalStart) / 1e3 };
  running = false;
  session.terminate();
  engine.close();
  return { ...info, stages: Object.fromEntries(Object.entries(stages).map(([k, v]) => [k, summary(v)])), note: "Real inference on a generated no-hand canvas, not webcam/sign accuracy or sensor-to-photon latency." };
};

// Phase timings use the existing kinematic regression fixture. They measure
// computation, never sign accuracy. Loading is excluded by phase callbacks.
import { recognizeAsl1000 } from '../../lib/asl1000-runtime';
import { recognizePersonalTemplateAsync, prepareCalibrationSequence } from '../../lib/personalized-recognition';
import { recognizePsl776 } from '../../lib/psl776-runtime';
import { makeSign } from '../../tests/fixtures/asl-motion';
window.runRecognitionBenchmark = async () => {
  const frames = makeSign('SORRY');
  const templates = ['SORRY', 'THANK YOU'].flatMap(gloss => Array.from({ length: 3 }, (_, i) => ({
    id: `${gloss}-${i}`, gloss, text: gloss, createdAt: i, normalization: 'trajectory-v3',
    frames: prepareCalibrationSequence(makeSign(gloss), 'trajectory-v3'),
  })));
  const results = {};
  for (const [name, run] of [
    ['asl2000', opts => recognizeAsl1000(frames, opts)],
    ['personal6', opts => recognizePersonalTemplateAsync(frames, templates, opts)],
    ['psl775', opts => recognizePsl776(frames, opts)],
  ]) {
    const times = [];
    for (let i = 0; i < 6; i++) {
      let started = performance.now();
      await run({ onPhase: phase => { if (phase === 'inference' || phase === 'matching') started = performance.now(); } });
      if (i) times.push(performance.now() - started);
    }
    results[name] = summary(times);
  }
  return { stages: results, note: 'Five warm phase samples in an isolated browser page; includes cooperative yielding, excludes download. Kinematic fixtures and real model/reference assets, not sign-accuracy evidence or production worker end-to-end timing.' };
};
