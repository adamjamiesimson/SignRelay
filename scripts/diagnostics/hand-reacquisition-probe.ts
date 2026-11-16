// Browser half of hand-reacquisition-probe.mjs. Moves a public still photo of a
// hand across a canvas and counts the frames in which the pinned tracker
// reports a hand: once with the tracker called as production calls it
// ("baseline"), once through VisionEngine with its evaluation-only
// reacquireLostHands option.
// A translated photograph is not signing, a signer or a camera: this measures
// tracker continuity under motion, never recognition accuracy.
import { FilesetResolver, GestureRecognizer } from "@mediapipe/tasks-vision";
import { VisionEngine } from "../../lib/vision-engine";

type Case = { image: string; height: number; path: "sweep" | "nod" | "exit" | "empty"; speed: number; interval: number; frames?: number };
const canvas = document.querySelector("canvas")!, context = canvas.getContext("2d", { willReadFrequently: true })!;
const load = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error(`missing ${src}`)); image.src = src;
});

function position(path: Case["path"], t: number, speed: number): [number, number, number] {
  if (path === "sweep") { const span = 300, d = (speed * t / 1000) % (2 * span); return [170 + (d < span ? d : 2 * span - d), 240, 0]; }
  if (path === "nod") { const amplitude = 45; return [320, 240 + amplitude * Math.sin(speed / amplitude * t / 1000), Math.PI / 2]; }
  // "exit": sweep for one second, then leave the frame for good.
  return [t < 2000 ? 170 + (speed * (t - 1000) / 1000) % 300 : 5000, 240, 0];
}

function draw(image: HTMLImageElement | null, test: Case, t: number) {
  context.globalAlpha = 1; context.fillStyle = "#777"; context.fillRect(0, 0, canvas.width, canvas.height);
  if (!image || test.path === "empty") return;
  const [x, y, angle] = position(test.path, t, test.speed);
  const width = image.width * test.height / image.height;
  // Half a 33 ms exposure of motion blur, approximated by averaged copies.
  const blur = test.speed * 0.5 * 33 / 1000, copies = blur > 2 ? 8 : 1;
  for (let k = 0; k < copies; k++) {
    context.globalAlpha = 1 / (k + 1);
    const offset = copies > 1 ? (k / (copies - 1) - 0.5) * blur : 0;
    context.drawImage(image, x + offset * Math.cos(angle) - width / 2, y + offset * Math.sin(angle) - test.height / 2, width, test.height);
  }
  context.globalAlpha = 1;
}

function summarize(pattern: string) {
  return { seen: [...pattern].filter(c => c === "#").length, longest: Math.max(0, ...pattern.split(".").map(run => run.length)), pattern };
}

async function run(test: Case) {
  const image = test.path === "empty" ? null : await load(test.image), frames = test.frames ?? 60;
  // Baseline: the options VisionEngine passes, one call per frame.
  const files = await FilesetResolver.forVisionTasks("/vision/wasm");
  const recognizer = await GestureRecognizer.createFromOptions(files, {
    baseOptions: { modelAssetPath: "/vision/models/gesture_recognizer.task", delegate: "CPU" }, runningMode: "VIDEO", numHands: 2,
    minHandDetectionConfidence: 0.55, minHandPresenceConfidence: 0.55, minTrackingConfidence: 0.55,
    cannedGesturesClassifierOptions: { scoreThreshold: 0.55 } });
  let baseline = "", baselineMs = 0;
  for (let i = 0; i < frames; i++) {
    const t = 1000 + i * test.interval; draw(image, test, t);
    const started = performance.now();
    baseline += recognizer.recognizeForVideo(canvas, t).landmarks.length ? "#" : ".";
    baselineMs += performance.now() - started;
  }
  recognizer.close();
  const engine = await VisionEngine.create(undefined, { reacquireLostHands: true });
  let candidate = "", candidateMs = 0;
  for (let i = 0; i < frames; i++) {
    const t = 1000 + i * test.interval; draw(image, test, t);
    const started = performance.now();
    candidate += engine.process(canvas, t).hands.length ? "#" : ".";
    candidateMs += performance.now() - started;
  }
  const reacquisition = { ...engine.reacquisition };
  engine.close();
  return { ...test, frames, baseline: summarize(baseline), candidate: summarize(candidate), reacquisition,
    // The engine also runs face and pose on some frames, so its time is not comparable with the hand-only baseline.
    baseline_hand_ms_per_frame: +(baselineMs / frames).toFixed(1), engine_ms_per_frame: +(candidateMs / frames).toFixed(1) };
}

Object.assign(window, { probe: run });
