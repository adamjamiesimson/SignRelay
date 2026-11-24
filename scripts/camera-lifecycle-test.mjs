import assert from 'node:assert/strict';
import { launch } from './browser-common.mjs';
import { serve } from './serve.mjs';

const browser = await launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const { server, url } = await serve();
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const workers = new Set();
  let workerStarts = 0;
  page.on('worker', worker => {
    workerStarts++;
    workers.add(worker);
    worker.on('close', () => workers.delete(worker));
  });
  const click = name => page.getByRole('button', { name, exact: true }).click();
  const host = () => click('Host controls');
  const close = () => click('Close host controls');
  const cameraActive = () => page.waitForFunction(() => document.querySelector('#camera').srcObject?.active);
  await page.goto(url);
  await click('Join the game');
  await page.locator('#name').fill('Lifecycle check');
  await click('Add player');
  await page.locator('#wheel-copy button[data-action=spin]').click();
  await click('Ready');
  await cameraActive();
  const memory = () => page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
  const first = await memory();
  const began = performance.now();
  for (let i = 0; i < 18; i++) {
    await host();
    await click('Pause');
    await close();
    await page.waitForFunction(() => document.querySelector('#camera').srcObject === null);
    await click('Resume');
    await cameraActive();
    assert.equal(await page.locator('#camera').evaluate(video => video.srcObject.getVideoTracks().length), 1);
    if ((i + 1) % 6 === 0) {
      await host();
      await click('Restart round');
      await page.locator('#confirm').getByRole('button', { name: 'Restart round', exact: true }).click();
      await close();
      await click('Ready');
      await cameraActive();
    }
  }
  assert.equal(workerStarts, 2);
  assert.equal(workers.size, 2);
  const last = await memory();
  console.log('PASS 18 pause/resume cycles, three restarts, one live track and two reused workers over ' +
    ((performance.now() - began) / 1000).toFixed(1) + ' seconds.');
  if (first && last) console.log('Chrome main-thread JS heap estimates ' + first + ' → ' + last + ' bytes.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

