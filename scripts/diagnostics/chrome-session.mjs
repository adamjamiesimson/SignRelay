import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TASKS_WASM_PATH } from "../../lib/vision-runtime.mjs";
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function startChrome(executable, { forwardAssets = false, proxy = process.env.HTTPS_PROXY, extraArgs = [] } = {}) {
  const profile = await mkdtemp(join(tmpdir(), "signrelay-diagnostic-"));
  const port = 19000 + Math.floor(Math.random() * 1000);
  const args = ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--no-first-run",
    "--disable-background-networking", `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
    "--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"];
  args.push(...extraArgs);
  if (proxy) args.push(`--proxy-server=${proxy}`, "--proxy-bypass-list=<-loopback>;localhost;127.0.0.1");
  const browser = spawn(executable, [...args, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = ""; browser.stderr.setEncoding("utf8"); browser.stderr.on("data", chunk => { stderr += chunk; });
  let socket;
  const close = async () => { socket?.close(); browser.kill(); await rm(profile, { recursive: true, force: true, maxRetries: 3 }); };
  try {
    let tabs;
    for (let i = 0; i < 150; i++) {
      if (browser.exitCode !== null) throw new Error("Chrome could not start");
      try { tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (tabs.length) break; } catch {}
      await delay(200);
    }
    if (!tabs?.length) throw new Error("Chrome CDP was not available: " + stderr.slice(-2000));
    socket = new WebSocket(tabs.find(tab => tab.type === "page").webSocketDebuggerUrl);
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
