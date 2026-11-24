import { access } from 'node:fs/promises';
import { chromium } from 'playwright-core';

export async function launch(extra = {}) {
  const candidates = [process.env.GAMESHOW_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
  let executablePath;
  for (const candidate of candidates) {
    if (await access(candidate).then(() => true, () => false)) { executablePath = candidate; break; }
  }
  return chromium.launch({ executablePath, headless: true, ...extra });
}

