// Operator log for live webcam trials (manual gates MAN-1 to MAN-4). Run it in
// a terminal beside the demo browser; it appends one validated JSONL row per
// trial to a local, git-ignored file that `npm run eval:live` can summarise.
//
//   npm run eval:log                       # interactive
//   npm run eval:log -- --out evaluation/results/live-demo-laptop.jsonl
//
// Rows are operator observations: status "unreviewed", development split,
// never a holdout and never an accuracy figure. No video, landmarks, names or
// camera labels are recorded.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { validateTrials } from "./evaluation-metrics.mjs";

export const DEMO_SIGNS = ["HELLO", "THANK YOU", "PLEASE", "SORRY", "YES", "NO"];
export const OUTCOMES = {
  correct: "only the attempted word appeared",
  wrong: "a different or extra word appeared",
  no_match: "no word appeared",
  failure: "the camera, tracking or recognition failed",
};
export const RESULTS_DIR = "evaluation/results";
const PSEUDONYM = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const FREE_TEXT_LIMIT = 120;

const cleanText = (value, field) => {
  const text = String(value ?? "").normalize("NFC").trim().replace(/\s+/g, " ");
  if (text.length > FREE_TEXT_LIMIT) throw new Error(`${field} is longer than ${FREE_TEXT_LIMIT} characters`);
  // An e-mail address is a direct identifier; it never belongs in a trial row.
  if (/@/.test(text)) throw new Error(`${field} must not contain an e-mail address`);
  return text;
};
const words = value => String(value ?? "").split(",").map(word => word.normalize("NFC").trim().replace(/\s+/g, " ").toUpperCase()).filter(Boolean);

/** Session metadata shared by every row. Throws on anything identifying or malformed.
 * @param {{ sessionId: string, participantId: string, device: string, condition: string,
 *   framesPerSecond?: string | number | null, worker?: string | null }} input */
export function sessionInfo({ sessionId, participantId, device, condition, framesPerSecond = null, worker = null }) {
  for (const [field, value] of [["session id", sessionId], ["participant id", participantId]]) {
    if (!PSEUDONYM.test(value ?? "")) throw new Error(`${field} must be a pseudonym of letters, digits, - or _ (for example P01)`);
  }
  const fps = framesPerSecond === null || framesPerSecond === "" ? null : Number(framesPerSecond);
  if (fps !== null && !(Number.isFinite(fps) && fps >= 0 && fps <= 240)) throw new Error("frames analysed per second must be a number from the ?perf readout");
  return { session_id: sessionId, participant_id: participantId, device: cleanText(device, "device") || "unspecified",
    condition: cleanText(condition, "condition") || "unspecified", frames_analysed_per_s: fps, recognition_worker_sha256: worker };
}

/** One trial row in the evaluation/README.md JSONL format. */
export function trialRow(session, { index, attempted, outcome, shown = "", failure = "", note = "", observedAt = new Date().toISOString() }) {
  if (!Number.isInteger(index) || index < 1) throw new Error("trial index must be a positive integer");
  if (!(outcome in OUTCOMES)) throw new Error(`outcome must be one of ${Object.keys(OUTCOMES).join(", ")}`);
  const trialType = attempted === "no_sign" ? "no_sign" : attempted === "unknown_sign" ? "unknown_sign" : "sign";
  if (trialType === "sign" && !DEMO_SIGNS.includes(attempted)) throw new Error(`attempted sign must be one of ${DEMO_SIGNS.join(", ")}, no_sign or unknown_sign`);
  const expected = trialType === "sign" ? attempted : null;
  let accepted = [];
  if (outcome === "correct") {
    if (trialType !== "sign") throw new Error("a no-sign or unsupported-sign trial cannot be 'correct'; record no_match or wrong");
    accepted = [expected];
  } else if (outcome === "wrong") {
    accepted = words(shown);
    if (!accepted.length) throw new Error("record the word or words that appeared");
    if (trialType === "sign" && accepted.every(word => word === expected)) throw new Error("only the attempted word appeared: record 'correct'");
  }
  const failed = outcome === "failure";
  const reason = cleanText(failure, "failure");
  if (failed && !reason) throw new Error("describe the camera, tracking or recognition failure");
  return {
    ...session,
    trial_id: `${session.session_id}-${String(index).padStart(3, "0")}`,
    language: "asl", trial_type: trialType, expected_gloss: expected,
    predicted_gloss: accepted[0] ?? null, accepted: accepted.length > 0, accepted_glosses: accepted,
    status: failed ? "error" : "complete", ...(failed ? { errors: [reason] } : {}),
    operator_outcome: outcome, evaluation_split: "development", observed_at: observedAt,
    note: cleanText(note, "note"),
    source: "operator-live-log",
    review: { status: "unreviewed", reviewer_id: null },
    disclaimer: "Operator observation from a live demo. Not reviewed, not accuracy, never a holdout.",
  };
}

/** Validate the whole file with the new row, then replace it atomically. */
export function appendTrial(path, row) {
  const existing = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line)) : [];
  validateTrials([...existing, row]);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, [...existing, row].map(item => JSON.stringify(item)).join("\n") + "\n", { flag: "wx" });
  renameSync(temporary, path);
  return existing.length + 1;
}

/** Results must stay in the git-ignored folder so they cannot be committed by accident. */
export function resultsPath(out, sessionId) {
  const path = resolve(out ?? `${RESULTS_DIR}/live-${new Date().toISOString().slice(0, 10)}-${sessionId}.jsonl`);
  const child = relative(resolve(RESULTS_DIR), path);
  if (!child || isAbsolute(child) || child === ".." || child.startsWith(`..${sep}`))
    throw new Error(`write results under ${RESULTS_DIR}/ (git-ignored), not ${out}`);
  if (!path.endsWith(".jsonl")) throw new Error("the results file must end in .jsonl");
  return path;
}

async function main() {
  const args = process.argv.slice(2);
  const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async prompt => { process.stdout.write(prompt); const next = await lines.next(); if (next.done) throw new Error("input ended"); return next.value.trim(); };
  const manifest = existsSync("out/runtime-manifest.json") ? JSON.parse(readFileSync("out/runtime-manifest.json", "utf8")) : null;
  console.log("SignRelay live trial log. Pseudonyms only: no names, e-mail addresses or camera labels.");
  const sessionId = (await ask("Session id [S01]: ")) || "S01";
  const session = sessionInfo({ sessionId,
    participantId: (await ask("Participant pseudonym [P01]: ")) || "P01",
    device: await ask("Device and camera (e.g. demo-laptop built-in webcam): "),
    condition: await ask("Conditions (e.g. indoor bright, plain wall, 1 m): "),
    framesPerSecond: await ask("Frames analysed/s from the ?perf readout (blank if unknown): "),
    worker: manifest?.recognition_worker_sha256 ?? null });
  const path = resultsPath(option("--out"), session.session_id);
  const existing = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).length : 0;
  console.log(`Writing to ${path}${existing ? ` (${existing} rows already)` : ""}.`);
  const signMenu = DEMO_SIGNS.map((sign, i) => `${i + 1} ${sign}`).join(", ");
  for (let index = existing + 1; ; index++) {
    const choice = (await ask(`\nTrial ${index} attempted: ${signMenu}, n no-sign movement, u unsupported sign, q quit: `)).toLowerCase();
    if (choice === "q") break;
    const attempted = choice === "n" ? "no_sign" : choice === "u" ? "unknown_sign" : DEMO_SIGNS[Number(choice) - 1];
    if (!attempted) { console.log("Choose 1-6, n, u or q."); index--; continue; }
    const code = (await ask("Outcome: c correct, w wrong or extra word, m no match, f camera/tracking failure: ")).toLowerCase();
    const outcome = { c: "correct", w: "wrong", m: "no_match", f: "failure" }[code];
    try {
      const row = trialRow(session, { index, attempted, outcome,
        shown: outcome === "wrong" ? await ask("Word(s) that appeared, comma separated: ") : "",
        failure: outcome === "failure" ? await ask("What failed: ") : "",
        note: await ask("Note (optional): ") });
      appendTrial(path, row);
      console.log(`Saved ${row.trial_id}: ${row.trial_type} ${row.expected_gloss ?? ""} -> ${OUTCOMES[outcome]}.`);
    } catch (error) {
      console.log(`Not saved: ${error.message}`);
      index--;
    }
  }
  rl.close();
  console.log(`\nSummarise with: npm run eval:live -- ${path}\nThese rows are unreviewed operator observations. Do not publish them as accuracy.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exit(1); });
}
