import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, extname, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { cpus, platform, arch } from 'node:os';
import { startChrome } from './chrome-session.mjs';

// Run from the repository root. This only starts an isolated local browser.
const { values } = parseArgs({ options: {
  chrome: { type: 'string' }, baseline: { type: 'string', default: 'HEAD' },
  'vision-assets': { type: 'string', default: 'public' },
  'phases-only': { type: 'boolean', default: false },
  'cpu-profile': { type: 'boolean', default: false },
  out: { type: 'string', default: 'work/tracking-benchmark-results.json' },
} });
if (!values.chrome) throw new Error('Pass --chrome with the Chrome executable path.');
const assets = resolve(values['vision-assets']);
await mkdir('work', { recursive: true });
await mkdir('public/workers', { recursive: true });
const baseline = execFileSync('git', ['show', `${values.baseline}:lib/vision-engine.ts`], { encoding: 'utf8' });
await build({ stdin: { contents: baseline, resolveDir: resolve('lib'), loader: 'ts' },
  bundle: true, format: 'esm', platform: 'browser', target: 'es2020', preserveSymlinks: true, outfile: 'work/vision-engine.baseline.js' });
await build({ entryPoints: ['workers/vision.worker.ts'], bundle: true, format: 'iife', platform: 'browser', target: 'es2020', preserveSymlinks: true, outfile: 'public/workers/vision.worker.js' });
await build({ entryPoints: ['workers/recognition.worker.ts', 'workers/template-matching.worker.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2020', preserveSymlinks: true, outdir: 'public/workers' });
await build({ entryPoints: ['scripts/diagnostics/tracking-benchmark-browser.mjs'], bundle: true, format: 'esm', platform: 'browser', target: 'es2020', preserveSymlinks: true, outfile: 'work/tracking-benchmark.js' });
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<script type="module" src="/bench.js"></script>'); return; }
  const base = url.pathname.startsWith('/vision/') ? assets : resolve('public');
  const path = url.pathname === '/bench.js' ? resolve('work/tracking-benchmark.js') : resolve(base, '.' + url.pathname);
  if (path !== resolve('work/tracking-benchmark.js') && !path.startsWith(base + sep)) { res.writeHead(403).end(); return; }
  try { res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream'); res.end(await readFile(path)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
let browser;
try {
  browser = await startChrome(values.chrome, { proxy: null });
  const metadata = { baseline: values.baseline, date: new Date().toISOString(), cpu: cpus()[0]?.model, platform: platform(), arch: arch(), browser: await browser.send('Browser.getVersion') };
  await browser.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  for (let i = 0; i < 100 && !await browser.evaluate('typeof window.runBenchmark === "function"'); i++) await new Promise(r => setTimeout(r, 100));
  const results = [];
  for (const mode of values['phases-only'] ? [] : ['baseline', 'worker-cpu', 'candidate']) {
    try { results.push(await browser.evaluate(`window.runBenchmark(${JSON.stringify(mode)})`)); }
    catch (error) { results.push({ mode, error: String(error), engine: await browser.evaluate('window.benchEngine') }); }
    console.log(JSON.stringify(results.at(-1)));
    await writeFile(values.out, JSON.stringify({ metadata, results, errors: browser.errors }, null, 2));
  }
  const phases = await browser.evaluate('window.runRecognitionBenchmark()');
  console.log(JSON.stringify(phases));
  let cpuProfile;
  if (values['cpu-profile']) {
    // Separate warm run: profiling overhead never changes the timing samples.
    await browser.send('Profiler.enable');
    await browser.send('Profiler.start');
    const elapsedMs = await browser.evaluate('window.profileAslInference()');
    const { profile } = await browser.send('Profiler.stop');
    cpuProfile = { elapsedMs, runs: 5, sampleCount: profile.samples?.length ?? 0,
      topSelfSamples: profile.nodes.filter(n => n.hitCount).sort((a, b) => b.hitCount - a.hitCount).slice(0, 15)
        .map(n => ({ function: n.callFrame.functionName || '(anonymous)', samples: n.hitCount })),
      note: 'Separate five warm ASL computations, sampling-profiler overhead included; no inference algorithm or thresholds changed.' };
  }
  await writeFile(values.out, JSON.stringify({ metadata, results, phases, cpuProfile, errors: browser.errors }, null, 2));
} finally { await browser?.close(); server.close(); }
