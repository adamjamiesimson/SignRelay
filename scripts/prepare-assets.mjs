import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const from = process.argv[2];
const pinFile = resolve(root, 'asset-pins.json');
const pins = JSON.parse(await readFile(pinFile, 'utf8'));
for (const asset of pins) {
  const destination = resolve(root, 'public', asset.path);
  let bytes = await readFile(destination).catch(() => null);
  if (!bytes && from && asset.upstream) bytes = await readFile(resolve(from, asset.upstream)).catch(() => null);
  if (!bytes) {
    if (!asset.url) throw new Error('Missing versioned asset ' + asset.path);
    const response = await fetch(asset.url, { signal: AbortSignal.timeout(90000) });
    if (!response.ok) throw new Error(asset.path + ' download failed: ' + response.status);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error(asset.path + ' failed SHA-256 verification');
  await mkdir(resolve(destination, '..'), { recursive: true });
  await writeFile(destination, bytes);
  console.log('Verified ' + asset.path);
}

