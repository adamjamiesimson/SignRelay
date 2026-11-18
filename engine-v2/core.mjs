// Media timestamps in ms. Coordinates are normalized against the unmirrored image.
export const CONTRACT = "signrelay-v2-temporal-1";
export const LABELS = ["HELLO", "THANK YOU", "PLEASE", "YES", "NO", "OTHER"];
export const STEPS = 16;
export const LANDMARK_WIDTH = 87;
export const RGB_WIDTH = 12 * 12 * 3;
export const WIDTHS = { landmark: LANDMARK_WIDTH, rgb: RGB_WIDTH, hybrid: LANDMARK_WIDTH + RGB_WIDTH };

const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));
const inside = point => !!point && Number.isFinite(point.x) && Number.isFinite(point.y)
  && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
const visiblePose = point => inside(point) && (point.visibility ?? 1) >= 0.5;

export function observation(frame, aspect) {
  if (!Number.isFinite(aspect) || aspect <= 0) throw new Error("Invalid source dimensions");
  const hands = frame.hands.filter(hand =>
    hand.landmarks.length === 21 && inside(hand.landmarks[0])
    && hand.landmarks.every(point => [point.x, point.y, point.z].every(Number.isFinite)));
  const pose = frame.pose;
  const shoulders = visiblePose(pose[11]) && visiblePose(pose[12]);
  const chest = shoulders
    ? { x: (pose[11].x + pose[12].x) / 2, y: (pose[11].y + pose[12].y) / 2 }
    : null;
  const bodyScale = shoulders ? Math.max(0.045, Math.hypot((pose[11].x - pose[12].x) * aspect, pose[11].y - pose[12].y)) : 1;
  const nose = visiblePose(pose[0]) ? pose[0] : null;
  // Keep both hands. Sort by image x only to break ties in a duplicate label.
  const left = hands.filter(hand => hand.handedness === "Left").sort((a, b) => a.landmarks[0].x - b.landmarks[0].x)[0];
  const right = hands.filter(hand => hand.handedness === "Right").sort((a, b) => b.landmarks[0].x - a.landmarks[0].x)[0];
  const first = hands.find(hand => hand !== left && hand !== right);
  const slots = [left ?? first, right ?? (left ? first : hands.find(hand => hand !== first))];
  const geometry = hand => {
    if (!hand) return Array(42).fill(0);
    const points = hand.landmarks;
    const wrist = points[0];
    const distance = p => Math.hypot((p.x - wrist.x) * aspect, p.y - wrist.y, (p.z - wrist.z) * aspect);
    const scale = Math.max(0.017, (distance(points[5]) + distance(points[9]) + distance(points[17])) / 3);
    const location = origin => origin ?
      [(wrist.x - origin.x) * aspect / bodyScale, (wrist.y - origin.y) / bodyScale] : [0, 0];
    const tipDistance = index => Math.hypot((points[index].x - points[4].x) * aspect, points[index].y - points[4].y) / scale;
    return [1, ...location(chest), ...location(nose), wrist.x * aspect, wrist.y, tipDistance(8), tipDistance(12),
      ...[4, 5, 6, 8, 9, 10, 12, 13, 16, 17, 20].flatMap(index => {
        const p = points[index];
        return [(p.x - wrist.x) * aspect / scale, (p.y - wrist.y) / scale, (p.z - wrist.z) * aspect / scale];
      })].map(value => clamp(value, 5));
  };
  return { t: frame.timestamp, h: hands.length > 0, x: [
    Number(shoulders), Number(!!nose), Math.log(aspect), ...slots.flatMap(geometry),
  ], rgb: frame.rgb ?? null };
}

export function tensor(samples, mode) {
  if (!(mode in WIDTHS)) throw new Error("Unknown input modality");
  if (samples.some((sample, i) => !Number.isFinite(sample.t) || (i && sample.t <= samples[i - 1].t))) {
    throw new Error("Non-monotonic source timestamps");
  }
  const hands = samples.filter(sample => sample.h);
  if (hands.length < 3 || hands.at(-1).t - hands[0].t < 115) return null;
  const start = hands[0].t;
  const end = hands.at(-1).t;
  const width = WIDTHS[mode];
  const output = new Float32Array(width * STEPS);
  let cursor = 0;
  for (let i = 0; i < STEPS; i++) {
    const desired = start + (end - start) * i / (STEPS - 1);
    while (cursor + 1 < samples.length &&
      Math.abs(samples[cursor + 1].t - desired) < Math.abs(samples[cursor].t - desired)) cursor++;
    const sample = samples[cursor];
    if (Math.abs(sample.t - desired) > 100) continue;
    if (mode !== "rgb") {
      if (sample.x.length !== LANDMARK_WIDTH || !sample.x.every(Number.isFinite)) throw new Error("Invalid landmark features");
      output.set(sample.x, i * width);
    }
    if (mode !== "landmark" && sample.rgb) {
      if (sample.rgb.length !== RGB_WIDTH || !sample.rgb.every(Number.isFinite)) throw new Error("Invalid RGB features");
      output.set(sample.rgb, i * width + (mode === "rgb" ? 0 : LANDMARK_WIDTH));
    }
  }
  return output;
}

export function parseModel(model) {
  const width = WIDTHS[model?.mode];
  const parameters = [
    [model?.mean, width], [model?.scale, width], [model?.conv, width * 3 * model?.channels],
    [model?.bias, model?.channels], [model?.head, 4 * model?.channels * LABELS.length], [model?.offset, LABELS.length],
  ];
  if (model?.contract !== CONTRACT || model.steps !== STEPS || !width || typeof model.version !== "string"
    || !Array.isArray(model.labels) || model.labels.join("|") !== LABELS.join("|")
    || !Number.isInteger(model.channels) || model.channels < 1 || model.channels > 64
    || parameters.some(([values, size]) => !Array.isArray(values) || values.length !== size || !values.every(Number.isFinite))
    || model.scale.some(value => value <= 0) || !Number.isFinite(model.minScore) || !Number.isFinite(model.minMargin)) {
    throw new Error("Incompatible recognition model");
  }
  return model;
}

export function logits(model, input) {
  const width = WIDTHS[model.mode];
  const { channels } = model;
  if (input.length !== width * STEPS) throw new Error("Incompatible recognition tensor");
  const normalized = input.map((value, i) => clamp((value - model.mean[i % width]) / model.scale[i % width], 5));
  const pooled = new Float64Array(4 * channels);
  for (let step = 0; step < STEPS; step++) {
    for (let channel = 0; channel < channels; channel++) {
      let activation = model.bias[channel];
      for (let offset = -1; offset <= 1; offset++) {
        const neighbor = Math.max(0, Math.min(STEPS - 1, step + offset));
        for (let i = 0; i < width; i++) {
          activation += normalized[neighbor * width + i] * model.conv[((offset + 1) * width + i) * channels + channel];
        }
      }
      pooled[Math.floor(step / 4) * channels + channel] += Math.tanh(activation) / 4;
    }
  }
  return model.offset.map((offset, label) => pooled.reduce(
    (sum, value, i) => sum + value * model.head[i * LABELS.length + label], offset));
}

export function predict(model, input) {
  if (!input) return { label: null, reason: "insufficient hand evidence" };
  const scores = logits(model, input);
  const [best, runnerUp] = scores.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
  const score = scores[best];
  const margin = score - scores[runnerUp];
  const accepted = best !== LABELS.length - 1 && score >= model.minScore && margin >= model.minMargin;
  return { label: accepted ? LABELS[best] : null, top: LABELS[best], score, margin, scores,
    reason: accepted ? "accepted" : best === LABELS.length - 1 ? "unsupported movement" : "uncertain match" };
}

// Fixed-delay, overlapping windows. An event requires agreement across windows.
// Suppression clears when the evidence changes, without requiring a hand exit.
export class Stream {
  constructor(model, { windows = null, hop = 150, confirmations = 2 } = {}) {
    this.model = model;
    this.windows = windows;
    this.hop = hop;
    this.confirmations = confirmations;
    this.reset();
  }
  reset() {
    this.samples = [];
    this.last = -Infinity;
    this.evaluated = -Infinity;
    this.run = 0;
    this.previous = null;
    this.lastEmitted = null;
    this.cadence = 50;
  }
  push(sample) {
    if (!Number.isFinite(sample.t) || sample.t <= this.last) throw new Error("Non-monotonic source timestamps");
    const gap = sample.t - this.last;
    if (gap > 400) this.reset();
    else this.cadence = this.cadence * 0.7 + gap * 0.3;
    this.last = sample.t;
    this.samples.push(sample);
    const windows = this.windows ?? (this.cadence >= 125 ? [600, 1000, 1600] : [1000]);
    const longest = this.windows ? Math.max(...this.windows) : 1600;
    this.samples = this.samples.filter(frame => sample.t - frame.t <= longest);
    if (sample.t - this.evaluated < this.hop) return null;
    this.evaluated = sample.t;
    // A window may miss its left edge by one frame interval after eviction.
    // Fixed fractional coverage can skip every decision at a steady low FPS.
    const scored = windows.filter(ms => sample.t - this.samples[0].t >= ms - Math.max(ms * 0.14, Math.min(220, gap + 10))).map(ms =>
      predict(this.model, tensor(this.samples.filter(frame => sample.t - frame.t <= ms), this.model.mode)));
    const result = scored.filter(value => value.label).sort((a, b) => b.margin - a.margin)[0]
      ?? { label: null, reason: scored.find(value => value.reason !== "insufficient hand evidence")?.reason
        ?? "insufficient hand evidence" };
    this.run = this.previous === result.label ? this.run + 1 : 1;
    this.previous = result.label;
    if (this.run >= this.confirmations && result.label === null) this.lastEmitted = null;
    const event = result.label && this.run >= this.confirmations && result.label !== this.lastEmitted ? result.label : null;
    if (event) this.lastEmitted = event;
    return { ...result, event, t: sample.t };
  }
}
