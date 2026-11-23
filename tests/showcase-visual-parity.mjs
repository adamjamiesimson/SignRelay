// Compare local exports of the same build profile with one Chromium executable.
// node tests/showcase-visual-parity.mjs /usr/bin/chromium /path/to/base /path/to/candidate
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { startChrome } from "../scripts/diagnostics/chrome-session.mjs";

const [executable, referenceDir, candidateDir] = process.argv.slice(2);
assert(executable && referenceDir && candidateDir, "Supply Chromium executable and both export checkout directories");
const remote = value => /^https?:\/\//.test(value);
const profile = async checkout => remote(checkout)
  ? (await (await fetch(`${checkout}/runtime-manifest.json`)).json()).profile
  : JSON.parse(await readFile(resolve(checkout, "out/runtime-manifest.json"), "utf8")).profile;
assert.equal(await profile(candidateDir), await profile(referenceDir), "Compare two exports of the same build profile");
const artifactDir = resolve("outputs/showcase-visual-parity");
await mkdir(artifactDir, { recursive: true });

const viewports = [
  { name: "desktop", width: 1280, height: 900, mobile: false },
  { name: "mobile", width: 390, height: 844, mobile: true },
];

async function waitFor(check, description) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error(description);
}

async function availablePort() {
  const socket = createServer();
  await new Promise((done, fail) => {
    socket.once("error", fail);
    socket.listen(0, "127.0.0.1", done);
  });
  const { port } = socket.address();
  await new Promise(done => socket.close(done));
  return port;
}

async function capture(checkout, label) {
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  // Node validates the live site's TLS using the environment's trusted CA.
  // A read-only loopback relay lets Chromium render those exact public bytes
  // when its own isolated certificate store does not trust the cloud proxy.
  const relay = remote(checkout) ? createHttpServer(async (request, response) => {
    try {
      const upstream = await fetch(new URL(request.url, checkout), { redirect: "error" });
      response.writeHead(upstream.status, Object.fromEntries([...upstream.headers].filter(([key]) =>
        !["content-encoding", "content-length", "transfer-encoding"].includes(key))));
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) { response.writeHead(502); response.end(String(error)); }
  }) : null;
  if (relay) await new Promise(done => relay.listen(port, "127.0.0.1", done));
  const server = remote(checkout) ? null : spawn(process.execPath, ["scripts/serve-export.mjs", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: resolve(checkout), stdio: ["ignore", "ignore", "inherit"],
  });
  const images = new Map();
  try {
    await waitFor(async () => {
      if (server && server.exitCode !== null) throw new Error(`Export server exited in ${checkout}`);
      return fetch(origin).then(response => response.ok).catch(() => false);
    }, `Export server unavailable in ${checkout}`);
    for (const { name, ...viewport } of viewports) {
      const browser = await startChrome(executable, { proxy: null, dismissOnboarding: true });
      try {
        await browser.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1 });
        await browser.send("Emulation.setTouchEmulationEnabled", { enabled: viewport.mobile });
        await browser.send("Emulation.setEmulatedMedia", {
          features: [{ name: "prefers-reduced-motion", value: "reduce" }],
        });
        // Freeze the normal permission-prompt state without a nondeterministic video frame.
        await browser.send("Page.addScriptToEvaluateOnNewDocument", {
          source: `navigator.mediaDevices.getUserMedia = () => new Promise(() => {});
            localStorage.setItem("signrelay.analytics-consent.v1", JSON.stringify({
              choice: "rejected", savedAt: Date.now(),
            }));`,
        });
        await browser.send("Page.navigate", { url: origin });
        await waitFor(() => browser.evaluate("!!document.querySelector('.hero')"), "Landing page absent");
        for (const page of ["landing", "workspace"]) {
          if (page === "workspace") {
            await waitFor(async () => {
              if (await browser.evaluate("!!document.querySelector('.transcript-body')")) return true;
              await browser.evaluate("document.querySelector('.hero-actions button')?.click()");
              return false;
            }, "Start translating did not open the ASL workspace");
            await waitFor(() => browser.evaluate(
              "document.querySelector('.camera-placeholder h3')?.textContent === 'Allow camera access'",
            ), "Workspace did not reach the camera permission prompt");
          }
          await browser.evaluate(`(async () => {
            window.scrollTo(0, 0);
            await document.fonts.ready;
            for (const image of document.images) image.loading = "eager";
            await Promise.allSettled(Array.from(document.images, image => image.decode()));
            await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
            })()`);
          assert(await browser.evaluate("document.documentElement.scrollWidth <= innerWidth"),
            `Horizontal overflow on ${label} ${name} ${page}`);
          const { cssContentSize: { width, height } } = await browser.send("Page.getLayoutMetrics");
          const { data } = await browser.send("Page.captureScreenshot", {
            format: "png",
            captureBeyondViewport: true,
            clip: { x: 0, y: 0, width, height, scale: 1 },
          });
          const image = Buffer.from(data, "base64");
          const key = `${name}-${page}`;
          await writeFile(resolve(artifactDir, `${label}-${key}.png`), image);
          images.set(key, image);
        }
      } finally {
        await browser.close();
      }
    }
    return images;
  } finally {
    server?.kill();
    if (relay) await new Promise(done => relay.close(done));
  }
}

const reference = await capture(referenceDir, "reference");
const candidate = await capture(candidateDir, "candidate");
const comparisons = Object.fromEntries(
  [...reference].map(([name, image]) => [name, image.equals(candidate.get(name))]),
);
console.log(JSON.stringify({ artifactDir, comparisons }, null, 2));
assert(Object.values(comparisons).every(Boolean), "A candidate screenshot differs from its reference");
