// Facilitator tooling for the supervised signer study (docs/evaluation/signer-study/).
// Works only on private files under the ignored evaluation/raw/ folder; prints
// aggregate counts only.
//
//   node scripts/signer-study.mjs enrol evaluation/raw/signer-study/roster.json ss-2026-11-p01
//   node scripts/signer-study.mjs withdraw evaluation/raw/signer-study/roster.json ss-2026-11-p01
//   node scripts/signer-study.mjs validate evaluation/raw/signer-study/roster.json <session.study.json>...
//   node scripts/signer-study.mjs summarise evaluation/raw/signer-study/roster.json evaluation/raw/signer-study/sessions [--public] [--final-heldout]
import { build } from "esbuild";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** lib/signer-study.ts is the single implementation shared with the browser tool. */
export async function loadStudy() {
  const out = await build({ entryPoints: ["lib/signer-study.ts"], bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent" });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
}

const PRIVATE_ROOT = resolve("evaluation/raw");
/** Rosters and session logs are personal data: never outside the ignored private folder. */
export function assertPrivate(path) {
  const rel = relative(PRIVATE_ROOT, resolve(path));
  if (rel.startsWith("..") || rel === "" || resolve(path) === PRIVATE_ROOT) throw new Error(`${path} must be inside evaluation/raw/ (ignored, private)`);
}

export function readRoster(path) {
  assertPrivate(path);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { schema: 1, plan_id: null, signers: [], withdrawn: [] };
}

export async function enrol(rosterPath, pseudonym, study) {
  const roster = readRoster(rosterPath);
  if (!study.isPseudonym(pseudonym)) throw new Error("Use a study pseudonym (ss-2026-11-pNN), never a name");
  if (roster.signers.some(s => s.pseudonym === pseudonym)) throw new Error(`${pseudonym} is already enrolled`);
  if (roster.withdrawn.includes(pseudonym)) throw new Error(`${pseudonym} withdrew; assign a new pseudonym if they rejoin`);
  const split = await study.assignSplit(pseudonym);
  const entry = { pseudonym, enrolment: roster.signers.length, split, enrolled_on: new Date().toISOString().slice(0, 10) };
  roster.plan_id = study.STUDY_PLAN.plan_id;
  roster.signers.push(entry);
  mkdirSync(dirname(rosterPath), { recursive: true });
  writeFileSync(rosterPath, JSON.stringify(roster, null, 1) + "\n");
  return { ...entry, conditions: [1, 2].map(session => study.sessionConditions(entry.enrolment, session)) };
}

export function withdraw(rosterPath, pseudonym) {
  const roster = readRoster(rosterPath);
  if (!roster.withdrawn.includes(pseudonym)) roster.withdrawn.push(pseudonym);
  writeFileSync(rosterPath, JSON.stringify(roster, null, 1) + "\n");
  return { withdrawn: roster.withdrawn.length, note: "Delete this signer's session logs and recordings within 30 days; summaries already exclude them." };
}

export function validateFiles(rosterPath, files, study) {
  const roster = readRoster(rosterPath);
  return files.map(file => {
    assertPrivate(file);
    let errors;
    try {
      const session = JSON.parse(readFileSync(file, "utf8"));
      const signer = roster.signers.find(s => s.pseudonym === session.participant);
      errors = study.validateStudySession(session, { knownSplit: signer?.split });
      if (!signer) errors.push("participant: not enrolled in the roster");
      if (roster.withdrawn.includes(session.participant)) errors.push("participant: withdrew; delete this file");
    } catch (error) { errors = [`unreadable: ${error.message}`]; }
    return { file, ok: errors.length === 0, errors };
  });
}

export function summarise(rosterPath, dir, study, { publicReport = false, finalHeldOut = false } = {}) {
  assertPrivate(dir);
  const roster = readRoster(rosterPath);
  const participantOf = file => { try { return JSON.parse(readFileSync(file, "utf8")).participant; } catch { return null; } };
  // Withdrawn signers are excluded before anything else (their files are due for deletion).
  const files = readdirSync(dir).filter(name => name.endsWith(".study.json")).map(name => join(dir, name))
    .filter(file => !roster.withdrawn.includes(participantOf(file)));
  const results = validateFiles(rosterPath, files, study);
  const invalid = results.filter(r => !r.ok);
  if (invalid.length) throw new Error(`Invalid session logs (fix or remove first):\n${invalid.map(r => `${r.file}: ${r.errors[0]}`).join("\n")}`);
  const sessions = files.map(file => JSON.parse(readFileSync(file, "utf8")));
  const summary = study.summariseSessions(sessions, { includeHeldOut: finalHeldOut });
  if (!publicReport) return summary;
  return { ...summary, bySplitKind: study.suppressSmallCells(summary.bySplitKind), byGloss: study.suppressSmallCells(summary.byGloss) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, roster, ...rest] = process.argv.slice(2);
  const study = await loadStudy();
  const flags = new Set(rest.filter(a => a.startsWith("--")));
  const args = rest.filter(a => !a.startsWith("--"));
  let output;
  if (command === "enrol") output = await enrol(roster, args[0], study);
  else if (command === "withdraw") output = withdraw(roster, args[0]);
  else if (command === "validate") { output = validateFiles(roster, args, study); if (output.some(r => !r.ok)) process.exitCode = 1; }
  else if (command === "summarise") output = summarise(roster, args[0], study, { publicReport: flags.has("--public"), finalHeldOut: flags.has("--final-heldout") });
  else throw new Error("usage: node scripts/signer-study.mjs enrol|withdraw|validate|summarise <roster> ...");
  console.log(JSON.stringify(output, null, 1));
}
