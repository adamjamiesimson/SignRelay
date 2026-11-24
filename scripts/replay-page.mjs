import { startWorkers } from '../src/workers.mjs';
import { PROFILE, verificationInterval, verificationWindows } from '../src/verification.mjs';

const workers = startWorkers();
globalThis.ready = workers.ready;
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');
let clock = 1000;

function event(element, type, action = () => {}) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => { controller.abort(); reject(new Error('Video event timed out: ' + type)); }, 3500);
    const finish = error => {
      clearTimeout(timeout);
      controller.abort();
      if (error) reject(error); else resolve();
    };
    element.addEventListener(type, () => finish(), { signal: controller.signal });
    element.addEventListener('error', () => finish(new Error(element.error?.message || 'Video decode error')), { signal: controller.signal });
    action();
  });
}

globalThis.replay = async ({ file, targets, variant, strategies = ['baseline'], fps: requestedFps }) => {
  const video = document.createElement('video');
  const history = [];
  const schedules = strategies.map(name => ({ name, timeline: [], last: -Infinity, windows: 0 }));
  const trackingMs = [];
  let frameCount = 0;
  let tracked = 0;
  const start = performance.now();
  const previousClock = clock;
  const transformed = ['mirror', 'dim'].includes(variant);
  try {
    if (file) {
      video.muted = true;
      video.preload = 'auto';
      await event(video, 'loadeddata', () => { video.src = '/fixtures/' + encodeURIComponent(file); });
    }
    const duration = file ? Math.min(7, video.duration) : 2.6;
    const fps = requestedFps ?? (variant === 'sparse' ? 5 : 15);
    const sparse = fps < PROFILE.sparseFps;
    const frames = Math.ceil(duration * fps);
    const speed = variant === 'fast' ? 0.73 : variant === 'slow' ? 1.3 : 1;
    const sequence = Array.from({ length: frames }, (_, n) => n);
    if (variant === 'scrambled') {
      let seed = 37488;
      for (let n = frames - 1; n > 0; n--) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const next = seed % (n + 1);
        [sequence[n], sequence[next]] = [sequence[next], sequence[n]];
      }
    }
    for (let n = 0; n < frames; n++) {
      const sourceTime = Math.min(sequence[n] / fps, duration - 0.015);
      if (file && (n || sequence[n])) await event(video, 'seeked', () => { video.currentTime = sourceTime; });
      let bitmap;
      if (!file || transformed) {
        canvas.width = video.videoWidth || 480;
        canvas.height = video.videoHeight || 360;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.filter = variant === 'dim' ? 'brightness(0.55)' : 'none';
        if (variant === 'mirror') ctx.setTransform(-1, 0, 0, 1, canvas.width, 0);
        if (file) ctx.drawImage(video, 0, 0);
        else { ctx.fillStyle = '#333'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
        bitmap = await createImageBitmap(canvas);
      } else bitmap = await createImageBitmap(video);
      clock = previousClock + n * 1000 / fps * speed;
      const reply = await workers.tracker.request('frame', { bitmap, timestamp: clock, compact: sparse }, [bitmap]);
      frameCount++;
      trackingMs.push(reply.ms);
      if (reply.hands.length) tracked++;
      history.push({ t: clock, f: reply.observation });
      while (history[0]?.t < clock - PROFILE.historyMs) history.shift();
      for (const schedule of schedules) {
        const baseline = schedule.name === 'baseline';
        if (clock - schedule.last < verificationInterval(sparse, baseline) - 0.001) continue;
        const windows = verificationWindows(history, sparse, baseline);
        schedule.last = clock;
        const t = Math.round(clock - previousClock);
        if (!windows.length) {
          schedule.timeline.push({ t, values: targets.map(() => ({ score: 0 })) });
          continue;
        }
        schedule.windows += windows.length;
        const check = await workers.classifier.request('verify', { windows, targets, timestamp: clock });
        schedule.timeline.push({ t, values: check.values, cpuMs: check.ms });
      }
    }
    return { duration, frameCount, tracked, trackingMs, timeline: schedules[0].timeline,
      schedules, wallMs: Math.round(performance.now() - start) };
  } finally {
    clock += 1000;
    video.removeAttribute('src');
    video.load();
  }
};

