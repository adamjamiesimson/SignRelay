// How long personal templates hold up the recognition thread, on real Node
// worker threads (the browser Worker protocol, not a browser or phone).
// Two moments are measured, each with 30 / 150 / 300 personal examples:
//   - session start: templates arrive, the camera starts ~0.5 s later, then
//     the first hand frames (the Sprint 3 P2 finding: the matcher was created
//     and sent every template lazily, on the first hand frame);
//   - frames at once: hand frames start straight after the templates (the
//     condition of the Sprint 3 measurement);
//   - mid-session update: templates are re-sent while hand frames stream, as
//     after saving a new example.
// Frames follow the app's one-in-flight protocol at 20 Hz. The recognition
// worker is bundled from the current source; the template-matching worker is
// public/workers (run `npm run build:worker` first so both match the source).
// Templates are posted the way the app's RecognitionSession posts them:
// `--transport packed` (one transferred buffer, the current app) or
// `--transport arrays` (structured-cloned arrays, before Sprint 4).
// `send_ms` is how long the posting thread spends in postMessage.
//
//   node scripts/benchmarks/first-frame-stall.mjs [--transport packed|arrays] [--repeat 5] [--out file.json]
import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { ThreadWorker } from "./worker-host.mjs";

const root = process.cwd();
const option = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const repeat = Number(option("--repeat", 5));
const out = option("--out", null);
const transport = option("--transport", "packed");
const temporary = await mkdtemp(path.join(tmpdir(), "signrelay-stall-"));
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const round = value => +value.toFixed(1);
try {
  const bundle = (entry, output) => build({ entryPoints: [entry], outfile: output, absWorkingDir: root, bundle: true, format: "esm",
    platform: "node", target: "node22", nodePaths: [path.join(root, "node_modules")], logLevel: "error" });
  const workerScript = path.join(temporary, "recognition-worker.mjs"), workload = path.join(temporary, "workload.mjs");
  await bundle("workers/recognition.worker.ts", workerScript);
  await bundle("scripts/benchmarks/matching-workload.ts", workload);
  const { makeSign, examples, packTemplates } = await import(pathToFileURL(workload).href);
  const sign = makeSign("HELLO", { duration: 3950, count: 80 });

  async function run(count, phase) {
    const worker = new ThreadWorker(workerScript, root); await worker.ready;
    const templates = examples(count);
    let id = 0, inFlight = null, latest = null, frameTime = 1000;
    const acks = [];
    worker.onmessage = ({ data }) => {
      if (data.type === "fault") throw new Error(data.message);
      if (data.type !== "analysis" || data.frameId !== inFlight?.id) return;
      acks.push({ at: performance.now(), ms: performance.now() - inFlight.sentAt, hand: inFlight.hand });
      inFlight = null; pump();
    };
    const pump = () => {
      if (inFlight || !latest) return;
      const frame = latest; latest = null; id++;
      inFlight = { id, sentAt: performance.now(), hand: frame.hands.length > 0 };
      worker.postMessage({ type: "frame", frame, frameId: id, session: 1 });
    };
    const stream = async (frames, onFrame) => {
      for (const [index, source] of frames.entries()) {
        frameTime += 50;
        latest = { ...source, timestamp: frameTime }; pump();
        onFrame?.(index);
        await delay(50);
      }
      const deadline = performance.now() + 5000;
      while ((inFlight || latest) && performance.now() < deadline) await delay(5);
    };
    const sends = [];
    const sendTemplates = () => {
      const started = performance.now();
      if (transport === "packed") {
        const packed = packTemplates(templates);
        worker.thread.postMessage({ type: "templates", language: "csl", templates: packed, session: 1 }, [packed.values.buffer]);
      } else worker.thread.postMessage({ type: "templates", language: "csl", templates, session: 1 });
      sends.push(performance.now() - started);
    };
    const configuredAt = performance.now();
    sendTemplates();
    let result;
    if (phase !== "mid-session-update") {
      if (phase === "session-start") await delay(500); // camera and tracker starting
      await stream(sign);
      const firstHand = acks.find(ack => ack.hand);
      result = { first_hand_frame_ack_ms: round(firstHand.ms), max_ack_ms: round(Math.max(...acks.map(ack => ack.ms))),
        acknowledged: acks.length, offered: sign.length, since_templates_ms: round(firstHand.at - configuredAt) };
    } else {
      await delay(500);
      await stream(sign.slice(0, 20));
      const before = acks.length;
      let updatedAt = 0;
      await stream(sign.slice(20, 60), index => {
        if (index === 5) { updatedAt = performance.now(); sendTemplates(); }
      });
      const after = acks.slice(before).filter(ack => ack.at >= updatedAt);
      result = { max_ack_after_update_ms: round(Math.max(...after.map(ack => ack.ms))), acknowledged_after_update: after.length };
    }
    worker.terminate();
    await delay(100);
    return { ...result, send_ms: round(sends.at(-1)) };
  }

  const results = [];
  for (const phase of ["session-start", "frames-at-once", "mid-session-update"]) for (const count of [30, 150, 300]) {
    const runs = [];
    for (let i = 0; i < repeat; i++) runs.push(await run(count, phase));
    const summary = Object.fromEntries(Object.keys(runs[0]).map(key => [key, median(runs.map(r => r[key]))]));
    results.push({ phase, examples: count, runs: repeat, median: summary, all: runs });
    console.log(JSON.stringify({ phase, examples: count, median: summary }));
  }
  const report = { schema: 1, benchmark: "first-frame-stall",
    environment: `Node ${process.version}, ${cpus()[0]?.model ?? "unknown CPU"} x${cpus().length}, real worker threads; not a browser, camera or phone measurement`,
    protocol: "one frame in flight at 20 Hz; synthetic HELLO frames; csl personal examples from matching-workload.ts", transport, results };
  if (out) await writeFile(out, JSON.stringify(report, null, 2) + "\n");
} finally { await rm(temporary, { recursive: true, force: true }); }
