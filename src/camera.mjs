import { startWorkers } from './workers.mjs';
import { Confirmation, PROFILE, WINDOWS, windowFor } from './verification.mjs';

const links = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[17,0]];
const friendly = error => {
  if (error.name === 'NotAllowedError') return 'Camera permission is blocked. Allow it in the browser, then retry.';
  if (error.name === 'NotFoundError') return 'No camera found. Reconnect it, then retry.';
  if (error.name === 'NotReadableError') return 'The camera could not start. Close other camera apps, then retry.';
  if (error.name === 'OverconstrainedError') return 'The selected camera is unavailable. Choose another camera in Host controls.';
  return error.message || 'Camera unavailable.';
};

function cameraReady(video) {
  if (video.readyState >= 2 && video.videoWidth) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const listener = new AbortController();
    const timeout = setTimeout(() => {
      listener.abort();
      reject(new Error('Camera started without a video frame. Retry or choose another camera.'));
    }, 6500);
    video.addEventListener('loadeddata', () => {
      clearTimeout(timeout);
      listener.abort();
      resolve();
    }, { once: true, signal: listener.signal });
  });
}

export class Camera {
  constructor(video, overlay, notify, settings) {
    this.video = video;
    this.overlay = overlay;
    this.notify = notify;
    this.settings = settings;
    this.history = [];
    this.signal = new Confirmation();
    this.generation = 0;
    this.model = 'Waiting';
    this.status = 'Camera off';
  }

  warm() {
    if (this.workers) return this.workers.ready;
    this.model = 'Loading hand, pose and sign models…';
    this.notify('model', this.model);
    try {
      this.workers = startWorkers();
      const current = this.workers;
      current.ready.then(() => {
        if (this.workers !== current) return;
        this.model = 'Ready';
        this.notify('model', 'Hand, pose and ASL models ready');
      }, error => {
        if (this.workers !== current) return;
        current.close();
        this.workers = null;
        this.model = 'Error · ' + error.message;
        this.notify('model', this.model);
      });
      return current.ready;
    } catch (error) {
      this.model = 'Error · ' + error.message;
      this.notify('model', this.model);
      return Promise.reject(error);
    }
  }

  async open(device) {
    if (this.stream?.active && device === this.device) return true;
    this.stopCamera();
    const generation = this.generation;
    this.status = 'Waiting for camera permission…';
    this.notify('camera', this.status);
    let stream;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Open GameShow on HTTPS or the local booth address to use the camera.');
      const constraints = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } };
      if (device) constraints.deviceId = { exact: device };
      stream = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });
      if (generation !== this.generation) {
        for (const track of stream.getTracks()) track.stop();
        return false;
      }
      this.device = device;
      this.stream = stream;
      this.video.srcObject = stream;
      const track = stream.getVideoTracks()[0];
      track.addEventListener('ended', () => {
        if (this.stream === stream) this.fault('Camera disconnected.');
      }, { once: true });
      await Promise.all([this.video.play(), cameraReady(this.video)]);
      if (generation !== this.generation) return false;
      this.status = 'Camera on · ' + this.video.videoWidth + ' × ' + this.video.videoHeight;
      this.notify('camera', this.status);
      return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      this.stopCamera();
      this.status = friendly(error);
      this.notify('camera', this.status);
      throw new Error(this.status);
    }
  }

  resetSignal() {
    this.history = [];
    this.signal.reset();
    this.lastAnalysis = -Infinity;
  }

  play(run, word, threshold) {
    this.stopAnalysis();
    this.resetSignal();
    const attempt = { run, word, threshold, lastVideo: performance.now(), lastSample: -Infinity, latest: -Infinity, mediaTime: -1, cadence: [] };
    this.attempt = attempt;
    this.videoFrame(attempt);
    this.watchdog = setInterval(() => {
      if (this.attempt !== attempt) return;
      if (this.stream?.getVideoTracks()[0]?.readyState !== 'live' || performance.now() - attempt.lastVideo > 3400) {
        this.fault('Camera stopped sending frames.');
      }
    }, 900);
  }

  videoFrame(attempt) {
    this.frameHandle = this.video.requestVideoFrameCallback((now, frame) => {
      if (this.attempt !== attempt) return;
      this.videoFrame(attempt);
      if (frame.mediaTime === attempt.mediaTime) return;
      attempt.mediaTime = frame.mediaTime;
      attempt.lastVideo = now;
      attempt.latest = now;
      void this.capture(attempt);
    });
  }

  async capture(attempt) {
    if (this.frameBusy || !attempt || this.attempt !== attempt ||
        !Number.isFinite(attempt.latest) || attempt.latest - attempt.lastSample < PROFILE.sampleMs) return;
    const timestamp = attempt.latest;
    attempt.lastSample = timestamp;
    this.frameBusy = true;
    try {
      const bitmap = await createImageBitmap(this.video);
      if (this.attempt !== attempt) { bitmap.close(); return; }
      const data = await this.workers.tracker.request('frame', { bitmap, timestamp, compact: attempt.compact }, [bitmap]);
      if (this.attempt === attempt) this.analyze(attempt, data);
    } catch (error) {
      if (this.attempt === attempt) this.fault(error.message, true);
    } finally {
      this.frameBusy = false;
      void this.capture(this.attempt);
    }
  }

  analyze(attempt, data) {
    this.draw(data.hands);
    attempt.cadence.push(data.timestamp);
    while (attempt.cadence[0] < data.timestamp - 2200) attempt.cadence.shift();
    const span = data.timestamp - attempt.cadence[0];
    const fps = span > 300 ? (attempt.cadence.length - 1) * 1000 / span : null;
    this.notify('hands', { count: data.hands.length, ms: data.ms, fps: fps === null ? null : Math.round(fps) });
    const sparse = fps !== null && fps < PROFILE.sparseFps;
    if (attempt.cadence.length >= 4 && fps !== null && fps < 7) attempt.compact = true;
    if (data.timestamp - (this.history.at(-1)?.t ?? data.timestamp) > PROFILE.sparseGap) this.resetSignal();
    this.history.push({ t: data.timestamp, f: data.observation });
    while (this.history[0]?.t < data.timestamp - PROFILE.historyMs) this.history.shift();
    if (this.verifying || data.timestamp - this.lastAnalysis < PROFILE.evaluateEvery) return;
    const windows = WINDOWS.map(ms => windowFor(this.history, ms, sparse)).filter(Boolean).map(window => window.frames);
    this.lastAnalysis = data.timestamp;
    if (!windows.length) {
      this.signal.reset();
      this.notify('evidence', { score: 0, p: 0, cosine: 0, unknown: 0, ms: data.ms });
      return;
    }
    this.verifying = true;
    this.workers.classifier.request('verify', { timestamp: data.timestamp, targets: [attempt.word], windows }).then(reply => {
      if (this.attempt !== attempt || performance.now() - reply.timestamp > 1200) return;
      const [evidence] = reply.values;
      this.notify('evidence', { ...evidence, ms: reply.ms });
      if (this.signal.push(evidence.score, reply.timestamp, attempt.threshold)) this.notify('match', attempt.run);
    }).catch(error => {
      if (this.attempt === attempt) this.fault(error.message, true);
    }).finally(() => { this.verifying = false; });
  }

  draw(hands) {
    const canvas = this.overlay;
    const context = canvas.getContext('2d');
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const deviceScale = Math.min(devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(width * deviceScale));
    const h = Math.max(1, Math.round(height * deviceScale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    context.clearRect(0, 0, w, h);
    if (!this.settings().overlay || !this.video.videoWidth || !hands.length) return;
    const ratio = Math.min(w / this.video.videoWidth, h / this.video.videoHeight);
    const frameW = this.video.videoWidth * ratio;
    const frameH = this.video.videoHeight * ratio;
    const left = (w - frameW) / 2;
    const top = (h - frameH) / 2;
    const location = point => [left + (1 - point.x) * frameW, top + point.y * frameH];
    context.strokeStyle = '#bcffc6';
    context.lineWidth = 2.2 * deviceScale;
    context.lineCap = 'round';
    context.fillStyle = '#e6ffe9';
    for (const hand of hands) {
      for (const [a, b] of links) {
        context.beginPath();
        context.moveTo(...location(hand[a]));
        context.lineTo(...location(hand[b]));
        context.stroke();
      }
      for (const point of hand) {
        context.beginPath();
        context.arc(...location(point), 2.6 * deviceScale, 0, 2 * Math.PI);
        context.fill();
      }
    }
  }

  fault(message, workers = false) {
    this.stopCamera();
    this.status = message;
    if (workers) {
      this.workers?.close();
      this.workers = null;
      this.model = 'Recovering';
    }
    this.notify('fault', { message, workers });
  }

  stopAnalysis() {
    this.attempt = null;
    clearInterval(this.watchdog);
    if (this.frameHandle !== undefined) this.video.cancelVideoFrameCallback?.(this.frameHandle);
    this.frameHandle = undefined;
    this.draw([]);
    this.resetSignal();
  }

  stopCamera() {
    this.generation++;
    this.stopAnalysis();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
    this.status = 'Camera off';
  }
}

