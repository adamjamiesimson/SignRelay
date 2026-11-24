import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const [project, site] = process.argv.slice(2);
const valid = value => /^[a-z][a-z0-9-]{3,29}$/.test(value ?? '');
const production = new Set(['signrelay', 'signrelay-76f34']);
if (!valid(project) || !valid(site) || production.has(site) || production.has(project)) {
  throw new Error('Pass the exact independent Firebase project and GameShow site IDs. Original SignRelay project and site IDs are prohibited.');
}
const mapping = JSON.parse(await readFile('.firebaserc', 'utf8'));
const config = JSON.parse(await readFile('firebase.json', 'utf8'));
const targets = mapping.targets?.[project]?.hosting?.gameshow;
if (targets?.length !== 1 || targets[0] !== site || config.hosting.target !== 'gameshow' || config.hosting.public !== 'dist') {
  throw new Error('Firebase target gameshow must resolve only to ' + site + ' in ' + project + '.');
}
const manifest = JSON.parse(await readFile('dist/runtime.json', 'utf8'));
if (!manifest.assets.some(a => a.path === 'model/model.onnx') || !manifest.assets.some(a => a.path === 'lessons/please.mp4')) {
  throw new Error('Prepare a complete production build first.');
}
const run = args => {
  const command = process.platform === 'win32' ? 'firebase.cmd' : 'firebase';
  const processResult = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (processResult.status !== 0) throw new Error('Firebase CLI check failed. Install and authenticate Firebase CLI.');
};
run(['hosting:sites:get', site, '--project', project, '--non-interactive']);
run(['deploy', '--only', 'hosting:gameshow', '--project', project, '--non-interactive']);
const url = 'https://' + site + '.web.app/';
const online = await (await fetch(url + 'runtime.json', { signal: AbortSignal.timeout(20000), cache: 'no-store' })).json();
if (online.version !== manifest.version) throw new Error('Deployed manifest does not match the built release.');
console.log('Verified GameShow manifest at ' + url + ' · ' + online.version);

