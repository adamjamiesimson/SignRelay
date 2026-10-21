// Pair /field-test downloads with the private 144-slot intake. Validates the
// recording only; it never reviews, approves, scores or predicts anything.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { makeDevelopmentIntake } from "./reviewed-development.mjs";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const HANDS = ["Left", "Right"];

/** Container magic bytes; a renamed or mislabelled file is not the original take. */
export function containerOf(bytes) {
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "webm";
  if (bytes.length >= 8 && bytes.toString("latin1", 4, 8) === "ftyp") return "mp4";
  return null;
}

const extensionFor = mime => /^video\/mp4\b/.test(mime ?? "") ? "mp4" : /^video\/webm\b/.test(mime ?? "") ? "webm" : null;

/**
 * @param {{plan: object, intake: object, captures: {sidecar: object, sidecarName: string, videoName: string | null, video: Buffer | null}[]}} input
 * @returns {{intake: object, report: object}} a new intake; the input is not mutated.
 */
export function importCaptures({ plan, intake, captures }) {
  const template = makeDevelopmentIntake(plan);
  if (intake.plan_id !== plan.plan_id || intake.trials?.length !== template.trials.length) throw new Error("Intake does not match the frozen collection plan; regenerate it with prepare-reviewed-development template");
  const next = structuredClone(intake);
  const planned = new Map(template.trials.map(row => [row.trial_id, row]));
  const rows = new Map(next.trials.map(row => [row.trial_id, row]));
  const participants = new Map(next.participants.map(row => [row.participant_id, row]));
  const seenTrials = new Set();
  const seenHashes = new Map(next.trials.filter(row => row.capture?.sha256).map(row => [row.capture.sha256, row.trial_id]));
  const warnings = [];
  const imported = [];
  const declaredHands = new Map();

  for (const { sidecar, sidecarName, videoName, video } of captures) {
    const fail = message => { throw new Error(`${sidecarName}: ${message}`); };
    if (![1, 2].includes(sidecar.schema ?? 1)) fail("unknown sidecar schema");
    if (sidecar.plan_id !== plan.plan_id) fail(`belongs to plan ${sidecar.plan_id}, not ${plan.plan_id}`);
    const expected = planned.get(sidecar.trial_id);
    if (!expected) fail(`trial ${sidecar.trial_id} is not one of the ${planned.size} planned slots`);
    if (sidecarName !== `${sidecar.trial_id}.capture.json`) fail("sidecar file name differs from its trial ID");
    if (seenTrials.has(sidecar.trial_id)) fail("duplicate sidecar for the same trial");
    seenTrials.add(sidecar.trial_id);
    for (const key of ["participant_id", "trial_type", "expected_gloss", "evaluation_split"])
      if (sidecar[key] !== expected[key]) fail(`planned ${key} changed (${JSON.stringify(sidecar[key])} vs ${JSON.stringify(expected[key])})`);
    // A download is never review evidence, whatever the JSON claims.
    if (sidecar.status !== "pending-independent-fluent-review" || sidecar.review?.status !== "pending"
      || sidecar.review?.fluent_asl !== false || sidecar.review?.reviewer_id !== null) fail("sidecar claims review status; captures must arrive pending review");
    const extension = extensionFor(sidecar.mime_type);
    if (!extension) fail(`unsupported recording MIME type ${sidecar.mime_type}`);
    if (sidecar.original_recording_file !== `${sidecar.trial_id}.${extension}`) fail("recording file name differs from trial ID or MIME type");
    if (!video || videoName !== sidecar.original_recording_file) fail(`paired recording ${sidecar.original_recording_file} is missing`);
    if (containerOf(video) !== extension) fail(`file contents are not ${extension.toUpperCase()} (renamed, re-encoded or truncated?)`);
    if (video.length !== sidecar.bytes || video.length <= 0 || video.length > 100 * 1024 * 1024) fail("recording size differs from its sidecar");
    const digest = sha256(video);
    const verified = (sidecar.schema ?? 1) >= 2;
    if (verified && sidecar.recording_sha256 !== digest) fail("recording SHA-256 differs from the checksum computed at capture");
    if (!verified) warnings.push(`${sidecar.trial_id}: schema 1 sidecar has no capture checksum; original_unmodified_take stays false until attested privately`);
    if (seenHashes.has(digest) && seenHashes.get(digest) !== sidecar.trial_id) fail(`identical recording already assigned to ${seenHashes.get(digest)}`);
    seenHashes.set(digest, sidecar.trial_id);
    if (verified && !(Number.isFinite(sidecar.duration_ms) && sidecar.duration_ms >= 1000 && sidecar.duration_ms <= 32000)) fail("recording duration is outside 1–30 seconds");
    if (!HANDS.includes(sidecar.dominant_hand)) fail("actual dominant hand is missing");
    if (!Array.isArray(sidecar.physical_hands) || !sidecar.physical_hands.length || sidecar.physical_hands.some(hand => !HANDS.includes(hand))) fail("physical hands used are missing");
    if (typeof sidecar.device !== "string" || !sidecar.device.trim()) fail("device is missing");
    const prior = declaredHands.get(sidecar.participant_id) ?? participants.get(sidecar.participant_id)?.dominant_hand;
    if (prior && prior !== sidecar.dominant_hand) fail(`dominant hand ${sidecar.dominant_hand} contradicts ${prior} recorded for ${sidecar.participant_id}`);
    declaredHands.set(sidecar.participant_id, sidecar.dominant_hand);

    const row = rows.get(sidecar.trial_id);
    if (row.capture?.sha256 && row.capture.sha256 !== digest) fail("a different recording is already imported for this trial; resolve it manually instead of replacing it");
    if (row.review?.status && row.review.status !== "pending") fail("trial already has a review decision; re-import would detach it from its reviewed recording");
    Object.assign(row, {
      file: `evaluation/videos/${plan.plan_id}/${sidecar.original_recording_file}`,
      physical_hands: sidecar.physical_hands, device: sidecar.device.trim(),
      original_unmodified_take: verified,
      capture: { sha256: digest, bytes: video.length, mime_type: sidecar.mime_type, duration_ms: sidecar.duration_ms ?? null,
        recorded_at: sidecar.recorded_at ?? null, stop_reason: sidecar.stop_reason ?? null, sidecar_schema: sidecar.schema ?? 1,
        checksum_verified: verified },
    });
    imported.push(sidecar.trial_id);
  }
  for (const [participant_id, hand] of declaredHands) participants.get(participant_id).dominant_hand = hand;

  const captured = next.trials.filter(row => row.capture);
  const missing = (key, rowsToCheck) => rowsToCheck.filter(row => !row[key]).length;
  const report = {
    status: "awaiting-human-review", imported: imported.length, captured_trials: captured.length,
    planned_trials: template.trials.length, uncaptured_trials: template.trials.length - captured.length,
    approved_reviews: next.trials.filter(row => row.review?.status === "approved").length,
    pending_reviews: captured.filter(row => (row.review?.status ?? "pending") === "pending").length,
    // Required before freeze; this tool cannot supply any of them.
    still_required: { consent_reference: missing("consent_reference", captured), recording_group: missing("recording_group", captured),
      source: missing("source", captured), license: missing("license", captured) },
    warnings,
  };
  return { intake: next, report };
}

function within(file, directory) {
  const relative = path.relative(path.resolve(directory), path.resolve(file));
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [planFile, intakeFile, mediaDir] = process.argv.slice(2);
  if (!planFile || !intakeFile || !mediaDir) throw new Error("Usage: node scripts/capture-intake.mjs PLAN INTAKE evaluation/videos/PLAN_ID");
  if (!within(intakeFile, "evaluation/raw")) throw new Error("Private intake must stay in ignored evaluation/raw/");
  if (!within(mediaDir, "evaluation/videos")) throw new Error("Recordings must stay in ignored evaluation/videos/");
  for (const target of [intakeFile, mediaDir]) execFileSync("git", ["check-ignore", "--quiet", target]);
  const plan = JSON.parse(await readFile(planFile, "utf8"));
  if (path.basename(path.resolve(mediaDir)) !== plan.plan_id) throw new Error(`Store recordings under evaluation/videos/${plan.plan_id}/`);
  const intake = JSON.parse(await readFile(intakeFile, "utf8"));
  const names = await readdir(mediaDir);
  const captures = [];
  for (const sidecarName of names.filter(name => name.endsWith(".capture.json")).sort()) {
    const sidecar = JSON.parse(await readFile(path.join(mediaDir, sidecarName), "utf8"));
    const videoName = names.includes(sidecar.original_recording_file) ? sidecar.original_recording_file : null;
    captures.push({ sidecar, sidecarName, videoName, video: videoName ? await readFile(path.join(mediaDir, videoName)) : null });
  }
  const unpaired = names.filter(name => /\.(?:webm|mp4)$/i.test(name) && !captures.some(item => item.videoName === name));
  if (unpaired.length) throw new Error(`Recordings without sidecars: ${unpaired.join(", ")}`);
  // All-or-nothing: validation throws before anything is written.
  const { intake: updated, report } = importCaptures({ plan, intake, captures });
  const temporary = `${intakeFile}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(updated, null, 2) + "\n", { flag: "wx" });
  await rename(temporary, intakeFile);
  console.log(JSON.stringify(report, null, 2));
}
