import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';

const chrome = process.env.GAMESHOW_CHROME ??
  (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/google-chrome');
const profile = await mkdtemp(resolve(await mkdir('test-output', { recursive: true }).then(() => 'test-output'), 'profile-'));
const args = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'];
const { server, url } = await serve({ directory: process.env.GAMESHOW_BROWSER_DIST ?? 'dist' });
let context;
let page;
const pageErrors = [];
const failuresOutside = [];
const success = name => console.log('PASS ' + name);
const timeout = { timeout: 25000 };
const stage = name => page.locator('#' + name + '-stage').waitFor({ state: 'visible' });
const click = (name, scope = page) => scope.getByRole('button', { name, exact: true }).click();
const host = () => page.locator('#host');
const waitText = (selector, phrase) => page.waitForFunction(({ selector, phrase }) =>
  document.querySelector(selector)?.textContent.includes(phrase), { selector, phrase }, timeout);
const state = target => target.evaluate(() => new Promise((resolve, reject) => {
  const open = indexedDB.open('signrelay-gameshow', 1);
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const request = db.transaction('session').objectStore('session').get('show');
    request.onsuccess = () => { resolve(request.result); db.close(); };
    request.onerror = () => reject(request.error);
  };
}));
async function connect() {
  context = await chromium.launchPersistentContext(profile, { executablePath: chrome, headless: true, args,
    reducedMotion: 'reduce', viewport: { width: 1366, height: 768 }, acceptDownloads: true });
  page = context.pages()[0];
  page.setDefaultTimeout(25000);
  context.on('request', request => {
    if (!request.url().startsWith(url) && !request.url().startsWith('blob:')) failuresOutside.push(request.url());
  });
  page.on('pageerror', error => pageErrors.push(error.message));
}
async function join(name, button = 'Switch player') {
  await click(button);
  await page.locator('#name').fill(name);
  await click('Add player');
  await page.locator('#players').waitFor({ state: 'hidden' });
}
async function openHost() { await click('Host controls'); }
async function closeHost() { await click('Close host controls', host()); }
async function setManual(value) {
  await openHost();
  await page.locator('#manual').setChecked(value);
  await page.waitForFunction(async desired => {
    const database = await new Promise(resolve => {
      const request = indexedDB.open('signrelay-gameshow', 1);
      request.onsuccess = () => resolve(request.result);
    });
    return new Promise(resolve => {
      const request = database.transaction('session').objectStore('session').get('show');
      request.onsuccess = () => { resolve(request.result?.settings.manual === desired); database.close(); };
    });
  }, value);
  await closeHost();
}
async function spin() {
  await page.locator('#wheel-copy').getByRole('button', { name: 'Spin the wheel', exact: true }).click();
  await stage('teaching');
  return (await page.locator('#lesson-title').textContent()).trim();
}
async function manualRound() {
  await click('Ready');
  await stage('challenge');
  await openHost();
  await click('Confirm correct', host());
  await waitText('#host-round', '/50');
  await closeHost();
}
async function next() { await click('Next round'); await stage('wheel'); }
async function choose(label) {
  await click('Switch player');
  await page.locator('#search').fill(label);
  await page.locator('#people .person-info').first().click();
  await page.locator('#players').waitFor({ state: 'hidden' });
}

try {
  await connect();
  await page.goto(url);
  await stage('wheel');
  assert.equal(await host().isVisible(), false);
  await openHost();
  await page.locator('#host summary').getByText('Readiness and diagnostics', { exact: true }).click();
  await waitText('#diagnostics', 'Model  Ready');
  await waitText('#diagnostics', 'Offline  Ready');
  await page.locator('#sensitivity').selectOption('strict');
  await waitText('#diagnostics', 'Threshold  0.79');
  await page.locator('#sensitivity').selectOption('relaxed');
  await waitText('#diagnostics', 'Threshold  0.60');
  await closeHost();
  assert.equal(await host().isVisible(), false);
  success('discreet host panel and working sensitivity controls');
  success('real MediaPipe and ONNX workers loaded; verified offline cache');
  for (const [width,height] of [[1280,720],[1366,768],[1920,1080],[390,844]]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: 'test-output/attract-' + width + '.png' });
    const dimensions = await page.evaluate(() => [document.body.scrollWidth, innerWidth, document.documentElement.scrollHeight, innerHeight]);
    if (dimensions[2] > dimensions[3] + 3 && width > 400) console.log(await page.evaluate(() =>
      Object.fromEntries(['.shell','.masthead','.layout','.wheel-stage','.wheel-copy','.wheel-frame','.foot'].map(name => {
        const item = document.querySelector(name);
        const { width, height } = item.getBoundingClientRect();
        return [name, [Math.round(width), Math.round(height), getComputedStyle(item).minHeight]];
      }))));
    assert.ok(dimensions[0] <= dimensions[1], 'Horizontal overflow at ' + width);
    if (width > 400) assert.ok(dimensions[2] <= dimensions[3] + 3, 'Vertical overflow at ' + width + ' · ' + dimensions);
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  success('three exhibition resolutions and narrow layout');
  await click('Full leaderboard');
  await click('Fullscreen leaderboard');
  await page.waitForFunction(() => document.querySelector('#leader-dialog').classList.contains('full-display'));
  await click('Fullscreen leaderboard');
  await page.waitForFunction(() => !document.querySelector('#leader-dialog').classList.contains('full-display'));
  await click('Close leaderboard');
  success('expanded leaderboard opens and returns to gameplay');
  await join('Alex', 'Join the game');
  await setManual(true);
  const signs = [];
  for (let i = 0; i < 2; i++) {
    signs.push(await spin());
    await page.locator('#lesson-video').evaluate(video => {
      if (video.readyState >= 2) return;
      return new Promise(resolve => video.addEventListener('loadeddata', resolve, { once: true }));
    });
    if (!i) await page.screenshot({ path: 'test-output/lesson.png' });
    await manualRound();
    await stage('result');
    await next();
  }
  await join('Alex');
  await choose('#001');
  assert.equal((await state(page)).people[0].results.length, 2);
  assert.equal((await state(page)).people[1].results.length, 0);
  success('same-name identities, drop-in switching, and two-round resume');
  for (let i = 2; i < 5; i++) {
    signs.push(await spin());
    await manualRound();
    if (i < 4) {
      await stage('result');
      if (i === 2) {
        await waitText('#result-stage', '3-SIGN STREAK');
        await page.screenshot({ path: 'test-output/streak.png' });
      }
      await next();
    }
  }
  await stage('completion');
  await waitText('#completion-stage', 'Perfect game!');
  assert.equal(new Set(signs).size, 5);
  assert.equal((await state(page)).people[0].results.filter(r => r.method === 'manual').length, 5);
  await page.reload();
  await stage('completion');
  await waitText('#completion-stage', 'Perfect game!');
  success('five unique rounds, manual provenance, streak and 50/50 survive reload');
  await choose('#002');
  await page.clock.install();
  const pendingWord = await spin();
  await click('Ready');
  await stage('challenge');
  await page.clock.fastForward(3100);
  await openHost();
  await click('Pause', host());
  await closeHost();
  const paused = (await state(page)).people[1].pending;
  assert.ok(paused.remaining < 18_000 && paused.remaining > 14_000);
  await page.reload();
  await stage('challenge');
  const afterReload = (await state(page)).people[1].pending;
  assert.equal(afterReload.remaining, paused.remaining);
  assert.equal(await page.locator('#challenge-title').textContent(), pendingWord);
  await click('Resume');
  await stage('challenge');
  const running = (await state(page)).people[1].pending;
  assert.equal(typeof running.run, 'string');
  await page.reload();
  await page.getByRole('button', { name: 'Resume', exact: true }).waitFor();
  assert.equal((await state(page)).people[1].pending.remaining, 20000);
  await openHost();
  await click('Skip round', host());
  await click('Skip round', page.locator('#confirm'));
  await closeHost();
  await stage('wheel');
  assert.equal((await state(page)).people[1].results.length, 0);
  success('paused resume, interrupted active round recovery and skip preserve a round');
  for (let i = 0; i < 5; i++) {
    await spin();
    await click('Ready');
    await stage('challenge');
    await page.clock.fastForward(21_000);
    await stage(i === 4 ? 'completion' : 'result');
    if (i < 4) await next();
  }
  const zero = (await state(page)).people[1];
  assert.equal(zero.results.filter(r => r.method === 'timeout').length, 5);
  await waitText('#completion-stage', '0 / 50');
  success('five genuine timer expirations award zero');
  await join('<b>Display test</b>');
  assert.equal(await page.locator('.board-row .board-name b').count(), 0);
  await click('Full leaderboard');
  await page.locator('#full-board .board-row').first().waitFor();
  assert.deepEqual(await page.locator('#full-board .rank').allTextContents(), ['1','2','2']);
  await click('Close leaderboard');
  success('safe display names and shared competition ranks');
  await openHost();
  await host().getByText('Session and backups', { exact: true }).click();
  const backup = page.waitForEvent('download');
  await click('Export JSON', host());
  const exported = await backup;
  const saved = resolve('test-output/browser-session.backup.json');
  await exported.saveAs(saved);
  const csv = page.waitForEvent('download');
  await click('Export CSV', host());
  assert.match((await csv).suggestedFilename(), /\.csv$/);
  await click('Reset session', host());
  await click('Cancel', page.locator('#confirm'));
  assert.equal((await state(page)).people.length, 3);
  await click('Reset session', host());
  await click('Reset session', page.locator('#confirm'));
  await page.locator('#host').waitFor({ state: 'hidden' });
  assert.equal((await state(page)).people.length, 0);
  await openHost();
  await page.locator('#backup-file').setInputFiles(saved);
  await click('Restore backup', page.locator('#confirm'));
  await page.waitForFunction(() => document.querySelector('#board-count').textContent === '3 players');
  await closeHost();
  success('JSON/CSV export, confirmed reset, and restored backup');
  await setManual(false);
  await spin();
  await page.evaluate(() => {
    const getMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      navigator.mediaDevices.getUserMedia = getMedia;
      throw new DOMException('Simulated permission denial', 'NotAllowedError');
    };
  });
  await click('Ready');
  await waitText('#lesson-copy', 'Camera permission is blocked');
  assert.equal((await state(page)).people.at(-1).pending.deadline, null);
  success('simulated camera permission denial leaves the clock stopped');
  await click('Ready');
  await stage('challenge');
  await page.waitForFunction(() => document.querySelector('#camera').srcObject?.active);
  await page.screenshot({ path: 'test-output/challenge.png' });
  await page.locator('#camera').evaluate(video => video.srcObject.getVideoTracks()[0].stop());
  await page.waitForFunction(() => document.querySelector('#camera').srcObject?.getVideoTracks()[0]?.readyState === 'live');
  await openHost();
  await click('Pause', host());
  await closeHost();
  success('fake camera stream and automatic recovery after track stops');
  // Reopen the same saved Chrome profile, then sever the browser and the loopback server.
  await context.close();
  await connect();
  await page.goto(url);
  await stage('challenge');
  await openHost();
  await host().getByText('Readiness and diagnostics', { exact: true }).click();
  await waitText('#diagnostics', 'Offline  Ready');
  await closeHost();
  await context.setOffline(true);
  await new Promise(resolve => server.close(resolve));
  await page.reload();
  await stage('challenge');
  assert.equal((await state(page)).people.length, 3);
  await openHost();
  await host().getByText('Readiness and diagnostics', { exact: true }).click();
  await waitText('#diagnostics', 'Model  Ready');
  await waitText('#diagnostics', 'Offline  Ready');
  await closeHost();
  await join('Offline Player');
  await spin();
  await page.waitForFunction(() => document.querySelector('#lesson-video').readyState >= 2);
  await click('Ready');
  await stage('challenge');
  await page.waitForFunction(() => document.querySelector('#camera').srcObject?.active);
  success('browser restart, server stopped, browser network offline, lesson and live tracking still work');
  for (let i = 0; i < 12; i++) await choose(i % 2 ? '#004' : '#003');
  assert.equal(await page.locator('#camera').evaluate(video => video.srcObject), null);
  assert.equal((await state(page)).people[3].pending.ready, true);
  success('rapid offline switches preserve the round and release the camera stream');
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(failuresOutside, []);
  success('no page exceptions or external runtime requests');
} finally {
  await context?.close();
  if (server.listening) await new Promise(resolve => server.close(resolve));
}

