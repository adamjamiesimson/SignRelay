import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launch } from './browser-common.mjs';
import { serve } from './serve.mjs';

const participants = Number(process.argv[2] ?? 120);
assert.ok(Number.isInteger(participants) && participants >= 100 && participants <= 500);
const browser = await launch();
const { server, url } = await serve({ directory: 'test-output/stress-site' });
const faults = [];
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  page.on('pageerror', error => faults.push(error.message));
  const browserMetrics = await browser.newBrowserCDPSession();
  const pageMetrics = await page.context().newCDPSession(page);
  async function cpu() {
    const { processInfo } = await browserMetrics.send('SystemInfo.getProcessInfo');
    return processInfo.reduce((sum, p) => sum + p.cpuTime, 0);
  }
  async function heap() {
    await pageMetrics.send('HeapProfiler.collectGarbage');
    const usage = await pageMetrics.send('Runtime.getHeapUsage');
    return Math.round(usage.usedSize / 1000) / 1000;
  }
  await page.goto(url + '/stress.html');
  await page.waitForFunction(() => !!globalThis.exercise);
  const before = await heap();
  const cpuBefore = await cpu();
  const results = await page.evaluate(count => globalThis.exercise(count), participants);
  results.browserCpuSeconds = Math.round((await cpu() - cpuBefore) * 100) / 100;
  results.jsHeapMB = { before, afterGC: await heap() };

  await page.goto(url);
  await page.waitForFunction(n => document.querySelector('#board-count').textContent === n + ' players', participants);
  await page.getByRole('button', { name: 'Full leaderboard', exact: true }).click();
  assert.equal(await page.locator('#full-board li').count(), participants);
  await page.reload();
  await page.waitForFunction(n => document.querySelector('#board-count').textContent === n + ' players', participants);
  assert.deepEqual(faults, []);
  results.uiCountAfterReload = participants;
  results.pageErrors = faults;
  await mkdir('test-output', { recursive: true });
  await writeFile('test-output/sprint2-stress.json', JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}

