// Blind independent-review workflow for captured development trials.
// The reviewer packet hides trial IDs, planned glosses, trial types,
// participant pseudonyms, consent references and every model output. Only a
// human reviewer's response file can produce a review decision.
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { writeIntakeAtomically } from "./capture-intake.mjs";

const normalize = value => typeof value === "string" ? value.normalize("NFC").trim().toUpperCase().replace(/[^\p{L}\p{N}]/gu, "") : "";
const pseudonym = value => typeof value === "string" && /^[\w.-]{1,64}$/.test(value);
export const NO_SIGN = "NO_SIGN";
const NO_SIGN_KEY = normalize(NO_SIGN);
const sha256 = text => createHash("sha256").update(text).digest("hex");
/** Digest of the packet's item IDs in packet order: added, removed or reordered items change it. */
export const itemsDigest = ids => sha256(JSON.stringify(ids));
/** Digest of the coordinator key's mapping, so an edited key cannot reassign reviews. */
export const keyDigest = key => sha256(JSON.stringify(key.items.map(({ review_item_id, trial_id, file, sha256: recording }) => [review_item_id, trial_id, file, recording])));

/** @param {object} intake @param {() => string} [token] */
export function makeReviewPacket(intake, token = () => randomBytes(5).toString("hex")) {
  const captured = intake.trials.filter(row => row.capture?.sha256 && (row.review?.status ?? "pending") === "pending");
  // Shuffle so packet order cannot reveal slot or gloss order.
  const shuffled = captured.map(row => ({ row, order: token() })).sort((a, b) => a.order.localeCompare(b.order));
  const used = new Set();
  const items = shuffled.map(({ row }) => {
    let id;
    do id = `R-${token()}`; while (used.has(id));
    used.add(id);
    return { row, id, extension: path.extname(row.file) };
  });
  const packetId = `P-${token()}${token()}`;
  const digest = itemsDigest(items.map(item => item.id));
  const keyItems = items.map(({ id, row }) => ({ review_item_id: id, trial_id: row.trial_id, file: row.file, sha256: row.capture.sha256 }));
  return {
    packet: {
      schema: 2, plan_id: intake.plan_id, packet_id: packetId, items_digest: digest, status: "awaiting-independent-fluent-review",
      instructions: [
        "Watch each recording and label what is actually signed. You are not told what was requested.",
        `Use the ASL gloss you observe, or ${NO_SIGN} if no sign is produced. Describe the variant or handshape/movement used.`,
        "Mark usable=false when the signer, hands or face are not adequately visible, the take is cut off, or you cannot judge it.",
        "For signed takes, give the stroke start and end in seconds from the start of the file.",
        "Do not view model predictions, logs or evaluation reports before submitting this file.",
        "Set reviewer.attests_packet_id to this file's packet_id to confirm your attestation applies to exactly these items. Do not add, remove or reorder items.",
      ],
      reviewer: { reviewer_id: null, fluent_asl: false, independent_of_participants: false, blinded_to_predictions: false, reviewed_on: null, attests_packet_id: null },
      items: items.map(({ id, extension, row }) => ({ review_item_id: id, media: `${id}${extension}`, duration_s: (row.capture.duration_ms ?? 0) / 1000 || null,
        usable: null, actual_sign: null, variant_notes: "", stroke_start_s: null, stroke_end_s: null, unusable_reason: null })),
    },
    // Coordinator-only mapping; never give it to the reviewer.
    key: { schema: 2, plan_id: intake.plan_id, packet_id: packetId, items_digest: digest, key_sha256: keyDigest({ items: keyItems }), items: keyItems },
  };
}

/** Merge one reviewer's responses into a copy of the intake, appending an audit entry.
 * @param {{ intake: any, key: any, response: any, participantIds: string[], responseSha256?: string, mergedAt?: string }} input */
export function mergeReviews({ intake, key, response, participantIds, responseSha256 = sha256(JSON.stringify(response)), mergedAt = new Date().toISOString() }) {
  if (response.plan_id !== intake.plan_id || key.plan_id !== intake.plan_id) throw new Error("Review response belongs to a different collection plan");
  if (!key.packet_id || key.key_sha256 !== keyDigest(key) || key.items_digest !== itemsDigest(key.items.map(item => item.review_item_id)))
    throw new Error("Coordinator key was edited or predates packet binding; issue a new packet");
  if (response.packet_id !== key.packet_id) throw new Error("Review response belongs to a different review packet");
  if (itemsDigest((response.items ?? []).map(item => item.review_item_id)) !== key.items_digest)
    throw new Error("Response items differ from the issued packet (added, removed or reordered); answer the packet as issued");
  if ((intake.review_audit ?? []).some(entry => entry.packet_id === key.packet_id)) throw new Error("This review packet was already merged");
  const reviewer = response.reviewer ?? {};
  if (!pseudonym(reviewer.reviewer_id) || participantIds.includes(reviewer.reviewer_id)) throw new Error("Reviewer needs a pseudonym that is not a collection participant");
  if (reviewer.fluent_asl !== true || reviewer.independent_of_participants !== true || reviewer.blinded_to_predictions !== true)
    throw new Error("Reviewer must attest fluent ASL, independence from participants and blindness to predictions");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewer.reviewed_on ?? "") || !Number.isFinite(Date.parse(reviewer.reviewed_on))) throw new Error("Review date is missing");
  if (reviewer.attests_packet_id !== key.packet_id) throw new Error("Reviewer attestation must name this packet's packet_id");
  const next = structuredClone(intake);
  const rows = new Map(next.trials.map(row => [row.trial_id, row]));
  const keyed = new Map(key.items.map(item => [item.review_item_id, item]));
  const seen = new Set();
  const outcome = { approved: 0, rejected: 0, unusable: 0, skipped: 0 };
  const decisions = [];
  for (const item of response.items ?? []) {
    const fail = message => { throw new Error(`${item.review_item_id}: ${message}`); };
    const mapping = keyed.get(item.review_item_id);
    if (!mapping) fail("not part of this review packet");
    if (seen.has(item.review_item_id)) fail("answered twice");
    seen.add(item.review_item_id);
    if (item.usable === null && item.actual_sign === null) { outcome.skipped++; continue; }
    const row = rows.get(mapping.trial_id);
    if (row.capture?.sha256 !== mapping.sha256 || row.file !== mapping.file) fail("recording changed after the packet was made; issue a new packet");
    if ((row.review?.status ?? "pending") !== "pending") fail("trial already has a review decision");
    if (typeof item.usable !== "boolean") fail("usable must be true or false");
    const base = { ...row.review, packet_id: key.packet_id, reviewer_id: reviewer.reviewer_id, fluent_asl: true, independent_of_participant: true,
      blinded_to_predictions: true, reviewed_on: reviewer.reviewed_on, variant_notes: item.variant_notes?.trim() || null };
    if (!item.usable) {
      if (!item.unusable_reason?.trim()) fail("explain why the take is unusable");
      row.review = { ...base, status: "rejected", decision: "unusable", unusable_reason: item.unusable_reason.trim(), actual_gloss: null, activity_confirmed: false };
      outcome.unusable++;
      decisions.push({ review_item_id: item.review_item_id, trial_id: mapping.trial_id, recording_sha256: mapping.sha256, decision: "unusable" });
      continue;
    }
    if (!base.variant_notes) fail("describe the variant or observed movement");
    const observed = normalize(item.actual_sign);
    if (!observed) fail("actual_sign is required");
    const duration = (row.capture?.duration_ms ?? 0) / 1000;
    let stroke = null;
    if (observed !== NO_SIGN_KEY) {
      if (![item.stroke_start_s, item.stroke_end_s].every(Number.isFinite) || item.stroke_start_s < 0
        || item.stroke_end_s <= item.stroke_start_s || (duration && item.stroke_end_s > duration + 0.05)) fail("stroke interval must lie within the recording");
      stroke = { start_s: item.stroke_start_s, end_s: item.stroke_end_s };
    }
    // The reviewer's label is ground truth; a mismatch with the plan is
    // recorded, never coerced into the requested gloss.
    let matches;
    if (row.trial_type === "sign") matches = observed === normalize(row.expected_gloss);
    else if (row.trial_type === "no_sign") matches = observed === NO_SIGN_KEY;
    else matches = observed !== NO_SIGN_KEY;
    row.review = { ...base, status: matches ? "approved" : "rejected", decision: matches ? "approved" : "label-differs-from-plan",
      actual_gloss: observed === NO_SIGN_KEY ? null : item.actual_sign.trim(), activity_confirmed: row.trial_type === "no_sign" && matches,
      stroke_interval: stroke };
    outcome[matches ? "approved" : "rejected"]++;
    decisions.push({ review_item_id: item.review_item_id, trial_id: mapping.trial_id, recording_sha256: mapping.sha256, decision: row.review.decision });
  }
  // Append-only record of who reviewed what, from which response file.
  next.review_audit = [...(next.review_audit ?? []), { packet_id: key.packet_id, reviewer_id: reviewer.reviewer_id, reviewed_on: reviewer.reviewed_on,
    merged_at: mergedAt, response_sha256: responseSha256, key_sha256: key.key_sha256, outcome, decisions }];
  return { intake: next, outcome };
}

function within(file, directory) {
  const relative = path.relative(path.resolve(directory), path.resolve(file));
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, intakeFile, ...rest] = process.argv.slice(2);
  if (!intakeFile || !within(intakeFile, "evaluation/raw")) throw new Error("Usage: packet INTAKE OUTDIR | merge INTAKE KEY RESPONSE PLAN (all under evaluation/raw/)");
  const intakeBytes = await readFile(intakeFile);
  const intake = JSON.parse(intakeBytes.toString("utf8"));
  if (mode === "packet") {
    const [outDir] = rest;
    if (!outDir || !within(outDir, "evaluation/raw")) throw new Error("Write the review packet under ignored evaluation/raw/");
    await mkdir(path.join(outDir, "media"), { recursive: true });
    execFileSync("git", ["check-ignore", "--quiet", outDir]);
    const { packet, key } = makeReviewPacket(intake);
    for (const item of key.items) await copyFile(item.file, path.join(outDir, "media", `${item.review_item_id}${path.extname(item.file)}`));
    await writeFile(path.join(outDir, "review-packet.json"), JSON.stringify(packet, null, 2) + "\n", { flag: "wx" });
    await writeFile(path.join(outDir, "coordinator-key.json"), JSON.stringify(key, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify({ items: key.items.length, give_reviewer: ["review-packet.json", "media/"], keep_private: "coordinator-key.json" }));
  } else if (mode === "merge") {
    const [keyFile, responseFile, planFile] = rest;
    if (![keyFile, responseFile].every(file => file && within(file, "evaluation/raw")) || !planFile) throw new Error("Key and response must stay under evaluation/raw/");
    const plan = JSON.parse(await readFile(planFile, "utf8"));
    const responseBytes = await readFile(responseFile);
    const { intake: updated, outcome } = mergeReviews({ intake, key: JSON.parse(await readFile(keyFile, "utf8")),
      response: JSON.parse(responseBytes.toString("utf8")), participantIds: plan.participant_ids,
      responseSha256: createHash("sha256").update(responseBytes).digest("hex") });
    await writeIntakeAtomically(intakeFile, updated, intakeBytes);
    console.log(JSON.stringify(outcome));
  } else throw new Error("Unknown mode");
}
