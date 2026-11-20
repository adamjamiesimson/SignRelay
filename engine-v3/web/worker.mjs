// Engine V3 recognition worker: MediaPipe Tasks landmarks + ONNX Runtime Web classifier.
// Runs entirely on-device; frames arrive as ImageBitmaps and are closed after use.
import { FilesetResolver, HandLandmarker, PoseLandmarker, FaceLandmarker } from "@mediapipe/tasks-vision";
import * as ort from "onnxruntime-web/wasm";
import { gatherFrame, prepareClip, hasHand, TMAX, N_POINTS } from "./preprocess.mjs";
import { decide } from "./decision.mjs";

let hand, pose, face, session, meta, canvas, ctx, lastTs = -1, build, role = "all";
const base = new URL("./", self.location.href);

async function sha256(buf) {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function fetchVerified(path, digest) {
  const r = await fetch(new URL(path, base));
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  const buf = await r.arrayBuffer();
  if (digest && (await sha256(buf)) !== digest) throw new Error(`${path}: fingerprint mismatch`);
  return buf;
}

// role: "all" (hand + pose [+ face] + classifier), "hand" (hand + classifier), "pose" (pose only).
// Camera mode runs a "hand" and a "pose" worker in parallel so a frame costs max(hand, pose), not the sum.
async function init({ delegate = "CPU", threads = 0, role: r = "all", poseDelegate }) {
  role = r;
  const t0 = performance.now(), startup = {};
  meta = await (await fetch(new URL("meta.json", base))).json();
  const files = await FilesetResolver.forVisionTasks(new URL("vision/wasm", base).href);
  const task = async f => new Uint8Array(await fetchVerified(`vision/models/${f}`, meta.assets[f]));
  const useFace = meta.uses_face !== false; // V3 models trained without face points never run the Face Landmarker
  const wantHand = role !== "pose", wantPose = role !== "hand", wantModel = role !== "pose";
  const [hb, pb, fb, mb] = await Promise.all([wantHand ? task("hand_landmarker.task") : null, wantPose ? task("pose_landmarker_lite.task") : null,
    useFace && role === "all" ? task("face_landmarker.task") : null, wantModel ? fetchVerified("model.onnx", meta.model_sha256) : null]);
  startup.fetchMs = performance.now() - t0;
  build = async () => {
    const opts = (buf, d = delegate) => ({ baseOptions: { modelAssetBuffer: buf, delegate: d }, runningMode: "VIDEO" });
    [hand, pose, face] = await Promise.all([
      hb ? HandLandmarker.createFromOptions(files, { ...opts(hb), numHands: 2 }) : null,
      pb ? PoseLandmarker.createFromOptions(files, { ...opts(pb, poseDelegate ?? delegate), numPoses: 1 }) : null,
      fb ? FaceLandmarker.createFromOptions(files, { ...opts(fb), numFaces: 1 }) : null,
    ]);
  };
  await build();
  startup.visionMs = performance.now() - t0 - startup.fetchMs;
  if (mb) {
    ort.env.wasm.wasmPaths = new URL("ort/", base).href;
    ort.env.wasm.numThreads = threads || Math.min(4, navigator.hardwareConcurrency || 1);
    session = await ort.InferenceSession.create(mb, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  }
  if (meta.prototypes_b64) {
    const bin = Uint8Array.from(atob(meta.prototypes_b64), c => c.charCodeAt(0));
    meta.prototypes = new Float32Array(bin.buffer);
  }
  startup.totalMs = performance.now() - t0;
  return { startup, classes: meta.classes.length, version: meta.version, commit: meta.commit, model_sha256: meta.model_sha256,
    threads: ort.env.wasm.numThreads, delegate, face: useFace && role === "all", role };
}

function track(image, width, height, ts, parts = "all") {
  if (!canvas || canvas.width !== width || canvas.height !== height) {
    canvas = new OffscreenCanvas(width, height); ctx = canvas.getContext("2d", { willReadFrequently: false });
  }
  ctx.drawImage(image, 0, 0, width, height);
  if (ts <= lastTs) ts = lastTs + 1; // MediaPipe VIDEO mode needs strictly increasing timestamps
  lastTs = ts;
  const t0 = performance.now();
  const h = hand ? hand.detectForVideo(canvas, ts) : null;
  const t1 = performance.now();
  const p = pose && parts !== "hand" ? pose.detectForVideo(canvas, ts) : null;
  const t2 = performance.now();
  const f = face ? face.detectForVideo(canvas, ts) : null;
  const t3 = performance.now();
  const frame = gatherFrame(h, p, f, width, height);
  return { frame, ms: { hand: t1 - t0, pose: t2 - t1, face: t3 - t2 }, hands: h ? h.landmarks.length : 0 };
}

async function classify(frames) {
  const t0 = performance.now();
  const prep = prepareClip(frames);
  if (!prep) return { status: "no-sign", reason: "no hand observed", ms: performance.now() - t0 };
  const feeds = {
    x: new ort.Tensor("float32", prep.x, [1, TMAX, N_POINTS, 3]),
    valid: new ort.Tensor("float32", prep.valid, [1, TMAX, N_POINTS]),
    fmask: new ort.Tensor("float32", prep.fmask, [1, TMAX]),
  };
  const out = await session.run(feeds);
  const logits = out.logits.data, emb = out.embedding.data;
  const d = decide(logits, emb, meta);
  const handFrames = frames.filter(hasHand).length;
  if (handFrames < (meta.policy.min_hand_frames ?? 3)) return { ...d, status: "no-sign", reason: "too few hand frames", handFrames };
  return { ...d, logits: Array.from(logits), span: prep.span, used: prep.frames, handFrames, ms: performance.now() - t0 };
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") return self.postMessage({ type: "ready", id: data.id, ...(await init(data)) });
    if (data.type === "reset") {
      // Fresh MediaPipe graphs per clip / camera session: VIDEO-mode timestamps restart and no tracking
      // state leaks between recordings (identical to the native extractor, which builds graphs per clip).
      const t0 = performance.now();
      hand?.close(); pose?.close(); face?.close();
      await build(); lastTs = -1;
      return self.postMessage({ type: "reset", id: data.id, ms: performance.now() - t0 });
    }
    if (data.type === "frame") {
      const r = track(data.image, data.width, data.height, data.ts, data.parts);
      data.image.close?.();
      return self.postMessage({ type: "frame", id: data.id, ts: data.ts, frame: r.frame, ms: r.ms, hands: r.hands }, [r.frame.buffer]);
    }
    if (data.type === "classify") {
      const r = await classify(data.frames.map(f => (f instanceof Float32Array ? f : new Float32Array(f))));
      return self.postMessage({ type: "result", id: data.id, result: r });
    }
  } catch (e) {
    self.postMessage({ type: "error", id: data.id, message: String(e?.message ?? e) });
  }
};
