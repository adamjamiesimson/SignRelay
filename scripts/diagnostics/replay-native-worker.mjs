// Run the unmodified, bundled recognition worker against the same native
// tracker streams as the learned models. No real-time scheduling or browser TTS.
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setImmediate as yieldOnce } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { aslVocabulary, fingerprint, signerKey, validateManifest } from "../evaluation-manifest.mjs";
import { loadFrozenCohorts } from "../evaluation-cohorts.mjs";

const [manifestPath, rawDir, workerPath, output] = process.argv.slice(2);
if (!output || !workerPath || !rawDir || !manifestPath) throw new Error("Supply manifest, raw trace directory, built recognition worker and output");
const vocabulary = aslVocabulary();
const { cohorts } = await loadFrozenCohorts(undefined, vocabulary);
const bytes = await readFile(manifestPath);
const manifest = JSON.parse(bytes);
validateManifest(manifest, { vocabulary, related: cohorts.filter(cohort => resolve(cohort.file) !== resolve(manifestPath)).map(cohort => cohort.rows) });
const sealed = new Set(cohorts.filter(c => c.role === "sealed-holdout").flatMap(c => c.rows.map(row => signerKey(row.participant_id))));
if (manifest.some(row => row.evaluation_split !== "development" || sealed.has(signerKey(row.participant_id)))) throw new Error("Use development traces outside the reserved cohort");
const runtime = JSON.parse(await readFile(join(rawDir, "runtime.json"), "utf8"));
if (runtime.manifest_sha256 !== fingerprint(bytes)) throw new Error("Manifest and trace fingerprints differ");

// Adapt the browser worker interface and public model reads for this process.
const modelRoot = resolve("public/models/asl2000-tgcn");
globalThis.self = globalThis;
globalThis.fetch = async (url, options) => {
  const name = /^\/models\/asl2000-tgcn\/([a-z0-9.]+)$/i.exec(url)?.[1];
  if (!name || name === "." || name === "..") throw new Error("Unexpected worker asset request");
  return new Response(await readFile(join(modelRoot, name), { signal: options?.signal }));
};
let messages = [];
globalThis.postMessage = message => messages.push(message);
const workerSha = fingerprint(await readFile(workerPath));
await import(pathToFileURL(resolve(workerPath)).href);
const dispatch = data => self.onmessage({ data });
const rows = [];
for (const trial of manifest) {
  const trace = JSON.parse(await readFile(join(rawDir, trial.recording_sha256 + ".json"), "utf8"));
  if (trace.trial_id !== trial.trial_id || trace.recording_sha256 !== trial.recording_sha256) throw new Error("Trace identity differs");
  dispatch({ type: "templates", language: "asl", templates: [] });
  messages = [];
  for (const frame of trace.frames ?? []) {
    await dispatch({ type: "frame", frame });
    await yieldOnce();
  }
  const kind = trial.role_in_candidate ?? (trial.cohort_group === "target" ? "target" : "unsupported");
  rows.push({ trial_id: trial.trial_id, kind, expected: trial.expected_gloss, status: trace.status,
    confirmed: messages.filter(row => row.type === "confirmed").map(row => row.gloss),
    suggested: messages.filter(row => row.type === "suggested").map(row => row.gloss),
    errors: [...new Set(messages.flatMap(row => row.type === "fault" ? [row.message]
      : row.feedback?.includes("could not run") ? [row.feedback] : []))],
  });
}
dispatch({ type: "reset" });
const valid = rows.filter(row => row.status === "complete" && !row.errors.length);
const expected = valid.filter(row => row.kind === "target");
const negative = valid.filter(row => row.kind === "unsupported");
const correct = expected.filter(row => row.confirmed.length === 1 && row.confirmed[0] === row.expected).length;
const abstained = expected.filter(row => !row.confirmed.length).length;
const report = { worker_sha256: workerSha, runtime, protocol: "native-landmarks-current-bundled-worker-fast-replay",
  correct, wrong: expected.length - correct - abstained, abstained, positives: expected.length,
  false_accepts: negative.filter(row => row.confirmed.length).length, negatives: negative.length, errors: rows.length - valid.length, rows };
await writeFile(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ correct, wrong: report.wrong, abstained, false_accepts: report.false_accepts, errors: report.errors }));
