// Bundle with esbuild for Node. Raw traces and extracted features stay local.
import { readFile, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { describeAslTemporal, ASL_TEMPORAL_FEATURES } from "../lib/asl-temporal-features";
import { analyzeSignMotion } from "../lib/sign-motion";
import type { VisionFrame } from "../lib/vision-types";
import { aslVocabulary, fingerprint, signerKey, validateManifest } from "../scripts/evaluation-manifest.mjs";
import { loadFrozenCohorts } from "../scripts/evaluation-cohorts.mjs";

const VOCABULARY = ["HELLO", "THANK YOU", "PLEASE", "YES", "NO"];
const [manifestPath, rawDir, output] = process.argv.slice(2);
if (!manifestPath || !rawDir || !output) throw new Error("Supply manifest, native extraction directory and ignored feature output");
function contained(parent: string, path: string) {
  const local = relative(resolve(parent), resolve(path));
  return local !== "" && local !== ".." && !local.startsWith(`..${sep}`) && resolve(parent, local) === resolve(path);
}
if (!contained("evaluation/raw", rawDir) || !contained("evaluation/derived", output)) throw new Error("Use ignored evaluation paths");
const vocabulary = aslVocabulary();
const bytes = await readFile(manifestPath);
const manifest = JSON.parse(bytes.toString("utf8"));
const { cohorts } = await loadFrozenCohorts(undefined, vocabulary);
validateManifest(manifest, { vocabulary, related: cohorts.filter(cohort => resolve(cohort.file) !== resolve(manifestPath)).map(cohort => cohort.rows) });
const runtime = JSON.parse(await readFile(join(rawDir, "runtime.json"), "utf8"));
if (runtime.manifest_sha256 !== fingerprint(bytes)) throw new Error("Raw extraction manifest hash differs");

const rows = [];
for (const row of manifest) {
  const recording = row.recording_sha256;
  const extracted = JSON.parse(await readFile(join(rawDir, `${recording}.json`), "utf8"));
  if (extracted.recording_sha256 !== recording || extracted.trial_id !== row.trial_id) throw new Error("Trace identity differs");
  const kind = row.trial_type === "no_sign" ? "no_sign" : VOCABULARY.includes(row.expected_gloss) ? "target" : "unsupported";
  const shared = {
    trial_id: row.trial_id, recording_sha256: recording,
    signer: signerKey(row.participant_id), group: row.recording_group ?? row.archive_member ?? recording,
    expected: row.expected_gloss ?? row.oov_gloss ?? null, kind,
  };
  if (extracted.status !== "complete") {
    rows.push({ ...shared, status: "error", reason: extracted.error });
    continue;
  }
  const frames = extracted.frames as VisionFrame[];
  const descriptor = describeAslTemporal(frames);
  let firstReady: number | null = null;
  let motionReason = "no-hand";
  for (let i = 0; i < frames.length; i++) {
    const result = analyzeSignMotion(frames.slice(Math.max(0, i - 109), i + 1));
    motionReason = result.detail;
    if (result.ready) { firstReady = frames[i].timestamp; break; }
  }
  rows.push({ ...shared, status: "complete", framework: runtime.protocol, frames: frames.length, quality: extracted.quality,
    firstReady, motionReason, ...descriptor });
}
await writeFile(output, JSON.stringify({ schema: ASL_TEMPORAL_FEATURES, manifest: basename(manifestPath), runtime, vocabulary: VOCABULARY, rows }), { flag: "wx" });
console.log(JSON.stringify({ trials: rows.length, descriptors: rows.filter(row => "features" in row).length,
  ready: rows.filter(row => "firstReady" in row && row.firstReady !== null).length, failed: rows.filter(row => row.status !== "complete").length }));
