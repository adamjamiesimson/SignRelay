import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launch } from './browser-common.mjs';
import { serve } from './serve.mjs';

const base = process.argv[2];
if (!base) throw new Error('Usage: node scripts/upgrade-test.mjs <previous-kiosk-dist>');
const before = JSON.parse(await readFile(resolve(base, 'runtime.json'), 'utf8')).version;
const after = JSON.parse(await readFile('dist/runtime.json', 'utf8')).version;
assert.notEqual(before, after);
const browser = await launch();
let server;
try {
  const initial = await serve({ directory: base });
  server = initial.server;
  const port = server.address().port;
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  let page = await context.newPage();
  const startPage = async () => { await page.goto(initial.url); await page.locator('#wheel-stage').waitFor({ state: 'visible' }); };
  const click = name => page.getByRole('button', { name, exact: true }).click();
  const ready = async version => {
    await click('Host controls');
    await page.waitForFunction(value => document.querySelector('#diagnostics').textContent.includes('Offline  Ready') &&
      document.querySelector('#diagnostics').textContent.includes(value), version);
    await click('Close host controls');
  };
  await startPage();
  await ready(before);
  await click('Join the game');
  await page.locator('#name').fill('Upgrade test player');
  await click('Add player');
  await page.waitForFunction(() => document.querySelector('#board-count').textContent === '1 player');

  await new Promise(done => server.close(done));
  server = (await serve({ port })).server;
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting);
  await page.close();
  // Keep every controlled page closed long enough for Chromium's activation task.
  await new Promise(done => setTimeout(done, 1600));

  page = await context.newPage();
  await startPage();
  try {
    await ready(after);
  } catch (error) {
    console.error(await page.locator('#diagnostics').textContent(), await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return { active: registration.active?.state, waiting: registration.waiting?.state, caches: await caches.keys() };
    }));
    throw error;
  }
  await page.waitForFunction(() => document.querySelector('#board-count').textContent === '1 player');
  assert.match(await page.locator('#board-list .board-name').first().textContent(), /Upgrade test player/);
  await context.setOffline(true);
  await new Promise(done => server.close(done));
  await page.reload();
  await ready(after);
  await page.waitForFunction(() => document.querySelector('#board-count').textContent === '1 player');
  console.log('PASS previous kiosk ' + before + ' updated to ' + after + ' on the same origin with its IndexedDB player retained offline.');
} finally {
  await browser.close();
  if (server?.listening) await new Promise(done => server.close(done));
}

