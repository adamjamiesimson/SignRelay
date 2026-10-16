import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const normalized = value => typeof value === "string" ? value.normalize("NFC").trim().toUpperCase().replace(/[^\p{L}\p{N}]/gu, "") : "";
const signerKey = id => id.replace(/^gtsignstudy/, "popsign-").replace(/^popsign-(?:gtsignstudy)?/, "popsign-");
export const fingerprint = bytes => createHash("sha256").update(bytes).digest("hex");
export function aslVocabulary() {
  // Actual installed automatic path; no personal templates are loaded by the lab.
  const labels = JSON.parse(readFileSync("public/models/asl2000-tgcn/labels.json", "utf8"));
  const words = [...new Set([...labels, "HELLO", "THANK YOU", "PLEASE", "SORRY", "YES", "NO", "I LOVE YOU"].map(normalized))].sort();
  return { words, sha256: fingerprint(JSON.stringify(words)), scope: "installed ASL-2000 plus starter rules; lab personal templates empty" };
}

/** Validate whole cohorts before running any video. Related manifests are
 * metadata-only: never replay a reserved signer while developing a candidate. */
/** @param {object[]} manifest
 * @param {{related?: object[][], allowHoldout?: boolean, vocabulary?: {words: string[], sha256: string}}} [options] */
export function validateManifest(manifest, options = {}) {
  const { related = [], allowHoldout = false, vocabulary } = options;
  if (!Array.isArray(manifest) || !manifest.length) throw new Error("Manifest needs trials");
  const ids = new Set(), hashes = new Set(), recordings = new Set(), signers = new Map();
  for (const row of [...related.flat(), ...manifest]) {
    const fail = message => { throw new Error(`${row.trial_id ?? "manifest"}: ${message}`); };
    for (const key of ["trial_id", "participant_id", "language", "file", "license", "source"])
      if (typeof row[key] !== "string" || !row[key].trim()) fail(`missing ${key}`);
    if (!/^[a-f0-9]{64}$/.test(row.recording_sha256 ?? "")) fail("missing frozen recording fingerprint");
    if (!row.file.startsWith("evaluation/videos/") || row.file.split(/[\\/]/).some(part => part === "..")) fail("media must stay in ignored evaluation/videos/");
    if (!["development", "held_out"].includes(row.evaluation_split)) fail("declare development or held_out split");
    if (!["sign", "no_sign", "unknown_sign"].includes(row.trial_type)) fail("invalid trial type");
    if (row.trial_type === "sign" ? !normalized(row.expected_gloss) : row.expected_gloss !== null) fail("invalid expected gloss");
    if (ids.has(row.trial_id) || hashes.has(row.recording_sha256)) fail("duplicate trial or recording");
    ids.add(row.trial_id); hashes.add(row.recording_sha256);
    // Cropped/re-encoded takes from one source recording remain one trial.
    const recording = row.recording_group ?? row.archive_member ?? row.recording_sha256;
    if (recordings.has(recording)) fail("duplicate source recording group");
    recordings.add(recording);
    const signer = signerKey(row.participant_id), prior = signers.get(signer);
    if (prior && prior !== row.evaluation_split) fail("signer leakage between development and holdout");
    signers.set(signer, row.evaluation_split);
    if (row.trial_type === "no_sign" && (!row.negative_activity || !row.annotation_review)) fail("no-sign controls need reviewed real activity");
    if (row.trial_type === "unknown_sign") {
      if (row.language !== "asl") fail("OOV vocabulary verification is only implemented for ASL");
      if (!row.oov_gloss || !row.annotation_review || !vocabulary) fail("OOV needs review and installed vocabulary");
      if (row.vocabulary_sha256 !== vocabulary.sha256) fail("OOV vocabulary snapshot changed");
      if (vocabulary.words.includes(normalized(row.oov_gloss))) fail("OOV sign is supported by the installed recognizer");
    }
  }
  if (!allowHoldout && manifest.some(row => row.evaluation_split === "held_out")) throw new Error("Holdout is sealed: freeze candidate and explicitly use --final-holdout before a once-only final measurement");
  return manifest;
}
