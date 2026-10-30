// Condition C capture page (diagnostic only; never part of the app build).
// Runs the production VisionEngine and recognition worker on a decoded video
// exactly as the recognition lab does: one unique decoded source frame every
// 50 ms of media time, CPU delegate, pose refreshed by the engine's own rule.
// Returns the complete frame sequence and every worker message to the local
// driver; nothing is uploaded.
import { VisionEngine } from "../../lib/vision-engine";
import { RecognitionSession } from "../../lib/recognition-session";
import type { VisionFrame, WorkerMessage } from "../../lib/vision-types";
import { loadVideoData, seekDecodedFrame } from "../diagnostics/video-frame-step";

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function capture(videoUrl: string, workerUrl: string, pauseMs = 0) {
  const video = document.createElement("video");
  video.muted = true; video.playsInline = true; video.preload = "auto";
  document.body.append(video); // frame callbacks need an attached element
  const canvas = document.createElement("canvas");
  const engine = await VisionEngine.create(() => {}, false);
  const frames: VisionFrame[] = [];
  const messages: (WorkerMessage & { receivedAt: number })[] = [];
  const statuses: string[] = [];
  const session = new RecognitionSession(() => new Worker(workerUrl, { type: "module" }),
    message => messages.push({ ...structuredClone(message), receivedAt: performance.now() }),
    status => statuses.push(`${status.state}: ${status.message}`), true);
  try {
    session.postMessage({ type: "templates", language: "asl", templates: [] });
    await loadVideoData(video, videoUrl);
    if (!Number.isFinite(video.duration) || video.duration > 30) throw new Error("Use a clip of at most 30 seconds");
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const context = canvas.getContext("2d")!;
    const base = performance.now();
    let previous = 0, last = base;
    const started = performance.now();
    const step = (timestamp: number) => {
      context.drawImage(video, 0, 0);
      const frame = engine.process(canvas, timestamp);
      frames.push(structuredClone(frame));
      session.postMessage({ type: "frame", frame });
    };
    step(base); // the first decoded frame, as the recognition lab does
    for (let time = 0.05; time < video.duration; time += 0.05) {
      const decoded = await seekDecodedFrame(video, time);
      if (decoded <= previous + 0.001) continue;
      previous = decoded;
      last = base + decoded * 1000;
      step(last);
      await sleep(50);
    }
    // Optional: the signer holds still after the clip, as the app asks ("pause
    // briefly between words"). Repeats the final decoded image with advancing
    // timestamps; reported separately from the strict clip-only run.
    for (let held = 50; held <= pauseMs; held += 50) {
      step(last + held);
      await sleep(50);
    }
    await sleep(600);
    return { frames, messages, statuses, wallMs: performance.now() - started,
      video: { width: video.videoWidth, height: video.videoHeight, duration: video.duration } };
  } finally {
    session.terminate(); engine.close();
    video.removeAttribute("src"); video.load(); video.remove();
  }
}

(window as Window & { signrelayCapture?: typeof capture }).signrelayCapture = capture;
