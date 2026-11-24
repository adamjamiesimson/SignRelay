import { launch } from './browser-common.mjs';
import { serve } from './serve.mjs';

const browser = await launch();
const { server, url } = await serve();
try {
  const page = await browser.newPage();
  await page.goto(url);
  const click = name => page.getByRole('button', { name, exact: true }).click();
  await click('Toggle fullscreen');
  await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
  await click('Toggle fullscreen');
  await page.waitForFunction(() => !document.fullscreenElement);
  await click('Full leaderboard');
  await click('Fullscreen leaderboard');
  await page.waitForFunction(() =>
    document.fullscreenElement === document.documentElement &&
    document.querySelector('#leader-dialog').classList.contains('full-display'));
  await click('Fullscreen leaderboard');
  await page.waitForFunction(() => !document.fullscreenElement);
  console.log('PASS native document fullscreen and native expanded leaderboard fullscreen');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

