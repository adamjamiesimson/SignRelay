import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { launch } from './browser-common.mjs';
import { serve } from './serve.mjs';

const [sample, target = 'PLEASE', wrong = 'DRINK', random = '0'] = process.argv.slice(2);
if (!sample) throw new Error('Usage: node scripts/camera-replay.mjs <please.y4m>');
const { server, url } = await serve({ directory: process.env.GAMESHOW_BROWSER_DIST ?? 'dist' });
let browser;
try {
  browser = await launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    '--use-file-for-fake-video-capture=' + resolve(sample)] });
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  await page.addInitScript(value => { Math.random = () => value; }, Number(random));
  await page.goto(url);
  await page.getByRole('button', { name: 'Join the game', exact: true }).click();
  await page.locator('#name').fill('Replay scorer');
  await page.getByRole('button', { name: 'Add player', exact: true }).click();
  const click = name => page.getByRole('button', { name, exact: true }).click();
  const spin = () => page.locator('#wheel-copy').getByRole('button', { name: 'Spin the wheel', exact: true }).click();
  const lesson = word => page.getByRole('heading', { name: word, exact: true }).waitFor();
  await click('Host controls');
  await page.waitForFunction(() => document.querySelector('#diagnostics').textContent.includes('Model  Ready'));
  await click('Close host controls');
  await spin();
  await lesson(target);
  await click('Ready');
  if (process.env.GAMESHOW_DEBUG) {
    await click('Host controls');
    await page.getByText('Readiness and diagnostics', { exact: true }).click();
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(750);
      console.log(await page.locator('#diagnostics').innerText(), await page.locator('#feedback').textContent());
    }
    await click('Close host controls');
  }
  await page.getByRole('heading', { name: 'You signed it!', exact: true }).waitFor({ timeout: 26000 });
  assert.match(await page.locator('#result-stage').textContent(), /\+10/);
  await click('Next round');
  await spin();
  await lesson(wrong);
  await click('Ready');
  await page.getByRole('heading', { name: 'Nice try!', exact: true }).waitFor({ timeout: 26000 });
  const results = await page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('signrelay-gameshow', 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const read = req.result.transaction('session').objectStore('session').get('show');
      read.onsuccess = () => { resolve(read.result.people[0].results); req.result.close(); };
    };
  }));
  assert.deepEqual(results.map(r => [r.sign,r.method]), [[target.toLowerCase(),'automatic'], [wrong.toLowerCase(),'timeout']]);
  console.log('PASS prerecorded ' + target + ' through the real fake-camera path awarded one automatic +10; the same motion timed out for ' + wrong + '.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}

