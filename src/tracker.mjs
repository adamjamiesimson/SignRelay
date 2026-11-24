import { FilesetResolver, HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import { gatherFrame } from './upstream-preprocess.mjs';

let hand, pose, canvas, context, prevPose, sequence = 0, lastTimestamp = 0;
const asset = path => new URL(path, self.location.href).href;

async function verified(path, expected) {
  const response = await fetch(asset(path));
  if (!response.ok) throw new Error('Missing ' + path + ' (' + response.status + ')');
  const bytes = await response.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (sha !== expected) throw new Error('Fingerprint mismatch for ' + path);
  return new Uint8Array(bytes);
}
async function initialize() {
  const [files, handTask, poseTask] = await Promise.all([
    FilesetResolver.forVisionTasks(asset('vision')),
    verified('vision/hand_landmarker.task', 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1'),
    verified('vision/pose_landmarker_lite.task', '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a'),
  ]);
  const options = modelAssetBuffer => ({ baseOptions: { modelAssetBuffer, delegate: 'CPU' }, runningMode: 'VIDEO' });
  hand = await HandLandmarker.createFromOptions(files, { ...options(handTask), numHands: 2 });
  pose = await PoseLandmarker.createFromOptions(files, { ...options(poseTask), numPoses: 1 });
  const warmup = new OffscreenCanvas(320, 240);
  const warmupContext = warmup.getContext('2d');
  warmupContext.fillStyle = '#444';
  warmupContext.fillRect(0, 0, warmup.width, warmup.height);
  hand.detectForVideo(warmup, 1);
  pose.detectForVideo(warmup, 1);
  lastTimestamp = 1;
}

function track({ bitmap, timestamp, id, compact, overlay = true }) {
  const began = performance.now();
  const long = Math.max(bitmap.width, bitmap.height);
  const ratio = Math.min(1, (compact ? 352 : 960) / long);
  const width = Math.round(bitmap.width * ratio);
  const height = Math.round(bitmap.height * ratio);
  try {
    if (!canvas || canvas.width !== width || canvas.height !== height) {
      canvas = new OffscreenCanvas(width, height);
      context = canvas.getContext('2d');
      prevPose = null;
    }
    context.drawImage(bitmap, 0, 0, width, height);
  } finally {
    bitmap.close();
  }
  lastTimestamp = Math.max(lastTimestamp + 1, timestamp);
  const detected = hand.detectForVideo(canvas, lastTimestamp);
  if (!prevPose || sequence++ % (compact ? 3 : 2) === 0) prevPose = pose.detectForVideo(canvas, lastTimestamp);
  const observation = gatherFrame(detected, prevPose, null, width, height);
  self.postMessage({ type: 'frame', id, timestamp, observation, handCount: detected.landmarks.length,
    hands: overlay ? detected.landmarks : [],
    ms: Math.round(performance.now() - began) }, [observation.buffer]);
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      await initialize();
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'frame') {
      track(data);
    }
  } catch (error) {
    self.postMessage({ type: 'error', detail: error.message || String(error) });
  }
};

