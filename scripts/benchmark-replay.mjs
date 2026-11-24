import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { launch } from './browser-common.mjs';
import { serve } from './serve.mjs';
import { signIds } from '../src/signs.mjs';
import { Confirmation } from '../src/verification.mjs';

const [manifest, output, split = 'val', rate = '5', choicesFile] = process.argv.slice(2);
if (!manifest || !output || !['val', 'test', 'scramble'].includes(split)) {
  throw new Error('Usage: node scripts/benchmark-replay.mjs <manifest.json> <output.json> <val|test|scramble> [fps] [thresholds.json]');
}
const fps = Number(rate);
assert.ok(Number.isFinite(fps) && fps >= 3 && fps <= 30);
const providers = JSON.parse(await readFile(manifest, 'utf8'));
const fixtures = dirname(resolve(manifest));
const rows = split === 'scramble'
  ? signIds.map(sign => providers.find(row => row.split === 'test' && row.sign === sign)).filter(Boolean)
  : providers.filter(row => row.split === split);
assert.ok(rows.length, 'No matching recorded clips');
for (const row of rows) {
  const bytes = await readFile(resolve(fixtures, row.file));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256, 'Wrong clip ' + row.file);
}

const thresholds = [0.55, 0.575, 0.60, 0.625, 0.65, 0.69, 0.79];
const names = ['baseline', 'candidate'];
const seconds = timeline => timeline.filter(row => Number.isFinite(row.cpuMs)).map(row => row.cpuMs);
function decision(timeline, index, threshold) {
  const signal = new Confirmation();
  return timeline.find(row => signal.push(row.values[index].score, row.t, threshold))?.t ?? null;
}
const quantile = (items, q) => {
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * q) - 1];
};

const sources = [...rows, { sign: 'blank' }];
const results = [];
const errors = [];
const browser = await launch();
const { server, url } = await serve({ fixtures, directory: 'test-output/replay-site' });
try {
  const page = await browser.newPage();
  await page.goto(url + '/replay.html');
  await page.waitForFunction(() => !!globalThis.ready);
  await page.evaluate(() => globalThis.ready);
  for (const row of sources) {
    try {
      const variant = !row.file ? 'synthetic-empty' : split === 'scramble' ? 'scrambled' : 'original';
      const data = await page.evaluate(input => globalThis.replay(input),
        { file: row.file, targets: signIds, variant, strategies: names, fps });
      const modes = {};
      for (const schedule of data.schedules) {
        const values = Object.fromEntries(signIds.map((id, i) =>
          [id, Object.fromEntries(thresholds.map(th => [th, decision(schedule.timeline, i, th)]))]));
        modes[schedule.name] = { usedWindows: schedule.windows, workerMs: seconds(schedule.timeline), values };
      }
      results.push({ ...row, variant, tracked: data.tracked, frames: data.frameCount, trackerMs: data.trackingMs, modes });
      console.log(row.file ?? 'empty', data.tracked + '/' + data.frameCount,
        modes.baseline.values[row.sign]?.['0.6'] ?? '—', modes.candidate.values[row.sign]?.['0.6'] ?? '—');
    } catch (error) {
      errors.push({ file: row.file, error: error.message });
      console.error(row.file, error.message);
    }
  }
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}

function summary(name, thresholdFor) {
  return signIds.map(target => {
    const th = thresholdFor(target);
    const own = results.filter(row => row.variant === 'original' && row.sign === target);
    const other = results.filter(row => row.variant !== 'synthetic-empty' && (row.variant === 'scrambled' || row.sign !== target));
    const acceptedAt = rows => rows.flatMap(row => row.modes[name].values[target][th] ?? []);
    const correct = acceptedAt(own);
    return { target, threshold: th, accepted: correct.length, positives: own.length, wrong: acceptedAt(other).length,
      comparisons: other.length, empty: acceptedAt(results.filter(row => row.variant === 'synthetic-empty')).length,
      latencyMedianMs: quantile(correct, .50) };
  });
}
const fixed = Object.fromEntries(names.map(name => [name, summary(name, () => .60)]));
const sweep = Object.fromEntries(thresholds.map(th => [th, summary('candidate', () => th)]));
const selected = choicesFile ? JSON.parse(await readFile(choicesFile, 'utf8')) : null;
const thresholdStudy = selected ? summary('candidate', target => selected[target] ?? .60) : null;
const timing = Object.fromEntries(names.map(name => {
  const timings = results.flatMap(row => row.modes[name].workerMs);
  return [name, { batches: timings.length, windows: results.reduce((sum, row) => sum + row.modes[name].usedWindows, 0),
    batchP50Ms: quantile(timings, .50), batchP95Ms: quantile(timings, .95), totalWorkerMs: timings.reduce((sum, ms) => sum + ms, 0) }];
}));
const tracking = results.flatMap(row => row.trackerMs);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ split, fps, fixed, sweep, thresholdStudy, timing,
  trackerP50Ms: quantile(tracking, .50), trackerP95Ms: quantile(tracking, .95), errors, results }, null, 2) + '\n');
console.table(fixed.candidate);
console.log('Worker time', timing, 'tracker P50/P95', quantile(tracking, .50), quantile(tracking, .95));
if (errors.length) process.exitCode = 1;

