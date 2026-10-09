#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SUPPORTED_LANGUAGES = new Map([
  ["asl", "American Sign Language"],
  ["bsl", "British Sign Language"],
  ["isl", "Indian Sign Language"],
  ["lse", "Spanish Sign Language"],
  ["psl", "Pakistan Sign Language"],
]);

const DEFAULT_CAMERA_TIMEOUT_MS = 120_000;
const DEFAULT_TRIAL_TIMEOUT_MS = 30_000;
const DEFAULT_TAIL_MS = 3_500;
const POLL_MS = 120;

function usage(message) {
  if (message) console.error(`\n${message}\n`);
  console.error(`Usage:
  npm run eval:video -- <manifest.jsonl> [options]

Options:
  --chrome <path>          Chrome/Chromium executable (auto-detected when possible)
  --output <path>          JSONL results path (default: work/video-evaluation/results.jsonl)
  --report <path>          Markdown report path (default: work/video-evaluation/report.md)
  --language <id>          Only run one language (asl, bsl, isl, lse, psl)
  --limit <n>              Run at most n manifest rows after filtering
  --camera-timeout <ms>    Camera + MediaPipe startup timeout (default: ${DEFAULT_CAMERA_TIMEOUT_MS})
  --trial-timeout <ms>     Minimum per-video timeout (default: ${DEFAULT_TRIAL_TIMEOUT_MS})
  --tail <ms>              Hold the final frame after video end (default: ${DEFAULT_TAIL_MS})
  --preflight               Validate the labelled fixture manifest without building or starting Chrome
  --strict                  Exit non-zero on any recognition mismatch/rejection/false accept
  --keep-fixtures           Keep temporary staged videos under out/__eval__ for debugging
  --help                    Show this help

Manifest rows are JSONL. Example:
  {"id":"asl-hello-01","language":"asl","trial_type":"sign","expected_gloss":"HELLO","video":"videos/asl/hello-01.mp4","condition":"bright-front"}
  {"id":"asl-nosign-01","language":"asl","trial_type":"no_sign","expected_gloss":null,"video":"videos/asl/no-sign-01.mp4","condition":"bright-front"}
`);
  process.exit(message ? 2 : 0);
}

function parseArgs(argv) {
  const result = { _: [] };
  const takesValue = new Set(["chrome", "output", "report", "language", "limit", "camera-timeout", "trial-timeout", "tail"]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      result._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (["strict", "preflight", "keep-fixtures", "help"].includes(key)) {
      result[key] = true;
      continue;
    }
    if (!takesValue.has(key)) usage(`Unknown option: ${arg}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) usage(`${arg} requires a value`);
    result[key] = value;
  }
  return result;
}

function positiveInteger(value, fallback, label) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) usage(`${label} must be a positive integer`);
  return parsed;
}

function normalizeGloss(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

async function readManifest(path, options) {
  const text = await readFile(path, "utf8");
  const rows = [];
  const seenIds = new Set();
  for (const [zeroIndex, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    let raw;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      throw new Error(`Manifest line ${zeroIndex + 1} is not valid JSON: ${error instanceof Error ? error.message : error}`);
    }
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`Manifest line ${zeroIndex + 1}: each row must be a JSON object`);
    }
    const language = String(raw.language ?? "").toLowerCase();
    if (!SUPPORTED_LANGUAGES.has(language)) {
      throw new Error(`Manifest line ${zeroIndex + 1}: language ${JSON.stringify(language)} is not supported by the shared browser evaluator. Supported: ${[...SUPPORTED_LANGUAGES.keys()].join(", ")}`);
    }
    if (options.language && language !== options.language) continue;
    const expectedGloss = raw.expected_gloss == null ? null : normalizeGloss(raw.expected_gloss);
    const trialType = raw.trial_type ?? (expectedGloss ? "sign" : "no_sign");
    if (!new Set(["sign", "no_sign"]).has(trialType)) {
      throw new Error(`Manifest line ${zeroIndex + 1}: trial_type must be sign or no_sign`);
    }
    if (trialType === "sign" && !expectedGloss) {
      throw new Error(`Manifest line ${zeroIndex + 1}: sign trials require expected_gloss`);
    }
    if (trialType === "no_sign" && expectedGloss) {
      throw new Error(`Manifest line ${zeroIndex + 1}: no_sign trials must use expected_gloss: null`);
    }
    if (typeof raw.video !== "string" || !raw.video.trim()) {
      throw new Error(`Manifest line ${zeroIndex + 1}: video is required`);
    }
    if (/^https?:\/\//i.test(raw.video)) {
      throw new Error(`Manifest line ${zeroIndex + 1}: remote video URLs are intentionally not supported; use a local file`);
    }
    const videoPath = resolve(dirname(path), raw.video);
    const info = await stat(videoPath).catch(() => null);
    if (!info?.isFile()) {
      throw new Error(`Manifest line ${zeroIndex + 1}: video file not found: ${videoPath}`);
    }
    const id = String(raw.id ?? `${language}-${zeroIndex + 1}`).trim();
    if (!id) throw new Error(`Manifest line ${zeroIndex + 1}: id cannot be empty`);
    if (seenIds.has(id)) throw new Error(`Manifest line ${zeroIndex + 1}: duplicate fixture id ${JSON.stringify(id)}`);
    seenIds.add(id);
    rows.push({
      manifestIndex: zeroIndex,
      id,
      language,
      trialType,
      expectedGloss,
      videoPath,
      sourceBasename: basename(videoPath),
      condition: String(raw.condition ?? "unspecified"),
      device: String(raw.device ?? "browser-video-fixture"),
      signerId: raw.signer_id == null ? null : String(raw.signer_id),
      notes: raw.notes == null ? null : String(raw.notes),
    });
  }
  if (!rows.length) throw new Error("No evaluation trials remain after manifest filtering.");
  return options.limit ? rows.slice(0, options.limit) : rows;
}

function detectChrome(explicit) {
  const candidates = [];
  if (explicit) candidates.push(explicit);
  if (process.env.CHROME_PATH) candidates.push(process.env.CHROME_PATH);
  for (const command of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"]) {
    const which = spawnSync(process.platform === "win32" ? "where" : "which", [command], { encoding: "utf8" });
    if (which.status === 0) candidates.push(which.stdout.trim().split(/\r?\n/)[0]);
  }
  if (process.platform === "darwin") {
    candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    candidates.push("/Applications/Chromium.app/Contents/MacOS/Chromium");
  }
  if (process.platform === "win32") {
    const roots = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean);
    for (const root of roots) candidates.push(join(root, "Google", "Chrome", "Application", "chrome.exe"));
  }
  return candidates.find(candidate => candidate && existsSync(candidate)) ?? null;
}

const HARNESS_SCRIPT = String.raw`(() => {
  const state = { nextUrl: null, current: null, lastError: null, trace: null };
  const newTrace = () => ({
    workerFrames: 0, workerHandFrames: 0, workerFaceFrames: 0,
    workerFrameGapOver250: 0, maxWorkerFrameGapMs: 0, lastFrameTimestamp: null,
    analysisMessages: 0, confirmations: {}, candidates: {},
    motionReasons: {}, candidateSources: {}, stateCounts: {},
    pendingAnalyses: 0, modelProblemAnalyses: 0,
    faults: 0, workerCreated: 0, sourceFrameAdvances: 0,
    lastSourceTime: -1, transitions: [], lastTransition: "",
  });
  const increment = (record, key) => { record[key] = (record[key] || 0) + 1; };
  const realWorker = window.Worker;
  window.Worker = class EvalObservedWorker extends realWorker {
    constructor(...args) {
      super(...args);
      if (!String(args[0] || "").includes("recognition.worker")) return;
      this.__srEvalRecognition = true;
      if (state.trace && state.current?.startedAt) state.trace.workerCreated += 1;
      this.addEventListener("message", event => {
        const d = event.data, t = state.trace;
        if (!t || !state.current?.startedAt || !d || typeof d !== "object") return;
        if (d.type === "fault") { t.faults += 1; return; }
        if (d.type === "confirmed") {
          increment(t.confirmations, String(d.gloss || "unknown"));
          return;
        }
        if (d.type !== "analysis") return;
        t.analysisMessages += 1;
        increment(t.stateCounts, String(d.state || "unknown"));
        if (d.candidate) increment(t.candidates, String(d.candidate));
        const diag = d.diagnostic;
        if (diag) {
          increment(t.motionReasons, String(diag.motionReason || "unknown"));
          increment(t.candidateSources, String(diag.candidateSource || "unknown"));
          if (diag.modelPending) t.pendingAnalyses += 1;
          if (diag.modelProblem) t.modelProblemAnalyses += 1;
        }
        const stage = [diag?.motionReason || "unspecified", diag?.candidateSource || "none", String(d.candidate || "")].join(":");
        if (stage !== t.lastTransition && t.transitions.length < 120) {
          t.transitions.push({
            ms: Math.round(performance.now() - state.current.startedAt),
            gate: diag?.motionReason || "unavailable", source: diag?.candidateSource || "unavailable",
            candidate: d.candidate || null,
          });
          t.lastTransition = stage;
        }
      });
    }
    postMessage(...args) {
      const msg = args[0], t = state.trace;
      if (this.__srEvalRecognition && t && state.current?.startedAt && msg?.type === "frame") {
        t.workerFrames += 1;
        if (msg.frame?.hands?.length) t.workerHandFrames += 1;
        if (msg.frame?.face?.length) t.workerFaceFrames += 1;
        const now = msg.frame?.timestamp;
        if (Number.isFinite(now)) {
          if (t.lastFrameTimestamp !== null) {
            const gap = now - t.lastFrameTimestamp;
            if (gap > 250) t.workerFrameGapOver250 += 1;
            t.maxWorkerFrameGapMs = Math.max(t.maxWorkerFrameGapMs, gap);
          }
          t.lastFrameTimestamp = now;
        }
      }
      return super.postMessage(...args);
    }
  };
  const mime = (url) => {
    const clean = String(url || "").split("?")[0].toLowerCase();
    if (clean.endsWith(".webm")) return "video/webm";
    if (clean.endsWith(".ogv") || clean.endsWith(".ogg")) return "video/ogg";
    if (clean.endsWith(".mov")) return "video/quicktime";
    return "video/mp4";
  };
  const stopCurrent = () => {
    const current = state.current;
    if (!current) return;
    if (current.raf) cancelAnimationFrame(current.raf);
    current.source.pause();
    current.stream?.getTracks().forEach(track => track.stop());
    if (current.objectUrl) URL.revokeObjectURL(current.objectUrl);
    state.current = null;
  };
  const loadStream = async () => {
    stopCurrent();
    state.lastError = null;
    const url = state.nextUrl || new URL(location.href).searchParams.get("__eval_video");
    if (!url) {
      state.lastError = "No evaluation video configured";
      throw new DOMException(state.lastError, "NotFoundError");
    }
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error("Video fixture request failed with HTTP " + response.status);
      const bytes = await response.arrayBuffer();
      const objectUrl = URL.createObjectURL(new Blob([bytes], { type: mime(url) }));
      const source = document.createElement("video");
      source.muted = true;
      source.playsInline = true;
      source.preload = "auto";
      source.src = objectUrl;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Video metadata timed out")), 15000);
        source.addEventListener("loadedmetadata", () => { clearTimeout(timer); resolve(); }, { once: true });
        source.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Chrome could not decode the video fixture")); }, { once: true });
        source.load();
      });
      const sourceWidth = source.videoWidth || 640;
      const sourceHeight = source.videoHeight || 480;
      const maxWidth = 1280, maxHeight = 720;
      const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(2, Math.round(sourceWidth * scale / 2) * 2);
      canvas.height = Math.max(2, Math.round(sourceHeight * scale / 2) * 2);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context || typeof canvas.captureStream !== "function") throw new Error("Canvas video capture is unavailable in this Chrome build");
      context.fillStyle = "black";
      context.fillRect(0, 0, canvas.width, canvas.height);
      const stream = canvas.captureStream(20);
      const current = {
        url, objectUrl, source, canvas, context, stream,
        raf: 0, paintTick: 0, startedAt: 0, endedAt: 0, ended: false,
      };
      state.current = current;
      source.addEventListener("ended", () => {
        current.ended = true;
        current.endedAt = performance.now();
      });
      const paint = () => {
        if (state.current !== current) return;
        const { context: ctx, canvas: cvs } = current;
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, cvs.width, cvs.height);
        if (current.startedAt && source.readyState >= 2) {
          if (state.trace && source.currentTime > state.trace.lastSourceTime) {
            state.trace.lastSourceTime = source.currentTime;
            state.trace.sourceFrameAdvances += 1;
          }
          const sw = source.videoWidth || cvs.width;
          const sh = source.videoHeight || cvs.height;
          const ratio = Math.min(cvs.width / sw, cvs.height / sh);
          const dw = sw * ratio, dh = sh * ratio;
          ctx.drawImage(source, (cvs.width - dw) / 2, (cvs.height - dh) / 2, dw, dh);
        }
        current.paintTick += 1;
        ctx.fillStyle = current.paintTick % 2 ? "rgb(0,0,0)" : "rgb(1,1,1)";
        ctx.fillRect(0, 0, 1, 1);
        current.raf = requestAnimationFrame(paint);
      };
      current.raf = requestAnimationFrame(paint);
      return stream;
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  };
  const api = {
    setVideo(url) {
      stopCurrent();
      state.nextUrl = String(url);
      state.lastError = null;
      return true;
    },
    async start() {
      const current = state.current;
      if (!current) throw new Error("Evaluation stream is not ready");
      current.ended = false;
      current.endedAt = 0;
      current.startedAt = performance.now();
      state.trace = newTrace();
      current.source.currentTime = 0;
      await current.source.play();
      return {
        duration: Number.isFinite(current.source.duration) ? current.source.duration : null,
        width: current.source.videoWidth,
        height: current.source.videoHeight,
      };
    },
    snapshot() {
      const current = state.current;
      const t = state.trace;
      const trace = t ? (() => {
        const { lastFrameTimestamp, lastSourceTime, lastTransition, ...publicTrace } = t;
        return publicTrace;
      })() : null;
      return {
        configuredUrl: state.nextUrl,
        error: state.lastError,
        ready: Boolean(current),
        started: Boolean(current?.startedAt),
        ended: Boolean(current?.ended),
        endedForMs: current?.endedAt ? performance.now() - current.endedAt : null,
        currentTime: current?.source.currentTime ?? null,
        duration: current && Number.isFinite(current.source.duration) ? current.source.duration : null,
        readyState: current?.source.readyState ?? null,
        trace,
      };
    },
    stop() { stopCurrent(); return true; },
  };
  Object.defineProperty(window, "__signrelayEval", { configurable: true, value: api });
  if (!navigator.mediaDevices) Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {} });
  Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async () => loadStream() });
})();`;

function pause(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function waitUntil(check, message, limit = 10_000, interval = 150) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < limit) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await pause(interval);
  }
  throw new Error(lastError ? `${message}: ${lastError instanceof Error ? lastError.message : lastError}` : message);
}

async function connectCdp(cdpPort, chrome) {
  const started = Date.now();
  let tabs;
  while (Date.now() - started < 30_000) {
    if (chrome.exitCode !== null) throw new Error(`Chrome exited before DevTools became ready (code ${chrome.exitCode})`);
    try {
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
      if (response.ok) {
        tabs = await response.json();
        if (tabs.some(tab => tab.type === "page" && tab.webSocketDebuggerUrl)) break;
      }
    } catch {}
    await pause(200);
  }
  const page = tabs?.find(tab => tab.type === "page" && tab.webSocketDebuggerUrl);
  if (!page) throw new Error("Chrome DevTools did not expose a page target");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolvePromise, rejectPromise) => {
    socket.onopen = resolvePromise;
    socket.onerror = rejectPromise;
  });
  let id = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id) return;
    const task = pending.get(message.id);
    pending.delete(message.id);
    if (!task) return;
    if (message.error) task.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
    else task.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolvePromise, rejectPromise) => {
    const key = ++id;
    pending.set(key, { resolve: resolvePromise, reject: rejectPromise });
    socket.send(JSON.stringify({ id: key, method, params }));
  });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "Browser evaluation failed");
    return result.result?.value;
  };
  return { socket, send, evaluate };
}

async function waitForServer(origin, server) {
  await waitUntil(async () => {
    if (server.exitCode !== null) throw new Error(`Static server exited with code ${server.exitCode}`);
    const response = await fetch(origin).catch(() => null);
    return Boolean(response?.ok);
  }, "Static export server did not start", 15_000, 150);
}

async function navigateToLanding(cdp, origin) {
  await cdp.send("Page.navigate", { url: origin });
  await waitUntil(() => cdp.evaluate("document.querySelectorAll('.figma-language-row [role=radio]').length >= 5"), "SignRelay landing page did not render", 30_000);
}

async function selectLanguageAndStart(cdp, language, fixtureUrl, cameraTimeout) {
  const languageName = SUPPORTED_LANGUAGES.get(language);
  await cdp.evaluate(`window.__signrelayEval.setVideo(${JSON.stringify(fixtureUrl)})`);
  const selected = await cdp.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('.figma-language-row [role=radio]')).find(item => item.textContent.includes(${JSON.stringify(languageName)}));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!selected) throw new Error(`Could not select ${languageName}`);
  await waitUntil(() => cdp.evaluate(`Array.from(document.querySelectorAll('.figma-language-row [role=radio]')).some(item => item.textContent.includes(${JSON.stringify(languageName)}) && item.getAttribute('aria-checked') === 'true')`), `${languageName} did not become selected`);
  const started = await cdp.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('button')).find(item => item.textContent.trim() === 'Start translating');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!started) throw new Error("Start translating button was not found");
  await waitUntil(() => cdp.evaluate("!!document.querySelector('#camera-title')"), "Translation workspace did not render", 30_000);
  await waitForCamera(cdp, cameraTimeout);
}

async function waitForCamera(cdp, cameraTimeout) {
  await waitUntil(async () => {
    const status = await cdp.evaluate(`(() => ({
      active: Boolean(document.querySelector('.camera-session-actions span')?.textContent.includes('Camera on')),
      message: document.querySelector('.camera-panel .status-badge')?.textContent ?? document.querySelector('.camera-placeholder p')?.textContent ?? '',
      harness: window.__signrelayEval?.snapshot?.() ?? null,
    }))()`);
    if (status?.harness?.error) throw new Error(status.harness.error);
    if (/unavailable|could not|denied|stopped/i.test(status?.message ?? "") && !status.active) throw new Error(status.message);
    return Boolean(status?.active);
  }, "Camera/MediaPipe pipeline did not become active", cameraTimeout, 200);
}

async function pauseCamera(cdp) {
  const active = await cdp.evaluate("Boolean(document.querySelector('.camera-session-actions span')?.textContent.includes('Camera on'))");
  if (!active) return;
  await cdp.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('.camera-session-actions button')).find(item => item.textContent.includes('Pause camera'));
    button?.click();
  })()`);
  await waitUntil(() => cdp.evaluate("!document.querySelector('.camera-session-actions span')?.textContent.includes('Camera on')"), "Camera did not stop", 10_000);
}

async function clearTranscript(cdp) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const remaining = await cdp.evaluate(`(() => {
      const button = document.querySelector('.transcript-entry button[aria-label^="Remove "]');
      button?.click();
      return document.querySelectorAll('.transcript-entry').length;
    })()`);
    if (!remaining) break;
    await pause(25);
  }
  await waitUntil(() => cdp.evaluate("document.querySelectorAll('.transcript-entry').length === 0"), "Transcript did not clear", 5_000);
}

async function prepareNextTrial(cdp, fixtureUrl, cameraTimeout) {
  await pauseCamera(cdp);
  await clearTranscript(cdp);
  await cdp.evaluate(`window.__signrelayEval.setVideo(${JSON.stringify(fixtureUrl)})`);
  const clicked = await cdp.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('.camera-session-actions button, .camera-placeholder button')).find(item => item.textContent.includes('Start camera'));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error("Start camera button was not found");
  await waitForCamera(cdp, cameraTimeout);
}

async function browserState(cdp) {
  return cdp.evaluate(`(() => {
    const entries = Array.from(document.querySelectorAll('.transcript-entry')).map(article => {
      const meta = article.querySelector('.entry-actions span')?.textContent ?? '';
      const match = meta.match(/(\\d+)%\\s*·\\s*(.+)$/);
      return {
        text: article.querySelector('p')?.textContent?.trim() ?? '',
        confidence: match ? Number(match[1]) / 100 : null,
        gloss: match ? match[2].trim() : null,
      };
    });
    const detection = {};
    for (const item of document.querySelectorAll('.detection-item')) {
      const label = item.querySelector('span')?.textContent?.trim().toLowerCase();
      if (label) detection[label] = item.classList.contains('active');
    }
    const confidenceText = document.querySelector('.confidence-ring span')?.textContent ?? '';
    return {
      entries,
      detection,
      candidate: document.querySelector('.candidate-bar strong')?.textContent?.trim() ?? null,
      candidateConfidence: /^\\d+%$/.test(confidenceText.trim()) ? Number.parseInt(confidenceText, 10) / 100 : null,
      feedback: document.querySelector('.transcript-panel [role=status]')?.textContent?.trim() ?? null,
      harness: window.__signrelayEval.snapshot(),
    };
  })()`);
}

function ratio(value, total) {
  return total ? value / total : 0;
}

async function runTrial(cdp, trial, options, coldStart) {
  const startedAt = Date.now();
  const sourceInfo = await cdp.evaluate("window.__signrelayEval.start()");
  const sourceDurationMs = Number.isFinite(sourceInfo?.duration) ? Math.ceil(sourceInfo.duration * 1000) : 0;
  const deadlineMs = Math.max(options.trialTimeout, sourceDurationMs + options.tail + 5_000);
  let firstAcceptedAt = null;
  let timedOut = false;
  let latest = await browserState(cdp);
  const detectionCounts = { samples: 0, person: 0, hands: 0, face: 0, "upper body": 0 };
  while (Date.now() - startedAt < deadlineMs) {
    latest = await browserState(cdp);
    if (latest.harness?.error) throw new Error(latest.harness.error);
    if (latest.entries.length && firstAcceptedAt === null) firstAcceptedAt = Date.now();
    if (!latest.harness?.ended) {
      detectionCounts.samples += 1;
      for (const key of ["person", "hands", "face", "upper body"]) detectionCounts[key] += latest.detection?.[key] ? 1 : 0;
    }
    if (latest.harness?.ended && (latest.harness.endedForMs ?? 0) >= options.tail) break;
    await pause(POLL_MS);
  }
  if (!(latest.harness?.ended && (latest.harness.endedForMs ?? 0) >= options.tail)) timedOut = true;
  const first = latest.entries[0] ?? null;
  const predictedGloss = first?.gloss ? normalizeGloss(first.gloss) : null;
  const accepted = Boolean(predictedGloss);
  let outcome;
  if (timedOut) outcome = "timeout";
  else if (trial.trialType === "no_sign") outcome = accepted ? "false_accept" : "correct_reject";
  else if (!accepted) outcome = "rejected";
  else if (predictedGloss !== trial.expectedGloss) outcome = "wrong";
  else outcome = latest.entries.length === 1 ? "correct" : "extra_prediction";
  return {
    session_id: options.sessionId,
    participant_id: trial.signerId ?? "fixture",
    fixture_id: trial.id,
    language: trial.language,
    trial_type: trial.trialType,
    expected_gloss: trial.expectedGloss,
    predicted_gloss: predictedGloss,
    accepted,
    confidence: first?.confidence ?? 0,
    device: trial.device,
    condition: trial.condition,
    outcome,
    cold_start: coldStart,
    latency_ms: firstAcceptedAt === null ? null : firstAcceptedAt - startedAt,
    source_duration_ms: sourceDurationMs || null,
    timed_out: timedOut,
    pipeline: latest.harness?.trace ?? null,
    tracker: {
      samples: detectionCounts.samples,
      person_coverage: ratio(detectionCounts.person, detectionCounts.samples),
      hand_coverage: ratio(detectionCounts.hands, detectionCounts.samples),
      face_coverage: ratio(detectionCounts.face, detectionCounts.samples),
      pose_coverage: ratio(detectionCounts["upper body"], detectionCounts.samples),
    },
    final_candidate: latest.candidate,
    final_candidate_confidence: latest.candidateConfidence,
    predictions: latest.entries.map(entry => ({
      gloss: entry.gloss ? normalizeGloss(entry.gloss) : null,
      text: entry.text,
      confidence: entry.confidence,
    })),
    source_file: trial.sourceBasename,
    notes: trial.notes,
  };
}

function pct(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "n/a";
}

function summarize(records) {
  const byLanguage = new Map();
  for (const row of records) {
    if (!byLanguage.has(row.language)) byLanguage.set(row.language, []);
    byLanguage.get(row.language).push(row);
  }
  const languages = [];
  for (const [language, rows] of [...byLanguage.entries()].sort()) {
    const signed = rows.filter(row => row.trial_type === "sign" && row.outcome !== "error");
    const noSign = rows.filter(row => row.trial_type === "no_sign" && row.outcome !== "error");
    const correct = signed.filter(row => row.outcome === "correct");
    const acceptedSigned = signed.filter(row => row.accepted);
    const falseAccept = noSign.filter(row => row.accepted);
    const confusions = new Map();
    for (const row of signed.filter(row => row.outcome === "wrong")) {
      const key = `${row.expected_gloss} -> ${row.predicted_gloss}`;
      confusions.set(key, (confusions.get(key) ?? 0) + 1);
    }
    languages.push({
      language,
      signed: signed.length,
      correct: correct.length,
      accuracy: signed.length ? correct.length / signed.length : null,
      coverage: signed.length ? acceptedSigned.length / signed.length : null,
      precisionWhenAccepted: acceptedSigned.length ? correct.length / acceptedSigned.length : null,
      rejected: signed.filter(row => row.outcome === "rejected").length,
      wrong: signed.filter(row => row.outcome === "wrong").length,
      noSign: noSign.length,
      falseAccept: falseAccept.length,
      falseAcceptRate: noSign.length ? falseAccept.length / noSign.length : null,
      meanHandCoverage: rows.length ? rows.reduce((sum, row) => sum + (row.tracker?.hand_coverage ?? 0), 0) / rows.length : null,
      confusions: [...confusions.entries()].sort((a, b) => b[1] - a[1]).map(([pair, count]) => ({ pair, count })),
    });
  }
  return { languages };
}

function markdownReport(records, summary, meta) {
  const lines = [
    "# SignRelay automated video regression",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Manifest: \`${meta.manifestBasename}\``,
    "",
    "> These are fixed-source video clips replayed through the real browser camera/MediaPipe/recognition path. Browser frame delivery and inference timing can differ between runs: compare repeated trials before drawing quality conclusions. This is not a substitute for signer-independent live-camera evaluation.",
    "",
    "## Summary",
    "",
    "| Language | Signed trials | Accuracy | Coverage | Precision when accepted | Rejected | Wrong | No-sign false accept | Mean hand coverage |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const item of summary.languages) {
    const far = item.noSign ? `${pct(item.falseAcceptRate)} (${item.falseAccept}/${item.noSign})` : "n/a";
    lines.push(`| ${item.language.toUpperCase()} | ${item.signed} | ${pct(item.accuracy)} | ${pct(item.coverage)} | ${pct(item.precisionWhenAccepted)} | ${item.rejected} | ${item.wrong} | ${far} | ${pct(item.meanHandCoverage)} |`);
  }
  const failures = records.filter(row => !["correct", "correct_reject"].includes(row.outcome));
  lines.push("", "## Failures", "");
  if (!failures.length) lines.push("No recognition failures were recorded in this fixture set.");
  else {
    lines.push("| Fixture | Language | Expected | Predicted | Outcome | Confidence | Hand coverage | Latency | Startup |", "| --- | --- | --- | --- | --- | ---: | ---: | ---: | --- |");
    for (const row of failures) {
      lines.push(`| ${row.fixture_id} | ${row.language.toUpperCase()} | ${row.expected_gloss ?? "NO_SIGN"} | ${row.predicted_gloss ?? "—"} | ${row.outcome} | ${pct(row.confidence)} | ${pct(row.tracker?.hand_coverage)} | ${row.latency_ms == null ? "—" : `${row.latency_ms} ms`} | ${row.cold_start ? "cold" : "warm"} |`);
    }
  }
  const confusions = summary.languages.flatMap(item => item.confusions.map(entry => ({ language: item.language, ...entry })));
  lines.push("", "## Most common confusions", "");
  if (!confusions.length) lines.push("No wrong accepted-sign confusions were recorded.");
  else {
    lines.push("| Language | Confusion | Count |", "| --- | --- | ---: |");
    for (const item of confusions.sort((a, b) => b.count - a.count).slice(0, 25)) lines.push(`| ${item.language.toUpperCase()} | ${item.pair} | ${item.count} |`);
  }
  lines.push("", "## Pipeline stages", "", "Counts are worker frame/analysis observations, not fixed frame-rate measurements. Movement and candidate counts use the worker's own diagnostic reasons. Video and landmarks are never included.", "",
    "| Fixture | Source advances | Frames to worker | Hand frames | Frame gaps >250 ms | Analysis replies | Gate reasons | Candidate sources | Candidates | Faults |",
    "| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: |");
  const formatCount = values => Object.entries(values || {}).map(([key, count]) => key + ": " + count).join("; ") || "—";
  for (const row of records) {
    const trace = row.pipeline;
    lines.push("| " + row.fixture_id + " | " + (trace?.sourceFrameAdvances ?? "—") + " | " +
      (trace?.workerFrames ?? "—") + " | " + (trace?.workerHandFrames ?? "—") + " | " +
      (trace?.workerFrameGapOver250 ?? "—") + " | " + (trace?.analysisMessages ?? "—") + " | " +
      formatCount(trace?.motionReasons) + " | " + formatCount(trace?.candidateSources) + " | " +
      formatCount(trace?.candidates) + " | " + (trace?.faults ?? "—") + " |");
  }
  lines.push("", "## Trial details", "", "| Fixture | Expected | First accepted | Outcome | Confidence | Hands | Person | Face | Pose | Candidate at end |", "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const row of records) {
    lines.push(`| ${row.fixture_id} | ${row.expected_gloss ?? "NO_SIGN"} | ${row.predicted_gloss ?? "—"} | ${row.outcome} | ${pct(row.confidence)} | ${pct(row.tracker?.hand_coverage)} | ${pct(row.tracker?.person_coverage)} | ${pct(row.tracker?.face_coverage)} | ${pct(row.tracker?.pose_coverage)} | ${String(row.final_candidate ?? "—").replaceAll("|", "\\|")} |`);
  }
  lines.push("", "Only metadata is written to this report. Source video remains local and is not uploaded by the evaluator.", "");
  return lines.join("\n");
}

function printTrial(row) {
  const symbol = row.outcome === "correct" || row.outcome === "correct_reject" ? "PASS" : row.outcome === "error" ? "ERROR" : "FAIL";
  const expected = row.expected_gloss ?? "NO_SIGN";
  const predicted = row.predicted_gloss ?? "REJECT";
  console.log(`${symbol.padEnd(5)} ${row.fixture_id}: ${expected} -> ${predicted} | ${pct(row.confidence)} | hands ${pct(row.tracker?.hand_coverage)}${row.cold_start ? " | cold" : ""}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) usage();
  if (args._.length !== 1) usage("Exactly one manifest path is required.");
  const options = {
    chrome: args.chrome,
    output: resolve(args.output ?? "work/video-evaluation/results.jsonl"),
    report: resolve(args.report ?? "work/video-evaluation/report.md"),
    language: args.language ? String(args.language).toLowerCase() : null,
    limit: args.limit ? positiveInteger(args.limit, null, "--limit") : null,
    cameraTimeout: positiveInteger(args["camera-timeout"], DEFAULT_CAMERA_TIMEOUT_MS, "--camera-timeout"),
    trialTimeout: positiveInteger(args["trial-timeout"], DEFAULT_TRIAL_TIMEOUT_MS, "--trial-timeout"),
    tail: positiveInteger(args.tail, DEFAULT_TAIL_MS, "--tail"),
    strict: Boolean(args.strict),
    preflight: Boolean(args.preflight),
    keepFixtures: Boolean(args["keep-fixtures"]),
    sessionId: `AUTOMATED-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  };
  if (options.language && !SUPPORTED_LANGUAGES.has(options.language)) usage(`--language must be one of: ${[...SUPPORTED_LANGUAGES.keys()].join(", ")}`);
  const manifestPath = resolve(args._[0]);
  const manifest = await readManifest(manifestPath, options);
  if (options.preflight) {
    const sign = manifest.filter(trial => trial.trialType === "sign").length;
    const noSign = manifest.length - sign;
    const languages = [...new Set(manifest.map(trial => trial.language))].sort().join(", ");
    console.log(`PASS: ${manifest.length} unique, existing local video fixtures (${sign} sign, ${noSign} no-sign; languages: ${languages}).`);
    console.log("Manifest preflight does not run recognition or establish accuracy.");
    return;
  }
  const chromePath = detectChrome(options.chrome);
  if (!chromePath) throw new Error("Chrome/Chromium was not found. Install Chrome/Chromium or pass --chrome /path/to/executable.");
  const exportIndex = resolve("out/index.html");
  if (!existsSync(exportIndex)) throw new Error("Built export not found at out/index.html. Run `npm run build:firebase` first.");

  const port = 18_000 + Math.floor(Math.random() * 1_000);
  const cdpPort = port + 1_200;
  const origin = `http://127.0.0.1:${port}`;
  const profile = await mkdtemp(join(tmpdir(), "signrelay-video-eval-"));
  const sessionDir = resolve("out/__eval__", options.sessionId.replace(/[^a-zA-Z0-9_-]/g, "_"));
  await mkdir(sessionDir, { recursive: true });
  const server = spawn(process.execPath, ["scripts/serve-export.mjs", "--port", String(port)], { stdio: ["ignore", "ignore", "pipe"] });
  const chrome = spawn(chromePath, [
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check",
    "--autoplay-policy=no-user-gesture-required", `--user-data-dir=${profile}`, `--remote-debugging-port=${cdpPort}`, "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let cdp;
  let chromeStderr = "";
  chrome.stderr?.setEncoding("utf8");
  chrome.stderr?.on("data", chunk => { chromeStderr += chunk; });
  const records = [];
  let infrastructureFailure = false;
  try {
    await waitForServer(origin, server);
    cdp = await connectCdp(cdpPort, chrome);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: HARNESS_SCRIPT });

    const byLanguage = new Map();
    for (const trial of manifest) {
      if (!byLanguage.has(trial.language)) byLanguage.set(trial.language, []);
      byLanguage.get(trial.language).push(trial);
    }

    for (const [language, trials] of byLanguage) {
      console.log(`\n${language.toUpperCase()} — ${trials.length} video trial${trials.length === 1 ? "" : "s"}`);
      await navigateToLanding(cdp, origin);
      let first = true;
      for (const [trialIndex, trial] of trials.entries()) {
        const safeId = trial.id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || `trial-${trial.manifestIndex + 1}`;
        const extension = extname(trial.videoPath).toLowerCase() || ".mp4";
        const stagedName = `${String(trial.manifestIndex + 1).padStart(4, "0")}-${safeId}${extension}`;
        const stagedPath = join(sessionDir, stagedName);
        const fixtureUrl = `/__eval__/${basename(sessionDir)}/${stagedName}`;
        await copyFile(trial.videoPath, stagedPath);
        try {
          if (first) {
            await selectLanguageAndStart(cdp, language, fixtureUrl, options.cameraTimeout);
            first = false;
          } else {
            await prepareNextTrial(cdp, fixtureUrl, options.cameraTimeout);
          }
          const row = await runTrial(cdp, trial, options, trialIndex === 0);
          records.push(row);
          printTrial(row);
        } catch (error) {
          infrastructureFailure = true;
          const message = error instanceof Error ? error.message : String(error);
          const row = {
            session_id: options.sessionId,
            participant_id: trial.signerId ?? "fixture",
            fixture_id: trial.id,
            language: trial.language,
            trial_type: trial.trialType,
            expected_gloss: trial.expectedGloss,
            predicted_gloss: null,
            accepted: false,
            confidence: 0,
            device: trial.device,
            condition: trial.condition,
            outcome: "error",
            cold_start: trialIndex === 0,
            latency_ms: null,
            source_duration_ms: null,
            timed_out: false,
            tracker: { samples: 0, person_coverage: 0, hand_coverage: 0, face_coverage: 0, pose_coverage: 0 },
            pipeline: null,
            final_candidate: null,
            final_candidate_confidence: null,
            predictions: [],
            source_file: trial.sourceBasename,
            notes: trial.notes,
            error: message,
          };
          records.push(row);
          printTrial(row);
          console.error(`      ${message}`);
          await pauseCamera(cdp).catch(() => {});
        } finally {
          if (!options.keepFixtures) await rm(stagedPath, { force: true });
        }
      }
      await pauseCamera(cdp).catch(() => {});
    }

    const summary = summarize(records);
    await mkdir(dirname(options.output), { recursive: true });
    await mkdir(dirname(options.report), { recursive: true });
    await writeFile(options.output, records.map(row => JSON.stringify(row)).join("\n") + "\n", "utf8");
    await writeFile(options.report, markdownReport(records, summary, { manifestBasename: basename(manifestPath) }), "utf8");

    console.log("\nSummary");
    for (const item of summary.languages) {
      console.log(`  ${item.language.toUpperCase()}: accuracy ${pct(item.accuracy)}, coverage ${pct(item.coverage)}, accepted precision ${pct(item.precisionWhenAccepted)}, no-sign FAR ${pct(item.falseAcceptRate)}`);
    }
    console.log(`\nResults: ${options.output}`);
    console.log(`Report:  ${options.report}`);

    const recognitionFailure = records.some(row => !["correct", "correct_reject"].includes(row.outcome));
    if (infrastructureFailure || (options.strict && recognitionFailure)) process.exitCode = 1;
  } finally {
    try { cdp?.socket?.close(); } catch {}
    chrome.kill();
    server.kill();
    await pause(250);
    await rm(profile, { recursive: true, force: true });
    if (!options.keepFixtures) await rm(sessionDir, { recursive: true, force: true });
    if (chrome.exitCode !== null && chrome.exitCode !== 0 && chromeStderr.trim()) console.error(chromeStderr.slice(-4_000));
  }
}

export { readManifest, summarize, markdownReport };

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    console.error(`\nVideo evaluation failed: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
