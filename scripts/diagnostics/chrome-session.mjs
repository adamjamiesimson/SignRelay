import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TASKS_WASM_PATH } from "../../lib/vision-runtime.mjs";
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function startChrome(executable, { forwardAssets = false, proxy = process.env.HTTPS_PROXY, extraArgs = [], fakeDevice = true } = {}) {
  const profile = await mkdtemp(join(tmpdir(), "signrelay-diagnostic-"));
  const args = ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--no-first-run",
    "--disable-background-networking", `--user-data-dir=${profile}`, "--remote-debugging-port=0",
    "--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream"];
  if (fakeDevice) args.push("--use-fake-device-for-media-stream");
  args.push(...extraArgs);
  if (proxy) args.push(`--proxy-server=${proxy}`, "--proxy-bypass-list=<-loopback>;localhost;127.0.0.1");
  const browser = spawn(executable, [...args, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = ""; browser.stderr.setEncoding("utf8"); browser.stderr.on("data", chunk => { stderr += chunk; });
  let launchError;
  browser.on("error", error => { launchError = error; });
  let socket;
  const exited = new Promise(resolve => browser.once("close", resolve));
  const close = async () => {
    if (socket?.readyState === WebSocket.OPEN) {
      // Let Chrome close its profile before removing it. Killing the parent
      // first leaves temporary profile files locked on Windows.
      socket.send(JSON.stringify({ id: 0, method: "Browser.close" }));
      await Promise.race([exited, delay(2000)]);
    }
    socket?.close();
    if (browser.exitCode === null && browser.signalCode === null) browser.kill();
    await Promise.race([exited, delay(2000)]);
    await rm(profile, { recursive: true, force: true, maxRetries: 6 });
  };
  try {
    let page;
    const expires = performance.now() + 65000;
    let port;
    while (performance.now() < expires) {
      if (launchError) throw launchError;
      if (browser.exitCode !== null || browser.signalCode !== null) break;
      try {
        // Chrome publishes its own ephemeral port in this session's profile.
        port ??= /^(\d+)\r?\n/.exec(await readFile(join(profile, "DevToolsActivePort"), "utf8"))?.[1];
        if (port) {
          const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
          page = (await response.json()).find(tab => tab.type === "page" && tab.webSocketDebuggerUrl);
          if (page) break;
        }
      } catch { /* Chrome has not published its page yet. */ }
      await delay(200);
    }
    if (!page) throw new Error("Chrome CDP was not available: " + stderr.slice(-2000));
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let id = 0; const pending = new Map(), errors = [];
    const assetCache = new Map(), requestUrls = new Map(), listeners = new Set();
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const task = pending.get(message.id); pending.delete(message.id);
        if (!task) return; clearTimeout(task.timer);
        if (message.error) task.reject(new Error(JSON.stringify(message.error))); else task.resolve(message.result);
      }
      // Only the forwardAssets mode enables interception here; callers that
      // enable Fetch themselves handle their own paused requests.
      if (forwardAssets && message.method === "Fetch.requestPaused") {
        const { requestId, request } = message.params;
        void (async () => {
          // Optional CI proxy compatibility. Fetch only the fixed public runtime
          // assets with Node's normal TLS verification. Never intercept media,
          // page data, credentials, or requests to arbitrary destinations.
          const allowed = request.url.startsWith(`${TASKS_WASM_PATH}/`)
            || request.url.startsWith("https://storage.googleapis.com/mediapipe-models/");
          if (!allowed || request.method !== "GET") { await send("Fetch.continueRequest", { requestId }); return; }
          let asset = assetCache.get(request.url);
          if (!asset) {
            asset = (async () => {
              const response = await fetch(request.url, { signal: AbortSignal.timeout(90000) });
              if (!response.ok || response.headers.get("content-type")?.includes("text/html")) throw new Error("Runtime asset download failed");
              return { bytes: Buffer.from(await response.arrayBuffer()), type: response.headers.get("content-type") ?? "application/octet-stream" };
            })();
            assetCache.set(request.url, asset);
          }
          const { bytes, type } = await asset;
          await send("Fetch.fulfillRequest", { requestId, responseCode: 200, body: bytes.toString("base64"),
            responseHeaders: [{ name: "Content-Type", value: type }, { name: "Access-Control-Allow-Origin", value: "*" }] });
        })().catch(async error => { errors.push(String(error)); await send("Fetch.failRequest", { requestId, errorReason: "Failed" }).catch(() => {}); });
      }
      if (message.method === "Network.requestWillBeSent") requestUrls.set(message.params.requestId, message.params.request.url);
      if (message.method === "Network.loadingFailed") errors.push({ error: message.params.errorText, url: requestUrls.get(message.params.requestId) });
      if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
      for (const listener of listeners) listener(message);
    };
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const key = ++id; const timer = setTimeout(() => { pending.delete(key); reject(new Error(`${method} timed out`)); }, 180000);
      pending.set(key, { resolve, reject, timer }); socket.send(JSON.stringify({ id: key, method, params, sessionId }));
    });
    const evaluate = async expression => {
      const value = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text);
      return value.result?.value;
    };
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Network.enable");
    if (forwardAssets) await send("Fetch.enable", { patterns: [
      { urlPattern: `${TASKS_WASM_PATH}/*` },
      { urlPattern: "https://storage.googleapis.com/mediapipe-models/*" },
    ] });
    return { send, evaluate, errors, close, onEvent: handler => { listeners.add(handler); return () => listeners.delete(handler); } };
  } catch (error) { await close(); throw error; }
}
