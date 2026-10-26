// Optional-analytics consent in a real browser: no Google request before
// consent or after rejection, exactly one script request after Allow, and
// withdrawal and privacy signals turn it off again. Google's hosts are
// intercepted and answered locally, so nothing reaches Google.
// Needs an export built with the placeholder ID (never deploy it):
//   npm run build:worker && NEXT_PUBLIC_GA_MEASUREMENT_ID=G-SMOKETEST1 npx next build && node scripts/secure-export.mjs
//   node tests/consent-smoke.mjs /path/to/chrome
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { startChrome } from "../scripts/diagnostics/chrome-session.mjs";

const executable = process.argv[2];
if (!executable) throw new Error("Usage: node tests/consent-smoke.mjs <chrome>");
const ID = "G-SMOKETEST1";
const built = execFileSync("grep", ["-rl", ID, "out/_next/static"], { encoding: "utf8" }).trim();
if (!built) throw new Error(`out/ was not built with NEXT_PUBLIC_GA_MEASUREMENT_ID=${ID}`);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, reason, attempts = 100) {
  for (let i = 0; i < attempts; i++) { if (await check()) return; await pause(100); }
  throw new Error(reason);
}
const port = 18900 + Math.floor(Math.random() * 90), origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["scripts/serve-export.mjs", "--host", "127.0.0.1", "--port", String(port)], { stdio: "ignore" });
await until(async () => { try { return (await fetch(origin)).ok; } catch { return false; } }, "No static server");
const checks = [];

async function session({ signal = false } = {}) {
  const browser = await startChrome(executable);
  const google = [];
  browser.onEvent(message => {
    if (message.method !== "Fetch.requestPaused") return;
    const { requestId, request } = message.params;
    google.push(request.url);
    void browser.send("Fetch.fulfillRequest", { requestId, responseCode: 200, body: Buffer.from("/* analytics stub */").toString("base64"),
      responseHeaders: [{ name: "Content-Type", value: "text/javascript" }] }).catch(() => {});
  });
  await browser.send("Fetch.enable", { patterns: [{ urlPattern: "*googletagmanager.com*" }, { urlPattern: "*google-analytics.com*" }, { urlPattern: "*analytics.google.com*" }] });
  if (signal) await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: "Object.defineProperty(navigator, 'globalPrivacyControl', { get: () => true });" });
  const open = async (path = "/") => {
    await browser.send("Page.navigate", { url: `${origin}${path}` });
    await until(() => browser.evaluate("document.readyState === 'complete' && !!document.querySelector('.footer-link-button') && Object.keys(document.querySelector('.footer-link-button')).some(k => k.startsWith('__react'))"), `${path} did not hydrate`);
    await pause(400);
  };
  const click = text => browser.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!b) throw new Error('Missing ' + ${JSON.stringify(text)}); b.click(); })()`);
  const banner = () => browser.evaluate("!!document.querySelector('.consent-banner')");
  const consent = () => browser.evaluate("JSON.parse(localStorage.getItem('signrelay.analytics-consent.v1') || 'null')?.choice ?? null");
  return { browser, google, open, click, banner, consent };
}

try {
  {
    const s = await session();
    // Before any choice: a notice with equal choices, and no Google request.
    await s.open("/privacy?transcript=secret");
    await until(s.banner, "No consent notice although optional analytics is configured");
    const actions = await s.browser.evaluate("[...document.querySelectorAll('.consent-actions button')].map(b => ({ text: b.textContent, className: b.className, w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) }))");
    assert.deepEqual(actions.map(a => a.text), ["Reject", "Allow"]);
    assert.equal(actions[0].className, actions[1].className, "Reject and Allow are styled differently");
    assert.equal(actions[0].h, actions[1].h);
    await pause(800);
    assert.deepEqual(s.google, [], "Google was contacted before consent");
    checks.push({ check: "before a choice: notice shown, Reject and Allow equally prominent, no Google request" });

    // Reject: nothing loads, now or after a reload.
    await s.click("Reject");
    await until(async () => !(await s.banner()), "The notice stayed after Reject");
    assert.equal(await s.consent(), "rejected");
    await s.open("/");
    assert.equal(await s.banner(), false, "The notice returned after Reject");
    assert.deepEqual(s.google, [], "Google was contacted after Reject");
    checks.push({ check: "Reject: no notice afterwards and no Google request, also after a reload" });

    // Allow from Cookie choices: one script request; the page view carries no query string.
    await s.open("/privacy?transcript=secret");
    await s.click("Cookie choices");
    await until(() => s.browser.evaluate("document.querySelector('dialog.privacy-modal')?.open && /It is off/.test(document.querySelector('dialog.privacy-modal').textContent)"), "Cookie choices did not show analytics as off");
    await s.click("Allow analytics");
    await until(() => s.google.length > 0, "Allow did not load analytics");
    await pause(500);
    assert.equal(s.google.filter(url => url.includes("/gtag/js")).length, 1, "The analytics script loaded more than once");
    assert.ok(s.google[0].startsWith(`https://www.googletagmanager.com/gtag/js?id=${ID}`));
    const views = await s.browser.evaluate("JSON.stringify((window.dataLayer || []).map(entry => Array.from(entry)).filter(entry => entry[1] === 'page_view'))");
    assert.match(views, /"page_location":"https:\/\/signrelay\.web\.app\/privacy"/);
    assert.doesNotMatch(views, /secret|transcript/, "The page view included the query string");
    checks.push({ check: "Allow: exactly one gtag script request; the page view has no query string" });

    // Withdraw: analytics cookies removed, the page reloads without analytics.
    await s.browser.evaluate("document.cookie = '_ga=GA1.1.test; Path=/'; document.cookie = '_ga_SMOKETEST1=GS1.1.test; Path=/'");
    const before = s.google.length;
    await s.click("Cookie choices");
    await until(() => s.browser.evaluate("/It is on/.test(document.querySelector('dialog.privacy-modal')?.textContent ?? '')"), "Cookie choices did not show analytics as on");
    await s.click("Turn off analytics");
    await until(() => s.browser.evaluate("document.readyState === 'complete' && !document.getElementById('signrelay-analytics')"), "Withdrawal did not reload without analytics", 200);
    await pause(800);
    assert.equal(await s.consent(), "rejected");
    assert.doesNotMatch(await s.browser.evaluate("document.cookie"), /_ga/, "Analytics cookies survived withdrawal");
    assert.equal(s.google.length, before, "Google was contacted after withdrawal");
    checks.push({ check: "withdrawal: consent recorded as rejected, _ga cookies removed, no further Google requests" });
    await s.browser.close();
  }
  {
    // Global Privacy Control: no notice, no Allow, no request.
    const s = await session({ signal: true });
    await s.open("/");
    assert.equal(await s.banner(), false, "A consent notice appeared despite Global Privacy Control");
    await s.click("Cookie choices");
    await until(() => s.browser.evaluate("/privacy signal/.test(document.querySelector('dialog.privacy-modal')?.textContent ?? '')"), "The dialog did not mention the privacy signal");
    assert.equal(await s.browser.evaluate("[...document.querySelectorAll('dialog.privacy-modal button')].some(b => /Allow/.test(b.textContent))"), false, "Analytics can be allowed despite the privacy signal");
    assert.deepEqual(s.google, [], "Google was contacted despite Global Privacy Control");
    checks.push({ check: "Global Privacy Control: no notice, no way to allow, no Google request" });
    await s.browser.close();
  }
  console.log(JSON.stringify({ passed: true, checks, environment: `headless Chromium, export built with placeholder ${ID}; Google hosts answered locally` }));
} finally { server.kill(); }
