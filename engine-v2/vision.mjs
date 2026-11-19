import { FilesetResolver, HandLandmarker, PoseLandmarker } from "@mediapipe/tasks-vision";
import { observation } from "./core.mjs";
import { PoseContext } from "./pose-context.mjs";
import { HAND_ASSET } from "./assets.mjs";

const visionFiles = () => FilesetResolver.forVisionTasks(new URL("/vision/wasm", location.href).href);
const modelAssetPath = file => new URL("/vision/models/" + file, location.href).href;

export async function createPose(files = null) {
  return PoseLandmarker.createFromOptions(files ?? await visionFiles(), {
    baseOptions: { modelAssetPath: modelAssetPath("pose_landmarker_lite.task"), delegate: "CPU" },
    runningMode: "VIDEO", numPoses: 1,
  });
}

export async function tracker(mode, { handDelegate = "CPU", onDemandPose = false, framewiseHands = false,
  poseMode = "inline", warmHand = false } = {}) {
  const startup = {};
  const started = performance.now();
  let hand, pose, auxiliary;
  try {
    if (mode !== "rgb" && poseMode === "split") auxiliary = new PoseContext(new Worker("/pose.js"));
    const [files, modelBytes] = await Promise.all([visionFiles(), fetch(modelAssetPath(HAND_ASSET.file)).then(async response => {
      if (!response.ok) throw new Error("Hand Landmarker asset is unavailable");
      return new Uint8Array(await response.arrayBuffer());
    })]);
    startup.handAssetsMs = performance.now() - started;
    hand = await HandLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetBuffer: modelBytes, delegate: handDelegate },
      runningMode: framewiseHands ? "IMAGE" : "VIDEO", numHands: 2, minHandDetectionConfidence: 0.55,
      minHandPresenceConfidence: 0.55, minTrackingConfidence: 0.55,
    });
    startup.handInitMs = performance.now() - started - startup.handAssetsMs;
    const warmStarted = performance.now();
    if (warmHand) {
      const neutral = new OffscreenCanvas(192, 256);
      const context = neutral.getContext("2d");
      context.fillStyle = "#808080";
      context.fillRect(0, 0, neutral.width, neutral.height);
      if (framewiseHands) hand.detect(neutral);
      else hand.detectForVideo(neutral, 0);
    }
    startup.handWarmMs = performance.now() - warmStarted;
    const poseStarted = performance.now();
    if (mode !== "rgb" && poseMode === "inline") pose = await createPose(files);
    startup.inlinePoseInitMs = performance.now() - poseStarted;
  } catch (error) {
    auxiliary?.close();
    hand?.close();
    throw error;
  }
  let canvas, context;
  let lastPose = -Infinity;
  let points = [];
  return {
    startup,
    run(image, timestamp, stage = undefined) {
      const start = performance.now();
      stage?.("canvas");
      const sourceWidth = image.displayWidth ?? image.width;
      const sourceHeight = image.displayHeight ?? image.height;
      const scale = Math.min(1, 640 / Math.max(sourceWidth, sourceHeight));
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      if (!canvas || width !== canvas.width || height !== canvas.height) {
        canvas = new OffscreenCanvas(width, height);
        context = canvas.getContext("2d", { willReadFrequently: mode !== "landmark" });
      }
      context.drawImage(image, 0, 0, width, height);
      const copied = performance.now();
      stage?.("hand");
      const result = framewiseHands ? hand.detect(canvas) : hand.detectForVideo(canvas, timestamp + Number(warmHand));
      const hands = result.landmarks.map((landmarks, index) => ({
        landmarks, handedness: result.handedness[index]?.[0]?.categoryName,
      }));
      const tracked = performance.now();
      stage?.("pose");
      if (pose && timestamp - lastPose >= 220 && (!onDemandPose || hands.length)) {
        points = pose.detectForVideo(canvas, timestamp).landmarks[0] ?? [];
        lastPose = timestamp;
      }
      const posed = performance.now();
      const rgb = mode !== "landmark" && hands.length ? cropPixels(context, hands, width, height) : null;
      const frame = { timestamp, hands, pose: auxiliary ? auxiliary.read(timestamp) : timestamp - lastPose <= 350 ? points : [], rgb };
      const sample = observation(frame, sourceWidth / sourceHeight);
      const finished = performance.now();
      const poseRequested = auxiliary?.offer(timestamp, () => canvas.transferToImageBitmap()) ?? false;
      return { frame, sample, pose: { requested: poseRequested, failed: auxiliary?.failed ?? false,
        used: frame.pose.length > 0, sourceMs: frame.pose.length > 0 ? auxiliary?.completedAt ?? lastPose : null,
        lastResultMs: auxiliary?.duration ?? null },
      ms: { copy: copied - start, hand: tracked - copied,
        pose: posed - tracked, features: finished - posed, poseDispatch: performance.now() - finished } };
    },
    close() { hand.close(); pose?.close(); auxiliary?.close(); },
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
