import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const [input = 'docs/replay-cohort.json', path = 'test-output/fixtures'] = process.argv.slice(2);
const ffmpeg = process.env.GAMESHOW_FFMPEG || 'ffmpeg';
const out = resolve(path);
const rows = JSON.parse(await readFile(input, 'utf8'));
const digest = b => createHash('sha256').update(b).digest('hex');
const publisher = 'https://signdata.cc.gatech.edu/data/popsign_v2_1/game/';
await mkdir(out, { recursive: true });
for (const row of rows) {
  if (!row.source.startsWith(publisher) || !/^[a-z]+-(val|test)-(?:new)?\d+\.mp4$/.test(row.file)) throw new Error('Unexpected replay row');
  const file = resolve(out, row.file);
  const raw = file + '.raw.mp4';
  const present = await readFile(file).catch(() => null);
  if (present && digest(present) === row.sha256) continue;
  let response = await fetch(row.source, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) response = await fetch(row.source + '/', { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error('Download failed: ' + row.source + ' · ' + response.status);
  await writeFile(raw, Buffer.from(await response.arrayBuffer()));
  try {
    await promisify(execFile)(ffmpeg, ['-loglevel', 'error', '-y', '-i', raw, '-map', '0:v:0', '-an',
      '-vf', 'scale=480:480:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=24',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '24', '-movflags', '+faststart', file]);
  } finally {
    await unlink(raw);
  }
  if (digest(await readFile(file)) !== row.sha256) throw new Error('Replay file differs from evidence; use the recorded FFmpeg encoder version: ' + row.file);
  console.log('Verified ' + row.file);
}
await writeFile(resolve(out, 'cohort.json'), JSON.stringify(rows, null, 2) + '\n');

