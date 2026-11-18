import { FilesetResolver, HandLandmarker, PoseLandmarker } from "@mediapipe/tasks-vision";
import { observation } from "./core.mjs";

export const HAND_ASSET = {
  file: "hand_landmarker.task",
  sha256: "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1",
  url: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
};

export async function tracker(mode, { handDelegate = "CPU", onDemandPose = false, framewiseHands = false } = {}) {
  const files = await FilesetResolver.forVisionTasks(new URL("/vision/wasm", location.href).href);
  const modelAssetPath = file => new URL("/vision/models/" + file, location.href).href;
  const hand = await HandLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: modelAssetPath(HAND_ASSET.file), delegate: handDelegate },
    runningMode: framewiseHands ? "IMAGE" : "VIDEO", numHands: 2, minHandDetectionConfidence: 0.55,
    minHandPresenceConfidence: 0.55, minTrackingConfidence: 0.55,
  });
  let pose;
  try {
    if (mode !== "rgb") pose = await PoseLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: modelAssetPath("pose_landmarker_lite.task"), delegate: "CPU" },
      runningMode: "VIDEO", numPoses: 1,
    });
  } catch (error) {
    hand.close();
    throw error;
  }
  let canvas, context;
  let lastPose = -Infinity;
  let points = [];
  return {
    run(image, timestamp) {
      const start = performance.now();
      const scale = Math.min(1, 640 / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      if (!canvas || width !== canvas.width || height !== canvas.height) {
        canvas = new OffscreenCanvas(width, height);
        context = canvas.getContext("2d", { willReadFrequently: mode !== "landmark" });
      }
      context.drawImage(image, 0, 0, width, height);
      const copied = performance.now();
      const result = framewiseHands ? hand.detect(canvas) : hand.detectForVideo(canvas, timestamp);
      const hands = result.landmarks.map((landmarks, index) => ({
        landmarks, handedness: result.handedness[index]?.[0]?.categoryName,
      }));
      const tracked = performance.now();
      if (pose && timestamp - lastPose >= 220 && (!onDemandPose || hands.length)) {
        points = pose.detectForVideo(canvas, timestamp).landmarks[0] ?? [];
        lastPose = timestamp;
      }
      const posed = performance.now();
      const rgb = mode !== "landmark" && hands.length ? cropPixels(context, hands, width, height) : null;
      const frame = { timestamp, hands, pose: timestamp - lastPose <= 350 ? points : [], rgb };
      const sample = observation(frame, image.width / image.height);
      return { frame, sample, ms: { copy: copied - start, hand: tracked - copied,
        pose: posed - tracked, features: performance.now() - posed } };
    },
    close() { hand.close(); pose?.close(); },
  };
}

function cropPixels(context, hands, width, height) {
  const points = hands.flatMap(hand => hand.landmarks)
    .filter(p => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);
  if (!points.length) return null;
  const left = Math.min(...points.map(p => p.x));
  const right = Math.max(...points.map(p => p.x));
  const top = Math.min(...points.map(p => p.y));
  const bottom = Math.max(...points.map(p => p.y));
  const size = Math.min(width, height, Math.max((right - left) * width, (bottom - top) * height, height * 0.08) * 1.45);
  const grid = (center, limit) => Array.from({ length: 12 }, (_, i) => Math.min(limit - 1,
    Math.max(0, Math.trunc(center * limit + ((i + 0.5) / 12 - 0.5) * size))));
  const xs = grid((left + right) / 2, width);
  const ys = grid((top + bottom) / 2, height);
  const x0 = xs[0], y0 = ys[0];
  const cropWidth = xs.at(-1) - x0 + 1;
  const { data } = context.getImageData(x0, y0, cropWidth, ys.at(-1) - y0 + 1);
  return ys.flatMap(y => xs.flatMap(x => {
    const i = ((y - y0) * cropWidth + x - x0) * 4;
    return [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255];
  }));
}
