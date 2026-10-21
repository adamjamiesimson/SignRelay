// Strict offline demo check. Three layers:
//  1. enforcement: Chrome goes through a local deny-all proxy, so nothing leaves;
//  2. attribution: every request from the page and from every worker it starts
//     (auto-attached over DevTools) must be loopback, data: or blob:;
//  3. the proxy log may contain only hosts that idle headless Chrome contacts on
//     about:blank by itself (sign-in, GCM, connectivity). Any other host fails. Runs the ASL demo path end to end with
// a synthetic fake camera (no hands); it proves offline operation, not accuracy.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { startChrome } from "../scripts/diagnostics/chrome-session.mjs";

const executable = process.argv[2];
// --self-test plants an outbound fetch in the page and in a worker and passes only if both are caught.
const selfTest = process.argv.includes("--self-test");
if (!executable) throw new Error("Usage: node tests/offline-demo-strict-smoke.mjs <chrome> (after npm run demo:prepare)");
const port = 18400 + Math.floor(Math.random() * 400), origin = `http://127.0.0.1:${port}`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, reason, attempts = 600) {
  for (let i = 0; i < attempts; i++) { if (await check()) return; await pause(100); }
  throw new Error(reason);
}
const loopback = url => { try { const { protocol, hostname } = new URL(url); return ["data:", "blob:", "about:", "chrome:", "devtools:"].includes(protocol) || ["127.0.0.1", "localhost", "[::1]"].includes(hostname); } catch { return false; } };

// Browser-initiated services only. Page and worker requests are still captured
// over CDP, and the deny-all proxy still refuses every outbound tunnel.
export const QUIET_CHROME = ["--disable-background-networking", "--disable-component-update", "--disable-sync", "--disable-default-apps", "--no-pings",
  "--disable-domain-reliability", "--disable-client-side-phishing-detection", "--disable-breakpad", "--no-default-browser-check",
  "--disable-features=AutofillServerCommunication,OptimizationHints,OptimizationGuideModelDownloading,MediaRouter,Translate,NetworkTimeServiceQuerying,SafeBrowsing,InterestFeedContentSuggestions,CertificateTransparencyComponentUpdater,SignInProfileCreation,AccountConsistency"];
// Tunnels the browser process itself opens, which the deny-all proxy refuses.
// Measured with an about:blank tab only: the first three on Chromium 141
// headless; www.gstatic.com and update.googleapis.com on the CI runner's
// branded Google Chrome even with QUIET_CHROME. This list never excuses a page
// or worker request: those are checked separately over CDP, and the self-test
// plants a page request to one of these hosts to prove it is still caught.
export const BROWSER_INTERNAL_HOSTS = new Set(["www.google.com:443", "accounts.google.com:443", "android.clients.google.com:443",
  "www.gstatic.com:443", "update.googleapis.com:443"]);
const outbound = [];
const deny = createServer((request, response) => { outbound.push(`${request.method} ${request.url}`); response.writeHead(403); response.end(); });
// Chrome may reset a refused tunnel; a reset socket is expected, not a test failure.
deny.on("connect", (request, socket) => { socket.on("error", () => {}); outbound.push(`CONNECT ${request.url}`); socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"); });
deny.on("clientError", (_error, socket) => socket.destroy());
await new Promise(resolve => deny.listen(0, "127.0.0.1", resolve));
const server = spawn(process.execPath, ["scripts/serve-export.mjs", "--host", "127.0.0.1", "--port", String(port)], { stdio: "ignore" });
let browser;
try {
  await until(async () => { try { return (await fetch(origin)).ok; } catch { return false; } }, "No static server");
  const manifest = await (await fetch(`${origin}/runtime-manifest.json`)).json();
  assert.equal(manifest.profile, "asl-demo", "Serve the ASL demo export (npm run demo:prepare)");
  // Chrome's own background services (sync, autofill, component updates, time
  // queries) are switched off so the proxy log measures only what SignRelay does.
  browser = await startChrome(executable, { proxy: `http://127.0.0.1:${deny.address().port}`, extraArgs: QUIET_CHROME });
  const pageRequests = [], workers = [];
  browser.onEvent(message => {
    if (message.method === "Network.requestWillBeSent") pageRequests.push(message.params.request.url);
    if (message.method === "Target.attachedToTarget") {
      const { sessionId, targetInfo } = message.params;
      workers.push(targetInfo.url);
      void browser.send("Network.enable", {}, sessionId).catch(() => {})
        .then(() => browser.send("Runtime.runIfWaitingForDebugger", {}, sessionId)).catch(() => {});
    }
  });
  await browser.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  const evaluate = browser.evaluate;
  const click = text => evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}); if(!b||b.disabled) throw new Error('Missing button '+${JSON.stringify(text)}); b.click(); })()`);
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { window.__qaTracks = [];
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async options => { const stream = await get(options); window.__qaTracks.push(...stream.getTracks()); return stream; }; })();` });
  // The export's CSP would already stop a planted fetch; the self-test bypasses it
  // so the leak reaches the network layer, as it would after a CSP regression.
  if (selfTest) await browser.send("Page.setBypassCSP", { enabled: true });
  await browser.send("Page.navigate", { url: `${origin}/?perf` });
  await until(() => evaluate("Object.keys(document.querySelector('[role=radio]') ?? {}).some(k=>k.startsWith('__reactFiber'))"), "Welcome screen did not hydrate");
  const visited = ["/"];
  await click("Start translating");
  await until(() => evaluate("document.querySelector('.status-badge')?.textContent === 'Active'"), "ASL vision did not start offline");
  // Long enough for one full 5 s throughput window after the first readout tick.
  await pause(6500);
  const perf = await evaluate("document.querySelector('[data-perf]')?.textContent");
  const throughputWarning = await evaluate("document.querySelector('[data-perf-warning]')?.textContent ?? null");
  const status = await evaluate("document.querySelector('.recognition-state')?.textContent.trim()");
  await click("Pause camera");
  await until(() => evaluate("window.__qaTracks.length > 0 && window.__qaTracks.every(t => t.readyState === 'ended')"), "Camera tracks were not released");
  for (const path of ["/languages", "/models", "/privacy"]) {
    await browser.send("Page.navigate", { url: `${origin}${path}` });
    await until(() => evaluate("document.readyState === 'complete'"), `${path} did not load`);
    visited.push(path);
  }
  if (selfTest) await evaluate(`(() => { fetch('https://example.org/signrelay-self-test').catch(() => {});
    fetch('https://www.gstatic.com/signrelay-self-test').catch(() => {});
    new Worker(URL.createObjectURL(new Blob(["fetch('https://cdn.jsdelivr.net/npm/signrelay-self-test').catch(() => {})"], { type: "text/javascript" }))); })()`);
  await pause(1500);
  const leaked = pageRequests.filter(url => !loopback(url));
  if (selfTest) {
    assert.ok(leaked.includes("https://example.org/signrelay-self-test"), "Self-test: page leak was not detected");
    assert.ok(leaked.includes("https://cdn.jsdelivr.net/npm/signrelay-self-test"), "Self-test: worker leak was not detected");
    assert.ok(leaked.includes("https://www.gstatic.com/signrelay-self-test"), "Self-test: a page request to a browser-internal host was excused");
    assert.ok(outbound.some(line => line.includes("example.org")), "Self-test: the deny proxy did not see the page leak");
    console.log(JSON.stringify({ self_test: "passed", detected: leaked, refused_by_proxy: outbound.filter(line => !BROWSER_INTERNAL_HOSTS.has(line.replace(/^CONNECT /, ""))) }));
    process.exitCode = 0;
  } else {
  assert.deepEqual(leaked, [], `The page requested non-loopback URLs: ${leaked.join(", ")}`);
  const unexplained = outbound.filter(line => !BROWSER_INTERNAL_HOSTS.has(line.replace(/^CONNECT /, "")));
  assert.deepEqual(unexplained, [], `Outbound connections were attempted: ${unexplained.join(", ")}`);
  assert.ok(workers.some(url => url.includes("recognition.worker.js")), "The recognition worker was not observed, so its requests were not checked");
  assert.match(perf ?? "", /assets self-hosted/, "The ?perf readout must confirm self-hosted assets");
  assert.match(perf ?? "", /recognition running, 0 recoveries · hand tracked in 0% of frames/, "Recognition restarted, or the readout lost its worker and tracking fields");
  assert.equal(status, "waiting for hands");
  console.log(JSON.stringify({ passed: true, profile: manifest.profile, recognition_worker_sha256: manifest.recognition_worker_sha256,
    pages: visited, page_and_worker_requests: pageRequests.length, workers_observed: [...new Set(workers.map(url => new URL(url).pathname))],
    non_loopback_requests: 0, refused_browser_internal: [...new Set(outbound)], perf_readout: perf,
    // Headless frame rates say nothing about the demo laptop; recorded, not asserted.
    throughput_warning: throughputWarning,
    environment: "headless Chromium behind a deny-all proxy, synthetic fake camera (no hands); proves offline operation only" }));
  }
} catch (error) {
  console.error(JSON.stringify({ outbound, errors: browser?.errors?.slice(-10) }));
  throw error;
} finally { await browser?.close(); server.kill(); deny.close(); }
