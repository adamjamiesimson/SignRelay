const byId = id => document.getElementById(id);
const video = byId("video");
const set = (id, value) => { byId(id).textContent = value; };
let current;

function stop(message = "Session stopped.", preserve = false) {
  const session = current;
  current = null;
  if (session) {
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

async function postFrame(session, timestamp) {
  const capture = performance.now();
  const image = await createImageBitmap(video);
  if (current !== session) { image.close(); return; }
  session.last = timestamp;
  session.captureMs = performance.now() - capture;
  session.worker.postMessage({ type: "frame", timestamp, image }, [image]);
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
    if (timestamp <= session.last) continue;
    const processed = new Promise(resolve => { session.resolveFrame = resolve; });
    await postFrame(session, timestamp);
    await processed;
    if (current !== session) return;
  }
  session.worker.postMessage({ type: "finish" });
}

function metrics(session, timings, hand, detected) {
  session.frames++;
  session.hands += Number(hand);
  session.detected += Number(detected);
  const elapsed = (performance.now() - session.started) / 1000;
  session.timings.push(timings);
  if (session.timings.length > 120) session.timings.shift();
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)].toFixed(1);
  set("fps", (session.frames / Math.max(0.1, elapsed)).toFixed(1));
  set("latency", median(session.timings.map(entry => Object.values(entry).reduce((a, b) => a + b))) + " ms");
  set("hands", session.hands + " / " + session.frames);
  set("drops", session.skipped);
  set("diagnostics", JSON.stringify({
    ...Object.fromEntries(Object.keys(timings).map(key => [key + "MsMedian", Number(median(session.timings.map(row => row[key])))])),
    captureToWorkerMs: Number(session.captureMs.toFixed(1)), sourceTimestampMs: session.last,
    sourceWidth: video.videoWidth, sourceHeight: video.videoHeight,
    timedFrames: session.timings.length, detectedHandFrames: session.detected, usableHandFrames: session.hands,
  }, null, 2));
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
    if (session.presented) session.skipped += Math.max(0, metadata.presentedFrames - session.presented - 1);
    session.presented = metadata.presentedFrames;
    if (session.busy || timestamp <= session.last) {
      session.skipped++;
      schedule(session);
      return;
    }
    session.busy = true;
    session.last = timestamp;
    schedule(session);
    try {
      await postFrame(session, timestamp);
    } catch (error) {
      if (current === session) stop("Video frame failed. Start again. " + error.message);
    }
  });
}

async function start(file) {
  stop("Loading recognition model…");
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
  const session = { worker, abort: new AbortController(), frames: 0, hands: 0, detected: 0, skipped: 0, last: -Infinity,
    captureMs: 0, timings: [], events: [] };
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
  worker.onerror = () => { if (current === session) stop("Recognition worker stopped. Start again to reload it."); };
  worker.onmessage = async ({ data }) => {
    if (current !== session) return;
    if (data.type === "error") { stop("Recognition failed. " + data.message); return; }
    if (data.type === "ready") {
      set("version", data.version);
      set("vocabulary", data.vocabulary.join(", "));
      try {
        if (file) { await stepClip(session); return; }
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access requires HTTPS or localhost.");
        set("status", "Waiting for camera permission…");
        const media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, resizeMode: { ideal: "none" } }, audio: false,
        });
        if (current !== session) { media.getTracks().forEach(track => track.stop()); return; }
        session.media = media;
        for (const track of media.getVideoTracks()) track.addEventListener("ended", () => {
          if (current === session) stop("Camera disconnected. Start the camera to reconnect.");
        }, { once: true });
        video.srcObject = media;
        await video.play();
        if (current !== session) return;
        session.started = performance.now();
        set("status", "Camera running");
        schedule(session);
      } catch (error) {
        if (current === session) stop("Could not open " + (file ? "this video. " : "the camera. ") + error.message);
      }
    }
    if (data.type === "frame") {
      session.busy = false;
      metrics(session, data.ms, data.hand, data.detected);
      if (data.result) show(data.result);
      if (data.result?.event) {
        session.events.push(data.result.event);
        if (session.events.length > 10) session.events.shift();
        set("events", "Recent suggestions · " + session.events.join(" · "));
      }
      session.resolveFrame?.();
      session.resolveFrame = null;
    }
    if (data.type === "done") {
      show(data.result);
      stop("File complete · isolated clip result", true);
    }
  };
  session.watchdog = setInterval(() => {
    if (current !== session || session.started === undefined) return;
    const now = performance.now();
    if (session.frames !== session.lastFrames) {
      session.lastFrames = session.frames;
      session.lastProgress = now;
    } else if (now - (session.lastProgress ?? session.started) > (file ? 15000 : 6000)) {
      stop("Analysis timed out. Start again to recover.");
    }
  }, 1000);
  worker.postMessage({ type: "start", bounded: Boolean(file) });
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
import { loadVideoData, seekDecodedFrame } from "../scripts/diagnostics/video-frame-step";

