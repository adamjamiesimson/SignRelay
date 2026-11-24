import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { launch } from './browser-common.mjs';
import { serve } from './serve.mjs';
import { Confirmation } from '../src/verification.mjs';
import { CANDIDATES, signIds } from '../src/signs.mjs';

const cohortFile = process.argv[2];
const output = process.argv[3] ?? 'test-output/recognition.json';
if (!cohortFile) throw new Error('Usage: node scripts/evaluate.mjs <cohort.json> [out.json] [--selection|--full]');
const candidates = CANDIDATES.filter(s => s.id !== 'sorry').map(s => s.id);
const selecting = process.argv.includes('--selection');
const full = process.argv.includes('--full');
const sparse = process.argv.includes('--sparse');
const scramble = process.argv.includes('--scrambled');
const targets = selecting ? candidates : signIds;
const fixtures = dirname(resolve(cohortFile));
const cohort = JSON.parse(await readFile(cohortFile, 'utf8')).filter(r => selecting ? candidates.includes(r.sign) && r.split === 'val' : r.split === 'test');
for (const row of cohort) {
  const bytes = await readFile(resolve(fixtures, row.file));
  if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw new Error('Fixture hash mismatch ' + row.file);
}
const variants = full ? ['mirror', 'dim', 'fast', 'slow'] : [];
const primary = sparse ? 'sparse' : 'original';
const jobs = scramble ? targets.map(sign => ({ ...cohort.find(row => row.sign === sign), sign, variant: 'scrambled' })) :
  cohort.map(row => ({ ...row, variant: primary }));
if (!selecting) for (const target of targets) {
  const row = cohort.find(r => r.sign === target);
  if (row) for (const variant of variants) jobs.push({ ...row, variant });
}
jobs.push({ sign: 'blank', variant: 'synthetic-empty' });
const browser = await launch();
const { server, url } = await serve({ fixtures, directory: process.env.GAMESHOW_REPLAY_DIST ?? 'test-output/replay-site' });
const results = [];
const errors = [];
const thresholds = [0.50, 0.55, 0.6, 0.65, 0.69, 0.75, 0.79];
const thresholdConfirm = (scores, targetIndex, threshold) => {
  const signal = new Confirmation();
  return scores.find(item => signal.push(item.values[targetIndex].score, item.t, threshold))?.t ?? null;
};
try {
  const page = await browser.newPage();
  page.on('pageerror', err => console.error('Page error', err.message));
  await page.goto(url + '/replay.html');
  await page.waitForFunction(() => !!globalThis.ready);
  await page.evaluate(() => globalThis.ready);
  for (const job of jobs) {
    try {
      const data = await page.evaluate(input => globalThis.replay(input), { ...job, targets });
      const decisions = Object.fromEntries(targets.map((target, index) => [
        target, Object.fromEntries(thresholds.map(th => [th, thresholdConfirm(data.timeline, index, th)]))
      ]));
      results.push({ source: job.source, file: job.file, sign: job.sign, variant: job.variant,
        duration: data.duration, frameCount: data.frameCount, tracked: data.tracked, decisions,
        max: Object.fromEntries(targets.map((target, i) => [target, Math.max(0, ...data.timeline.map(row => row.values[i].score))])),
        cpuMs: data.timeline.map(row => row.cpuMs).filter(Number.isFinite) });
      console.log(job.file ?? 'empty frame', job.variant, data.tracked + '/' + data.frameCount,
        (results.at(-1).max[job.sign] ?? 0).toFixed(3), decisions[job.sign]?.['0.6'] ?? 'no accept');
    } catch (error) {
      errors.push({ file: job.file, variant: job.variant, message: error.message });
      console.error('Replay failed', job.file, job.variant, error.message);
    }
  }
} finally {
  await browser.close();
  server.close();
}
function summarize(th) {
  const original = results.filter(r => r.variant === primary);
  return targets.map(target => {
    const own = original.filter(r => r.sign === target);
    const negatives = original.filter(r => r.sign !== target);
    const augmented = results.filter(r => r.sign === target && variants.includes(r.variant));
    const accepts = rows => rows.filter(r => r.decisions[target][th] !== null);
    const correct = accepts(own);
    const scrambled = results.filter(r => r.variant === 'scrambled');
    return { target, correct: correct.length, positives: own.length,
      unrelatedAccepted: accepts(negatives).length, unrelated: negatives.length,
      transformedAccepted: accepts(augmented).length, transformed: augmented.length,
      scrambledAccepted: accepts(scrambled).length, scrambled: scrambled.length,
      emptyAccepted: accepts(results.filter(r => r.sign === 'blank')).length,
      noAccept: own.length - correct.length, acceptedAtMs: correct.map(r => r.decisions[target][th]) };
  });
}
const summary = Object.fromEntries(thresholds.map(th => [th, summarize(th)]));
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ selecting, sparse, scramble, targets, errors, summary, results }, null, 2) + '\n');
console.table(summary['0.6']);
if (errors.length) process.exitCode = 1;

