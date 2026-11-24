import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const revision = process.argv[2] ?? 'HEAD';
if (!/^(HEAD|[a-f0-9]{7,64})$/.test(revision)) throw new Error('Use HEAD or a hexadecimal commit ID.');
const git = (...args) => execFileSync('git', args, { maxBuffer: 16_000_000 });
const blob = path => git('show', revision + ':' + path);
const read = path => blob(path).toString('utf8');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const paths = git('ls-tree', '-rz', '--name-only', revision).toString('utf8').split('\0').filter(Boolean);

const forbidden = /(?:^|\/)(?:\.env(?:\.[^/]+)?|\.firebaserc|\.firebase|\.gitmodules|\.github|node_modules|dist|test-output|.*\.backup\.json|.*\.(?:y4m|mov|webm|pem|pfx|p12|key|zip|onnx|task|wasm))$/i;
assert.deepEqual(paths.filter(path => forbidden.test(path)), [], 'Unexpected sensitive or generated paths');
assert.ok(paths.every(path => /^(?:public|scripts|src|docs|tests)\//.test(path) ||
  ['.gitattributes', '.gitignore', 'README.md', 'asset-pins.json', 'firebase.json', 'vercel.json', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'].includes(path)),
  'Unexpected path outside standalone GameShow');
const manifest = JSON.parse(read('public/lesson-credits.json'));
assert.equal(manifest.length, 10);
const clips = manifest.map(chapter => {
  assert.match(chapter.source, /^https:\/\/signdata\.cc\.gatech\.edu\/data\/popsign_v2_1\/game\/(?:val|test|train)\//);
  assert.equal(chapter.license, 'CC BY 4.0');
  const path = 'public/lessons/' + chapter.word.toLowerCase() + '.mp4';
  assert.equal(sha(blob(path)), chapter.sha256, 'Unverified lesson ' + path);
  return path;
});
assert.deepEqual(paths.filter(path => /\.(mp4|avi|mkv|wav|mp3|png|jpe?g|gif)$/i.test(path)).sort(), clips.sort());
assert.deepEqual(paths.filter(path => /\.(ttf|woff2?|webp)$/i.test(path)).sort(), [
  'public/brand/outfit-variable.ttf', 'public/brand/signrelay-mark.webp',
]);
assert.equal(sha(blob('public/brand/outfit-variable.ttf')), 'fc7287273e66929776e2ba54f144fe699080bec29f61bf649d70d871468aeade');
assert.equal(sha(blob('public/brand/signrelay-mark.webp')), '7d9ef5ab54c36ebfdde262defff78f2e6e90163ce785a30d9ef820d83d42920c');
assert.match(read('public/brand/LICENSE-Outfit.txt'), /SIL Open Font License/);
assert.equal(JSON.parse(read('vercel.json')).git.deploymentEnabled, false);
assert.equal(JSON.parse(read('firebase.json')).hosting.target, 'gameshow');
const tokenPatterns = [
  /\b(?:gh[pousr]_[a-z0-9]{25,}|github_pat_[a-z0-9_]{25,}|AIza[0-9A-Za-z_-]{35}|AKIA[A-Z0-9]{16})\b/i,
  /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
  /https:\/\/[^:/\s]{3,}:[^@/\s]{5,}@/,
];
const suspect = [];
for (const path of paths.filter(path => /\.(mjs|js|json|yaml|html|css|md)$/.test(path))) {
  const source = read(path);
  if (tokenPatterns.some(pattern => pattern.test(source))) suspect.push(path);
  if (path.startsWith('docs/replay-') && path.endsWith('.json')) {
    const evidence = JSON.parse(source);
    const rows = Array.isArray(evidence) ? evidence : evidence.results ?? evidence.clips ?? [];
    assert.ok(rows.every(row => !row.source || row.source.startsWith('https://signdata.cc.gatech.edu/data/popsign_v2_1/')));
  }
}
assert.deepEqual(suspect, [], 'Potential credentials in release');
console.log('PASS ' + paths.length + ' tracked paths · ten pinned public lessons · no private media, backups, deployment credentials, or known secret signatures');

