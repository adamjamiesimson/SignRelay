// Engine V3 experimental lab (main thread). Camera frames and files never leave the tab.
import { analysisSize, resampleTo15Hz, hasHand, signingEvidence, FPS } from "./preprocess.mjs";

const $ = s => document.querySelector(s);
const DEBUG = new URLSearchParams(location.search).has("debug");
const worker = new Worker(new URL("./worker.js", import.meta.url));
let seq = 0; const pending = new Map();
const call = (msg, transfer = []) => new Promise((resolve, reject) => {
  const id = ++seq; pending.set(id, { resolve, reject }); worker.postMessage({ ...msg, id }, transfer);
});
worker.onmessage = ({ data }) => {
  const p = pending.get(data.id); if (!p) return; pending.delete(data.id);
  data.type === "error" ? p.reject(new Error(data.message)) : p.resolve(data);
};

const state = { ready: null, classes: [], events: [], trials: [], running: false, stats: null };
const log = (...a) => { $("#status").textContent = a.join(" "); };

// ------------------------------------------------------------------ startup
async function start() {
  log("Loading models…");
  const meta = await (await fetch("meta.json")).json();
  state.meta = meta; state.classes = meta.classes;
  const delegate = new URLSearchParams(location.search).get("delegate") === "gpu" ? "GPU" : "CPU";
  const r = await call({ type: "init", delegate });
  state.ready = r;
  $("#nclasses").textContent = meta.classes.length;
  $("#version").textContent = `${meta.version} · model ${meta.model_sha256.slice(0, 12)} · commit ${meta.commit.slice(0, 10)} · ${r.delegate} · ${r.threads} ORT threads`;
  $("#startup").textContent = `startup ${Math.round(r.startup.totalMs)} ms (fetch ${Math.round(r.startup.fetchMs)}, vision ${Math.round(r.startup.visionMs)})`;
  const dl = $("#vocab"); dl.innerHTML = "";
  for (const c of meta.classes) { const o = document.createElement("option"); o.value = c; dl.appendChild(o); }
  $("#vocablist").textContent = meta.classes.join(" · ");
  log("Ready.");
  document.body.dataset.ready = "1";
}

// ------------------------------------------------------------------ result rendering
function fmt(r) {
  if (!r) return "—";
  if (r.status === "no-sign") return `No usable signing evidence (${r.reason})`;
  if (r.status === "unknown") return `Not a supported sign (closest: ${r.best})`;
  if (r.status === "uncertain") return `Uncertain (closest: ${r.best})`;
  return r.label;
}
function showResult(r, where = "#proposal") {
  $(where).textContent = fmt(r);
  if (!r.top5) return;
  $("#top5").innerHTML = r.top5.map(t => `<li>${t.label} <span class="mut">${(t.p * 100).toFixed(1)}%</span></li>`).join("");
  const s = r.scores;
  $("#scores").textContent = `calibrated p(top-1) ${(s.p_top1 * 100).toFixed(1)}% · margin ${(s.margin * 100).toFixed(1)} pts · ` +
    `p(unknown class) ${(s.p_unknown * 100).toFixed(1)}%` + (s.proto_cos != null ? ` · prototype cosine ${s.proto_cos.toFixed(3)}` : "");
}
function addEvent(r, source, segment = null) {
  const e = { t: new Date().toISOString(), perf: performance.now(), segment, source, status: r.status, label: r.label, best: r.best,
    scores: r.scores, top5: r.top5?.map(x => x.label), handFrames: r.handFrames, used: r.used };
  state.events.push(e);
  const li = document.createElement("li");
  li.textContent = `${e.t.slice(11, 19)} ${fmt(r)}`; li.className = r.status;
  $("#events").prepend(li);
  scoreTrial(r);
}

// ------------------------------------------------------------------ video file (isolated sign)
// Seek and wait for the frame; a no-op seek never fires "seeked", and a stalled decode must not hang the lab.
function seekTo(v, t) {
  if (Math.abs(v.currentTime - t) < 1e-6 && v.readyState >= 2) return Promise.resolve();
  return new Promise(ok => {
    let done = false; const finish = () => { if (!done) { done = true; clearTimeout(timer); v.removeEventListener("seeked", finish); ok(); } };
    const timer = setTimeout(finish, 5000);
    v.addEventListener("seeked", finish);
    v.currentTime = t;
  });
}
async function runFile(file) {
  const v = document.createElement("video");
  v.muted = true; v.playsInline = true; v.src = URL.createObjectURL(file);
  await new Promise((ok, err) => { v.onloadedmetadata = ok; v.onerror = () => err(new Error("cannot decode video")); });
  const [w, h] = analysisSize(v.videoWidth, v.videoHeight);
  const n = Math.max(1, Math.round(v.duration * FPS)); // same count as ffmpeg fps=15 (round half up)
  if (n > FPS * 20) throw new Error("Videos up to 20 s are supported in file mode");
  await call({ type: "reset" });
  const frames = [], t0 = performance.now(); let handN = 0;
  for (let k = 0; k < n; k++) {
    // ffmpeg's fps filter takes the source frame nearest to k/15 s; seeking a quarter source-frame late
    // lands inside that frame's display interval for 30 fps sources.
    await seekTo(v, Math.min(v.duration - 1e-3, k / FPS + 0.008));
    const bmp = await createImageBitmap(v, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
    const r = await call({ type: "frame", image: bmp, width: w, height: h, ts: Math.round((k * 1000) / FPS) }, [bmp]);
    frames.push(r.frame); if (r.hands) handN++;
    $("#fileprog").textContent = `${k + 1}/${n} frames · hands on ${handN}`;
  }
  if (DEBUG) window.__lastFileFrames = frames.map(f => Array.from(f, x => (Number.isFinite(x) ? x : null)));
  const res = (await call({ type: "classify", frames: frames.map(f => f.buffer) }, frames.map(f => f.buffer))).result;
  URL.revokeObjectURL(v.src);
  res.fileName = file.name; res.analysisMs = performance.now() - t0; res.frameCount = n; res.handFrameCount = handN;
  showResult(res); addEvent(res, "file");
  window.__lastFileResult = res; // test hook (Playwright parity runner)
  return res;
}

// ------------------------------------------------------------------ camera (streaming)
const seg = { samples: [], active: false, start: 0, lastHand: 0, provisionalAt: 0 };
// Segment boundaries: open on a hand in signing space; stay open while any hand is visible;
// close after GAP_MS without hands or at MAX_MS. The classified window is the segment +/- MARGIN_MS,
// which prepareClip then trims to any-hand frames +/- 2 -- the same rule used for training clips.
const GAP_MS = 500, MAX_MS = 4000, MIN_HAND = 3, MARGIN_MS = 600;

async function classifySamples(samples, final) {
  const frames = resampleTo15Hz(samples);
  const r = (await call({ type: "classify", frames: frames.map(f => f.buffer) }, frames.map(f => f.buffer))).result;
  if (final) { showResult(r); addEvent(r, "camera", [samples[0].t, samples.at(-1).t]); } else showResult(r, "#proposal");
  if (!final) $("#proposal").textContent = "(provisional) " + $("#proposal").textContent;
  return r;
}

function onSample(t, frame) {
  seg.samples.push({ t, f: frame });
  while (seg.samples.length && seg.samples[0].t < t - 10000) seg.samples.shift();
  const any = hasHand(frame);
  if (!seg.active && signingEvidence(frame)) { seg.active = true; seg.start = t; seg.provisionalAt = t; }
  if (seg.active && any) seg.lastHand = t;
  if (!seg.active) return;
  const end = (!any && t - seg.lastHand > GAP_MS) || t - seg.start > MAX_MS;
  const span = seg.samples.filter(x => x.t >= seg.start - MARGIN_MS && x.t <= Math.min(t, seg.lastHand + MARGIN_MS));
  if (end) {
    seg.active = false;
    if (span.filter(x => hasHand(x.f)).length >= MIN_HAND) classifySamples(span, true);
  } else if (t - seg.provisionalAt > 500 && span.length >= 6) {
    seg.provisionalAt = t; classifySamples(span, false);
  }
}

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, frameRate: 30 }, audio: false });
  const v = $("#cam"); v.srcObject = stream; await v.play();
  await call({ type: "reset" });
  state.running = true; seg.samples = []; seg.active = false;
  const stats = state.stats = { sent: 0, done: 0, skipped: 0, hands: 0, t0: performance.now(), ms: [], recent: [] };
  let busy = false, lastSent = -1e9;
  const tick = async (now, md) => {
    if (!state.running) return;
    v.requestVideoFrameCallback(tick);
    const t = performance.now();
    if (busy || t - lastSent < 1000 / FPS - 4) { stats.skipped++; return; }
    busy = true; lastSent = t; stats.sent++;
    try {
      const [w, h] = analysisSize(v.videoWidth, v.videoHeight);
      const bmp = await createImageBitmap(v, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
      const r = await call({ type: "frame", image: bmp, width: w, height: h, ts: Math.round(t) }, [bmp]);
      stats.done++; if (r.hands) stats.hands++;
      stats.recent.push(performance.now()); while (stats.recent[0] < performance.now() - 3000) stats.recent.shift();
      stats.ms.push(r.ms); if (stats.ms.length > 60) stats.ms.shift();
      onSample(t, r.frame);
    } finally { busy = false; }
  };
  v.requestVideoFrameCallback(tick);
  const diag = setInterval(() => {
    if (!state.running) return clearInterval(diag);
    const avg = k => stats.ms.reduce((a, m) => a + m[k], 0) / Math.max(1, stats.ms.length);
    $("#diag").textContent = `analysed ${(stats.recent.length / 3).toFixed(1)} fps (target ${FPS}) · camera ${v.videoWidth}×${v.videoHeight} · ` +
      `hands on ${((100 * stats.hands) / Math.max(1, stats.done)).toFixed(0)}% of analysed frames · hand ${avg("hand").toFixed(0)} ms · ` +
      `pose ${avg("pose").toFixed(0)} ms · face ${avg("face").toFixed(0)} ms · skipped camera frames ${stats.skipped}` +
      (seg.active ? " · ● signing segment open" : "");
  }, 500);
}
function stopCamera() {
  state.running = false;
  const v = $("#cam"); v.srcObject?.getTracks().forEach(t => t.stop()); v.srcObject = null;
}

// ------------------------------------------------------------------ trials + export
let trial = null;
function scoreTrial(r) {
  if (!trial) return;
  const outcome = r.status === "accepted" ? (r.label === trial.target ? "correct" : "wrong") : r.status;
  state.trials.push({ target: trial.target, outcome, predicted: r.label, closest: r.best, scores: r.scores, at: new Date().toISOString() });
  trial = null; $("#trialstate").textContent = `Last trial: ${outcome}`;
  renderTrials();
}
function renderTrials() {
  const c = {}; for (const t of state.trials) c[t.outcome] = (c[t.outcome] ?? 0) + 1;
  $("#trialsum").textContent = `${state.trials.length} trials · ` + Object.entries(c).map(([k, v]) => `${k} ${v}`).join(" · ");
}
function exportResults() {
  const blob = new Blob([JSON.stringify({
    engine: state.meta?.version, model_sha256: state.meta?.model_sha256, commit: state.meta?.commit,
    exported: new Date().toISOString(), userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency,
    trials: state.trials, events: state.events,
    camera: state.stats ? { analysedFrames: state.stats.done, skipped: state.stats.skipped } : null,
  }, null, 1)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "signrelay-v3-results.json"; a.click();
}

// ------------------------------------------------------------------ wiring
$("#startcam").onclick = () => startCamera().catch(e => log("Camera error:", e.message));
$("#stopcam").onclick = stopCamera;
$("#file").onchange = e => { const f = e.target.files[0]; if (f) runFile(f).catch(err => log("File error:", err.message)); };
$("#trialbtn").onclick = () => {
  const target = $("#target").value.trim().toUpperCase();
  if (!state.classes.includes(target)) { $("#trialstate").textContent = "Pick a sign from the vocabulary list."; return; }
  trial = { target }; $("#trialstate").textContent = `Sign ${target} now…`;
};
$("#export").onclick = exportResults;
window.__v3 = { runFile, state };
start().catch(e => log("Startup failed:", e.message));
