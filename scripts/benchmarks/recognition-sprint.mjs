import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpus } from "node:os";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const baseline = process.argv[2] ?? "900dca8e14ef0daa985c40729304628bde97024c";
const output = path.resolve(process.argv[3] ?? "../recognition-worker-bench");
const baselineRoot = path.join(output, "baseline");
const artifactRoot = path.join(output, "artifacts");
const { build } = await import(pathToFileURL(path.join(root, "node_modules/esbuild/lib/main.js")).href);
const { ThreadWorker } = await import(pathToFileURL(path.join(root, "scripts/benchmarks/worker-host.mjs")).href);
const git = (...args) => execFileSync("git", args, { cwd: root });
const baselineFiles = git("ls-tree", "-r", "--name-only", baseline, "lib", "workers", "tsconfig.json", "public/models")
  .toString().trim().split("\n").filter(file => !file.startsWith("public/") || file.endsWith(".json"));
await mkdir(baselineRoot, { recursive: true });
const archive = path.join(output, "baseline.tar");
git("archive", "--format=tar", "--output", archive, baseline, ...baselineFiles);
execFileSync("tar", ["-xf", archive, "-C", baselineRoot]);
const bundle = (entry, outfile, cwd = root) => build({
  entryPoints: [entry], outfile, absWorkingDir: cwd, bundle: true, format: "esm", platform: "node",
  target: "node22", nodePaths: [path.join(root, "node_modules")], logLevel: "error",
});
const workerScript = {
  baseline: path.join(output, "baseline.mjs"),
  candidate: path.join(output, "candidate.mjs"),
};
const matchPath = path.join(artifactRoot, "public/workers/template-matching.worker.js");
assert.equal(git("show", `${baseline}:workers/template-matching.worker.ts`).toString(),
  (await readFile(path.join(root, "workers/template-matching.worker.ts"), "utf8")).replaceAll("\r\n", "\n"));
await bundle("workers/template-matching.worker.ts", matchPath);
await writeFile(path.join(artifactRoot, "public/package.json"), '{"type":"module"}\n');
await bundle("workers/recognition.worker.ts", workerScript.baseline, baselineRoot);
await bundle("workers/recognition.worker.ts", workerScript.candidate);
const workload = path.join(output, "workload.mjs");
await bundle("scripts/benchmarks/matching-workload.ts", workload);
const { makeSign, examples, packTemplates } = await import(pathToFileURL(workload).href);

const sizes = [0, 1, 6, 30, 150, 300, 1000];
const repetitions = 3;
const frames = makeSign("HELLO", { duration: 2350, count: 48 });
const quantile = (samples, fraction) => [...samples].sort((a, b) => a - b)[Math.ceil(fraction * samples.length) - 1];
const measurements = [];
const failures = [];
for (const size of sizes) {
  const templates = packTemplates(examples(size));
  for (let repetition = 0; repetition < repetitions; repetition++) {
    const order = repetition % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"];
    for (const version of order) {
      const started = performance.now();
      const worker = new ThreadWorker(workerScript[version], artifactRoot);
      await worker.ready;
      const startupMs = performance.now() - started;
      const times = [];
      let done;
      let sentAt;
      worker.onmessage = ({ data }) => {
        if (data.type !== "analysis") return;
        times.push(performance.now() - sentAt);
        done();
      };
      worker.postMessage({ type: "templates", language: "csl", templates, session: 1 });
      try {
        for (const [index, frame] of frames.entries()) {
          sentAt = performance.now();
          const received = new Promise(resolve => { done = resolve; });
          worker.postMessage({ type: "frame", frame, frameId: index, session: 1 });
          const timedOut = await Promise.race([received.then(() => false), delay(15000, true, { ref: false })]);
          if (timedOut) {
            failures.push({ size, version, repetition, frame: index, reason: "acknowledgement exceeded 15 seconds" });
            break;
          }
          await delay(12);
        }
      } finally { worker.terminate(); }
      if (times.length === frames.length) measurements.push({ size, version, repetition, startupMs, firstAckMs: times[0], warmAckMs: times.slice(1) });
    }
  }
  console.error(`Completed template workload ${size}`);
}

const rows = sizes.map(size => ({
  size,
  ...Object.fromEntries(["baseline", "candidate"].map(version => {
    const runs = measurements.filter(row => row.size === size && row.version === version);
    const times = runs.flatMap(row => row.warmAckMs);
    if (!times.length) return [version, { samples: 0 }];
    return [version, { samples: times.length, medianMs: quantile(times, .5), p95Ms: quantile(times, .95),
      p99Ms: quantile(times, .99), maxMs: Math.max(...times), startupMedianMs: quantile(runs.map(row => row.startupMs), .5),
      firstAckMedianMs: quantile(runs.map(row => row.firstAckMs), .5),
      runMediansMs: runs.map(row => quantile(row.warmAckMs, .5)) }];
  })),
}));
const pslBytes = await readFile(path.join(root, "public/models/psl776-hfad/templates.json.gz"));
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (url !== "/models/psl776-hfad/templates.json.gz") return originalFetch(url, options);
  options?.signal?.throwIfAborted();
  return new Response(pslBytes);
};
let psl;
try {
  const baselinePsl = path.join(output, "baseline-psl.mjs");
  const candidatePsl = path.join(output, "candidate-psl.mjs");
  await bundle("lib/psl776-runtime.ts", baselinePsl, baselineRoot);
  await bundle("lib/psl776-runtime.ts", candidatePsl);
  const runs = { baseline: await import(pathToFileURL(baselinePsl).href), candidate: await import(pathToFileURL(candidatePsl).href) };
  const durations = { baseline: [], candidate: [] };
  let decision;
  for (let index = 0; index < 21; index++) {
    const order = index % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"];
    for (const version of order) {
      const started = performance.now();
      const result = await runs[version].recognizePsl776(frames);
      durations[version].push(performance.now() - started);
      if (version === "baseline" && index === 0) decision = result;
      assert.deepEqual(result, decision);
    }
  }
  psl = {
    references: 775, assetBytes: pslBytes.byteLength, decision,
    ...Object.fromEntries(Object.entries(durations).map(([version, [coldMs, ...warm]]) =>
      [version, { coldMs, warmMedianMs: quantile(warm, .5), warmP95Ms: quantile(warm, .95), warmMaxMs: Math.max(...warm), warm } ])),
  };
} finally {
  globalThis.fetch = originalFetch;
}

const aslDirectory = path.join(root, "public/models/asl2000-tgcn");
const aslManifest = JSON.parse(await readFile(path.join(aslDirectory, "model.json"), "utf8"));
const aslAssets = new Map(await Promise.all(["model.json", "labels.json", ...aslManifest.binaryParts]
  .map(async name => [`/models/asl2000-tgcn/${name}`, await readFile(path.join(aslDirectory, name))])));
const baselineAsl = path.join(output, "baseline-asl.mjs");
const candidateAsl = path.join(output, "candidate-asl.mjs");
const tgcnInput = path.join(output, "tgcn-input.mjs");
await bundle("lib/asl1000-runtime.ts", baselineAsl, baselineRoot);
await bundle("lib/asl1000-runtime.ts", candidateAsl);
await bundle("lib/tgcn-input.ts", tgcnInput);
const aslRuntimes = { baseline: await import(pathToFileURL(baselineAsl).href), candidate: await import(pathToFileURL(candidateAsl).href) };
const { prepareTgcnWindows } = await import(pathToFileURL(tgcnInput).href);
const aslWindows = prepareTgcnWindows(frames, aslRuntimes.candidate.ASL2000_INPUT, aslManifest.sequenceLength);
assert.ok(aslWindows.some(window => aslRuntimes.candidate.hasHandEvidence(window, aslManifest.sequenceLength)),
  "ASL fixture must reach the real inference path");
const aslMeasurements = { baseline: [], candidate: [] };
let aslDecision;
globalThis.self = globalThis;
globalThis.fetch = async (url, options) => {
  if (!aslAssets.has(url)) return originalFetch(url, options);
  options?.signal?.throwIfAborted();
  return new Response(aslAssets.get(url));
};
try {
  for (let index = 0; index < 11; index++) {
    const order = index % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"];
    for (const version of order) {
      const started = performance.now();
      let inferenceStarted;
      const decision = await aslRuntimes[version].recognizeAsl1000(frames, {
        onPhase: phase => { if (phase === "inference") inferenceStarted = performance.now(); },
      });
      const finished = performance.now();
      assert.ok(inferenceStarted !== undefined);
      aslMeasurements[version].push({ loadMs: inferenceStarted - started, inferenceMs: finished - inferenceStarted });
      if (version === "baseline" && index === 0) aslDecision = decision;
      assert.deepEqual(decision, aslDecision);
    }
  }
} finally {
  globalThis.fetch = originalFetch;
  delete globalThis.self;
}
const asl = {
  classes: aslManifest.classes, windows: aslWindows.length, decision: aslDecision,
  ...Object.fromEntries(Object.entries(aslMeasurements).map(([version, [cold, ...warm]]) => {
    const times = warm.map(row => row.inferenceMs);
    return [version, { cold, samples: warm.length, warmInferenceMedianMs: quantile(times, .5),
      warmInferenceP95Ms: quantile(times, .95), warmInferenceMaxMs: Math.max(...times), warm }];
  })),
};
const report = { baseline, candidateHead: git("rev-parse", "HEAD").toString().trim(), candidateDiff: git("diff", "--stat").toString(),
  cpu: cpus()[0]?.model, node: process.version, platform: process.platform,
  workload: "Real Node worker threads, kinematic landmarks, frame message to acknowledgement. No camera, GPU, or signer data.",
  repetitions, rows, measurements, failures, psl, asl };
await writeFile(path.join(output, "frame-ack.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ...report, measurements: undefined }, null, 2));
