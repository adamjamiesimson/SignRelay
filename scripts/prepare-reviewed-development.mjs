// Explicit human-reviewed collection import. Never records, reviews or predicts.
import { mkdir, readFile, realpath, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { approveDevelopmentIntake, makeDevelopmentIntake, validateNewDevelopmentParticipants } from "./reviewed-development.mjs";
import { aslVocabulary, fingerprint, validateManifest } from "./evaluation-manifest.mjs";
import { loadFrozenCohorts } from "./evaluation-cohorts.mjs";

function within(file, directory) {
  const relative = path.relative(path.resolve(directory), path.resolve(file));
  return relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
async function unused(file) {
  try { await stat(file); } catch (error) { if (error.code === "ENOENT") return; throw error; }
  throw new Error(`Refusing to overwrite ${file}`);
}
export async function prepareReviewedDevelopment(mode, planFile, intakeFile, manifestFile, lockFile) {
  const planBytes = await readFile(planFile), plan = JSON.parse(planBytes);
  if (!within(intakeFile, "evaluation/raw")) throw new Error("Private intake must stay in ignored evaluation/raw/");
  execFileSync("git", ["check-ignore", "--quiet", intakeFile]);
  if (mode === "template") {
    const intake = makeDevelopmentIntake(plan);
    await mkdir(path.dirname(intakeFile), { recursive: true });
    await writeFile(intakeFile, JSON.stringify(intake, null, 2) + "\n", { flag: "wx" });
    return { status: "awaiting-recordings-and-human-review", planned_trials: intake.trials.length, observed_trials: 0 };
  }
  if (mode !== "freeze" || !manifestFile || !lockFile) throw new Error("Use template PLAN INTAKE or freeze PLAN INTAKE MANIFEST LOCK");
  if (!within(planFile, "docs/evaluation") || !planFile.endsWith(".json")) throw new Error("Freeze a public collection plan under docs/evaluation/");
  if ([manifestFile, lockFile].some(file => !within(file, "docs/evaluation") || !file.endsWith(".json"))
    || path.resolve(manifestFile) === path.resolve(lockFile)) throw new Error("Use two new JSON metadata paths under docs/evaluation/");
  await unused(manifestFile); await unused(lockFile);
  const vocabulary = aslVocabulary();
  const intake = JSON.parse(await readFile(intakeFile, "utf8"));
  // Reject pending/partial review before opening any participant recording.
  const rows = approveDevelopmentIntake(intake, plan, vocabulary);
  const { registry, cohorts } = await loadFrozenCohorts(undefined, vocabulary);
  validateNewDevelopmentParticipants(rows, cohorts.map(cohort => cohort.rows));
  const knownHashes = new Set(cohorts.flatMap(cohort => cohort.rows.map(row => row.recording_sha256)));
  const mediaRoot = await realpath("evaluation/videos");
  for (const row of rows) {
    if (typeof row.file !== "string" || !row.file.startsWith("evaluation/videos/")
      || row.file.split(/[\\/]/).some(part => part === "..")) throw new Error("Media must stay in ignored evaluation/videos/");
    execFileSync("git", ["check-ignore", "--quiet", row.file]);
    const actual = await realpath(row.file);
    if (!within(actual, mediaRoot)) throw new Error("Media symlink leaves private recording directory");
    const details = await stat(actual);
    if (!details.isFile() || details.size <= 0 || details.size > 100 * 1024 * 1024) throw new Error("Use nonempty video files under 100 MB");
    row.recording_sha256 = fingerprint(await readFile(actual));
    // Imported captures carry the browser checksum of the downloaded take.
    if (row.capture_sha256 && row.capture_sha256 !== row.recording_sha256) throw new Error(`${row.trial_id}: recording changed after capture`);
    if (knownHashes.has(row.recording_sha256)) throw new Error("Duplicate frozen recording cannot enter the new batch");
    knownHashes.add(row.recording_sha256);
    const media = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", actual], { encoding: "utf8" }));
    const duration = Number(media.format?.duration);
    if (!media.streams?.some(stream => stream.codec_type === "video") || !Number.isFinite(duration) || duration <= 0 || duration > 30)
      throw new Error("Use a decodable video of at most 30 seconds");
    row.bytes = details.size; row.source_duration_s = duration;
  }
  validateManifest(rows, { vocabulary, related: cohorts.map(cohort => cohort.rows) });
  const manifestBytes = JSON.stringify(rows, null, 2) + "\n";
  const next = { ...registry, manifests: [...registry.manifests, {
    file: manifestFile, role: "reviewed-development", sha256: fingerprint(manifestBytes), recordings: rows.length,
    collection_plan: planFile, collection_plan_sha256: fingerprint(planBytes), review_policy: "independent-fluent-asl-v1",
  }], note: "Extended with independently reviewed development recordings; every original cohort is preserved. No predictions were run during import." };
  await mkdir(path.dirname(manifestFile), { recursive: true }); await mkdir(path.dirname(lockFile), { recursive: true });
  await writeFile(manifestFile, manifestBytes, { flag: "wx" });
  try { await writeFile(lockFile, JSON.stringify(next, null, 2) + "\n", { flag: "wx" }); }
  catch (error) { await unlink(manifestFile); throw error; }
  return { status: "frozen-reviewed-development", recordings: rows.length, manifest: manifestFile, lock: lockFile, predictions_run: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, plan, intake, manifest, lock] = process.argv.slice(2);
  if (!plan || !intake) throw new Error("Use template PLAN INTAKE or freeze PLAN INTAKE MANIFEST LOCK");
  console.log(JSON.stringify(await prepareReviewedDevelopment(mode, plan, intake, manifest, lock)));
}
