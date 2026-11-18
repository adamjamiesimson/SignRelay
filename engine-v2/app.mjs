import { loadVideoData, seekDecodedFrame } from "../scripts/diagnostics/video-frame-step";
import { FrameTrace } from "./frame-trace.mjs";
import { LatestFrame } from "./latest-frame.mjs";
import { bindWebcamTrials } from "./webcam-trials.mjs";

const byId = id => document.getElementById(id);
const video = byId("video");
const set = (id, value) => { byId(id).textContent = value; };
let current;
let lastTrace;
let lastRuntime;
let gpuFallback;
const webcamTrials = bindWebcamTrials({
  startCamera: trial => { void start(null, { trial }); },
  finishCamera: () => stop("Trial finished.", { completed: true }),
});
const clock = () => performance.timeOrigin + performance.now();
window.signRelayCameraDiagnostics = () => {
  const trace = current?.trace ?? lastTrace;
  return trace ? { ...trace.snapshot(), runtime: current?.runtime ?? lastRuntime, gpuFallback } : null;
};

function stop(message = "Session stopped.", { preserve = false, completed = false, retry = false } = {}) {
  const session = current;
  current = null;
  if (!retry) {
    const seconds = session?.started === undefined ? 0 : (performance.now() - session.started) / 1000;
    webcamTrials.end(completed && !!session?.frames, { frames: session?.frames, hands: session?.hands,
      fps: seconds > 0 ? session.frames / seconds : null, startup: session?.trace.startup.cameraPlayingMs });
  }
  if (session) {
    if (session.active) session.trace.mark(session.active, "cancelled");
    session.latest.clear("cancelled");
    void session.reader?.cancel().catch(() => {});
    lastTrace = session.trace;
    lastRuntime = session.runtime;
    clearTimeout(session.readyTimeout);
    clearInterval(session.watchdog);
    session.abort.abort(new Error("Session stopped"));
    session.resolveFrame?.();
    if (session.callback !== undefined) video.cancelVideoFrameCallback(session.callback);
    session.worker.terminate();
    session.media?.getTracks().forEach(track => track.stop());
    if (session.url) URL.revokeObjectURL(session.url);
  }
  video.pause();
  video.srcObject = null;
  video.removeAttribute("src");
  video.load();
  byId("stop").disabled = true;
  byId("file").value = "";
  set("status", message);
  if (!preserve) {
    set("match", "No match");
    set("reason", "");
  }
}

async function postFrame(session, record) {
  const capture = performance.now();
  const image = session.capture === "snapshot" && typeof VideoFrame === "function"
    ? new VideoFrame(video, { timestamp: Math.round(record.sourceMs * 1000) }) : await createImageBitmap(video);
  if (current !== session) { image.close(); return; }
  session.trace.mark(record, "captured");
  record.capturedAt = clock();
  session.captureMs = performance.now() - capture;
  sendFrame(session, record, image);
}

function sendFrame(session, record, image) {
  try {
    session.worker.postMessage({ type: "frame", id: record.id, timestamp: record.sourceMs, image }, [image]);
    session.trace.mark(record, "sent");
    record.sentAt = clock();
  } catch (error) {
    image.close();
    throw error;
  }
}

function dispatchTrackFrame(session, { record, image }) {
  session.active = record;
  session.trace.mark(record, "accepted");
  session.trace.occupy(1);
  try {
    sendFrame(session, record, image);
  } catch (error) {
    session.trace.mark(record, "captureError");
    session.active = null;
    stop("Video frame failed. Start again. " + error.message);
  }
}

async function readTrack(session, track) {
  const reader = new MediaStreamTrackProcessor({ track, maxBufferSize: 1 }).readable.getReader();
  session.reader = reader;
  let origin;
  while (current === session) {
    const { value: image, done } = await reader.read();
    if (done) {
      if (current === session) stop("Camera disconnected. Start the camera to reconnect.");
      return;
    }
    if (current !== session) { image.close(); return; }
    origin ??= image.timestamp;
    const timestamp = (image.timestamp - origin) / 1000;
    const record = session.trace.present(timestamp, clock(), null, 0, false);
    if (!Number.isFinite(timestamp) || timestamp <= session.last) {
      image.close();
      session.trace.mark(record, "invalidTimestamp");
      continue;
    }
    session.last = timestamp;
    session.trace.mark(record, "captured");
    record.capturedAt = record.at;
    if (session.active) {
      session.trace.mark(record, "queued");
      session.latest.offer(record, image);
      session.trace.occupy(2);
    } else dispatchTrackFrame(session, { record, image });
  }
}

async function stepClip(session) {
  const signal = session.abort.signal;
  await loadVideoData(video, session.url, { signal });
  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0.05 || duration > 15) {
    throw new Error("Choose an isolated clip between 0.05 and 15 seconds.");
  }
  session.started = performance.now();
  set("status", "Analyzing video frames…");
  for (let step = 1; step / 20 < duration; step++) {
    const timestamp = 1000 * await seekDecodedFrame(video, step / 20, { signal, timeoutMs: 12000 });
    const record = session.trace.present(timestamp, clock());
    if (!Number.isFinite(timestamp) || timestamp <= session.last) {
      session.trace.mark(record, "invalidTimestamp");
      continue;
    }
    const processed = new Promise(resolve => { session.resolveFrame = resolve; });
    session.active = record;
    session.last = timestamp;
    session.trace.mark(record, "accepted");
    session.trace.occupy(1);
    try {
      await postFrame(session, record);
    } catch (error) {
      session.trace.mark(record, "captureError");
      session.active = null;
      throw error;
    }
    await processed;
    if (current !== session) return;
  }
  session.worker.postMessage({ type: "finish" });
}

function renderMetrics(session) {
  if (!session.timings.length) return;
  const elapsed = (performance.now() - session.started) / 1000;
  const timings = session.timings.at(-1);
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)].toFixed(1);
  set("fps", (session.frames / Math.max(0.1, elapsed)).toFixed(1));
  set("latency", median(session.timings.map(entry => Object.values(entry).reduce((a, b) => a + b))) + " ms");
  set("hands", session.hands + " / " + session.frames);
  const { counters } = session.trace;
  const previewDrops = session.capture === "track" ? 0 : counters.callbackGaps + counters.busy;
  set("drops", previewDrops + counters.replaced + counters.stale + counters.invalidTimestamp);
  set("diagnostics", JSON.stringify({
    ...Object.fromEntries(Object.keys(timings).map(key => [key + "MsMedian", Number(median(session.timings.map(row => row[key])))])),
    captureToWorkerMs: Number(session.captureMs.toFixed(1)), sourceTimestampMs: session.last,
    sourceWidth: video.videoWidth, sourceHeight: video.videoHeight,
    timedFrames: session.timings.length, detectedHandFrames: session.detected, usableHandFrames: session.hands,
  }, null, 2));
}

function metrics(session, timings, hand, detected) {
  session.frames++;
  session.hands += Number(hand);
  session.detected += Number(detected);
  session.timings.push(timings);
  if (session.timings.length > 120) session.timings.shift();
  const now = performance.now();
  if (now - (session.lastRender ?? -Infinity) >= 200) {
    session.lastRender = now;
    renderMetrics(session);
  }
}

function show(result) {
  set("match", result?.label || "No match");
  const score = result?.score === undefined ? "" : " · model score " + result.score.toFixed(2);
  set("reason", (result?.reason ?? "") + score);
}

function schedule(session) {
  if (current !== session || video.ended) return;
  session.callback = video.requestVideoFrameCallback(async (_now, metadata) => {
    if (current !== session) return;
    const timestamp = metadata.mediaTime * 1000;
    const gaps = session.presented ? Math.max(0, metadata.presentedFrames - session.presented - 1) : 0;
    session.presented = metadata.presentedFrames;
    const record = session.trace.present(timestamp, clock(), metadata.presentedFrames, gaps);
    if (session.capture === "track") {
      schedule(session);
      return;
    }
    if (session.active || !Number.isFinite(timestamp) || timestamp <= session.last) {
      session.trace.mark(record, session.active ? "busy" : "invalidTimestamp");
      schedule(session);
      return;
    }
    session.active = record;
    session.last = timestamp;
    session.trace.mark(record, "accepted");
    session.trace.occupy(1);
    schedule(session);
    try {
      await postFrame(session, record);
    } catch (error) {
      if (current === session) {
        session.trace.mark(record, "captureError");
        session.active = null;
        stop("Video frame failed. Start again. " + error.message);
      }
    }
  });
}

async function start(file, { forceCpu = false, requestedAt = performance.now(), trial } = {}) {
  if (!forceCpu) gpuFallback = null;
  stop(forceCpu ? "Restarting camera tracking on the CPU…" : "Loading recognition model…", { retry: forceCpu });
  if (trial) webcamTrials.begin(trial);
  if (!video.requestVideoFrameCallback || !window.OffscreenCanvas) {
    stop("This browser lacks the video APIs used by the lab.");
    return;
  }
  let worker;
  try {
    worker = new Worker("/tracker.js");
  } catch (error) {
    stop("Recognition worker could not start. " + error.message);
    return;
  }
  const session = { worker, abort: new AbortController(), trace: new FrameTrace(), frames: 0, hands: 0, detected: 0,
    last: -Infinity, captureMs: 0, timings: [], events: [] };
  session.trace.startup = {};
  session.latest = new LatestFrame((record, reason) => session.trace.mark(record, reason));
  current = session;
  byId("stop").disabled = false;
  set("events", "");
  for (const id of ["fps", "latency", "hands", "drops"]) set(id, "—");
  if (file) {
    session.url = URL.createObjectURL(file);
    video.classList.remove("camera");
  } else {
    video.classList.add("camera");
  }
  function workerError(message) {
    if (session.active) {
      session.trace.mark(session.active, "workerError");
      session.active = null;
    }
    stop(message);
  }
  function retryCpu(stage, elapsedMs) {
    gpuFallback = { stage, elapsedMs, sent: session.trace.counters.sent, processed: session.trace.counters.processed };
    webcamTrials.retry();
    void start(null, { forceCpu: true, requestedAt });
  }
  worker.onerror = () => { if (current === session) workerError("Recognition worker stopped. Start again to reload it."); };
  worker.onmessage = async ({ data }) => {
    if (current !== session) return;
    if (data.type === "error") { workerError("Recognition failed. " + data.message); return; }
    if (data.type === "warming") {
      clearTimeout(session.readyTimeout);
      set("status", "Preparing the GPU hand tracker…");
      const started = performance.now();
      session.readyTimeout = setTimeout(() => {
        if (current !== session) return;
        if (data.automatic) retryCpu("warm-up", performance.now() - started);
        else workerError("GPU hand tracker took too long to load.");
      }, 28000);
      return;
    }
    if (data.type === "progress" && session.active?.id === data.id) {
      session.active.workerStage = data.stage;
      session.active.workerStageAt = data.at;
      return;
    }
    if (data.type === "ready") {
      clearTimeout(session.readyTimeout);
      Object.assign(session.trace.startup, data.startup, { workerReadyMs: performance.now() - requestedAt });
      session.capture = file ? "bitmap" : data.capture === "track" && typeof MediaStreamTrackProcessor !== "function"
        ? typeof VideoFrame === "function" ? "snapshot" : "bitmap" : data.capture;
      session.runtime = { capture: session.capture, hands: data.handDelegate, pose: data.poseMode };
      session.mayFallback = !file && data.auto && data.handDelegate === "GPU";
      set("version", data.version);
      set("vocabulary", data.vocabulary.join(", "));
      try {
        if (file) { await stepClip(session); return; }
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access requires HTTPS or localhost.");
        set("status", "Waiting for camera permission…");
        const acquiring = performance.now();
        const media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, resizeMode: { ideal: "none" } }, audio: false,
        });
        if (current !== session) { media.getTracks().forEach(track => track.stop()); return; }
        session.trace.startup.cameraAcquireMs = performance.now() - acquiring;
        session.media = media;
        for (const track of media.getVideoTracks()) track.addEventListener("ended", () => {
          if (current === session) stop("Camera disconnected. Start the camera to reconnect.");
        }, { once: true });
        video.srcObject = media;
        await video.play();
        if (current !== session) return;
        session.started = performance.now();
        session.trace.startup.cameraPlayingMs = session.started - requestedAt;
        set("status", "Camera running");
        webcamTrials.ready();
        schedule(session);
        if (session.capture === "track") void readTrack(session, media.getVideoTracks()[0]).catch(error => {
          if (current === session) stop("Could not read camera frames. " + error.message);
        });
      } catch (error) {
        if (current === session) stop("Could not open " + (file ? "this video. " : "the camera. ") + error.message);
      }
    }
    if (data.type === "frame") {
      if (!session.active || session.active.id !== data.id) {
        workerError("Recognition worker returned an unexpected frame.");
        return;
      }
      session.trace.complete(session.active, data, clock());
      session.trace.startup.firstFrameMs ??= performance.now() - requestedAt;
      if (data.hand) session.trace.startup.firstUsableHandMs ??= performance.now() - requestedAt;
      session.active = null;
      const pending = session.latest.take(clock());
      if (pending) dispatchTrackFrame(session, pending);
      if (current !== session) return;
      metrics(session, data.ms, data.hand, data.detected);
      if (data.result) show(data.result);
      if (data.result?.event) {
        webcamTrials.observe(data.result.event);
        session.events.push(data.result.event);
        if (session.events.length > 10) session.events.shift();
        set("events", "Recent suggestions · " + session.events.join(" · "));
      }
      session.resolveFrame?.();
      session.resolveFrame = null;
    }
    if (data.type === "done") {
      session.trace.isolatedInput = data.input;
      renderMetrics(session);
      show(data.result);
      stop("File complete · isolated clip result", { preserve: true });
    }
  };
  session.watchdog = setInterval(() => {
    if (current !== session || session.started === undefined) return;
    const now = performance.now();
    if (session.mayFallback && !session.frames && session.active?.sentAt && clock() - session.active.sentAt > 2200) {
      retryCpu(session.active.workerStage ?? "worker receive", clock() - session.active.sentAt);
      return;
    }
    if (session.frames !== session.lastFrames) {
      session.lastFrames = session.frames;
      session.lastProgress = now;
    } else if (now - (session.lastProgress ?? session.started) > (file ? 15000 : 6000)) {
      stop("Analysis timed out. Start again to recover.");
    }
  }, 500);
  session.readyTimeout = setTimeout(() => {
    if (current === session) workerError("Recognition worker took too long to load. Start again to retry.");
  }, 20000);
  worker.postMessage({ type: "start", bounded: Boolean(file), forceCpu });
}

video.addEventListener("error", () => {
  if (current) stop("Could not decode this video. Try an MP4 or WebM file.");
});
byId("camera").addEventListener("click", () => { void start(null); });
byId("file").addEventListener("change", event => {
  if (event.target.files[0]) void start(event.target.files[0]);
});
byId("stop").addEventListener("click", () => stop());
document.addEventListener("visibilitychange", () => {
  if (document.hidden && current) stop("Session paused when the tab was hidden.");
});
window.addEventListener("pagehide", () => stop());

