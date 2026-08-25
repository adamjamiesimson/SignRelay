import type { Point, VisionFrame } from "./vision-types";

type QuantisedLayer = {
  input: number;
  output: number;
  weights: { scale: number; data: number[] };
  bias: number[];
  activation: "relu" | "softmax";
};

type Asl100Model = {
  sequenceLength: number;
  mean: number[];
  std: number[];
  layers: QuantisedLayer[];
};

export type Asl100Prediction = { label: string; text: string; confidence: number };

let modelPromise: Promise<Asl100Model> | null = null;
let labelsPromise: Promise<string[]> | null = null;

function loadModel() {
  modelPromise ??= fetch("/models/asl100/model.json.gz").then(async (response) => {
    if (!response.ok) throw new Error("ASL-100 model could not load");
    if (!("DecompressionStream" in self)) throw new Error("This browser cannot unpack the ASL-100 model");
    const stream = new Blob([await response.arrayBuffer()]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).json() as Promise<Asl100Model>;
  });
  return modelPromise;
}

function loadLabels() {
  labelsPromise ??= fetch("/models/asl100/labels.json").then((response) => {
    if (!response.ok) throw new Error("ASL-100 labels could not load");
    return response.json() as Promise<string[]>;
  });
  return labelsPromise;
}

export async function recognizeAsl100(sequence: VisionFrame[]): Promise<Asl100Prediction | null> {
  const [model, labels] = await Promise.all([loadModel(), loadLabels()]);
  if (sequence.length < model.sequenceLength || !hasAsl100HandEvidence(sequence)) return null;
  const values = prepare(sequence.slice(-32), model);
  let activations = values;
  for (const layer of model.layers) activations = applyLayer(activations, layer);
  const best = activations.reduce((winner, value, index) => value > activations[winner] ? index : winner, 0);
  const label = labels[best];
  if (!label) return null;
  return { label, text: title(label), confidence: activations[best] };
}

/** Never classify a face, an empty camera, or tracking noise as a sign. */
export function hasAsl100HandEvidence(sequence: VisionFrame[]) {
  const recent = sequence.slice(-24);
  return recent.filter((frame) => frame.hands.some((hand) => hand.landmarks.length >= 21)).length >= 14;
}

function prepare(sequence: VisionFrame[], model: Asl100Model) {
  const indices = Array.from({ length: model.sequenceLength }, (_, index) => Math.round(index * (sequence.length - 1) / (model.sequenceLength - 1)));
  const raw = indices.flatMap((index) => frameFeatures(sequence[index]));
  return raw.map((value, index) => (value - model.mean[index]) / Math.max(model.std[index], 0.0001));
}

function frameFeatures(frame: VisionFrame) {
  const pose = frame.pose;
  const pickPose = (index: number): Point => pose[index] ?? zero();
  const body = [
    pickPose(0), midpoint(pickPose(11), pickPose(12)), pickPose(5), pickPose(2), pickPose(8), pickPose(7),
    pickPose(12), pickPose(11), pickPose(14), pickPose(13), pickPose(16), pickPose(15),
  ];
  const left = handPoints(frame, "Left");
  const right = handPoints(frame, "Right");
  normalizeFrame(body, left, right);
  return [...body, ...left, ...right].flatMap((point) => [point.x, point.y]);
}

function handPoints(frame: VisionFrame, side: "Left" | "Right") {
  const hand = frame.hands.find((candidate) => candidate.handedness === side)?.landmarks;
  const order = [0, 8, 7, 6, 5, 12, 11, 10, 9, 16, 15, 14, 13, 20, 19, 18, 17, 4, 3, 2, 1];
  return order.map((index) => hand?.[index] ? { ...hand[index] } : zero());
}

function normalizeFrame(body: Point[], left: Point[], right: Point[]) {
  const leftShoulder = body[7]; const rightShoulder = body[6]; const neck = body[1]; const eye = body[3];
  const metric = nonzero(leftShoulder) && nonzero(rightShoulder) ? distance(leftShoulder, rightShoulder) : distance(neck, body[0]);
  if (metric > 0.00001 && nonzero(neck)) {
    const start = { x: neck.x - 3 * metric, y: eye.y + metric };
    const end = { x: neck.x + 3 * metric, y: start.y - 6 * metric };
    body.forEach((point) => { if (nonzero(point)) { point.x = (point.x - start.x) / (end.x - start.x); point.y = (point.y - end.y) / (start.y - end.y); } });
  }
  for (const hand of [left, right]) normalizeHand(hand);
  for (const point of [...body, ...left, ...right]) { point.x -= 0.5; point.y -= 0.5; }
}

function normalizeHand(hand: Point[]) {
  const visible = hand.filter(nonzero); if (!visible.length) return;
  const minX = Math.min(...visible.map((point) => point.x)); const maxX = Math.max(...visible.map((point) => point.x));
  const minY = Math.min(...visible.map((point) => point.y)); const maxY = Math.max(...visible.map((point) => point.y));
  const width = maxX - minX; const height = maxY - minY;
  const dx = width > height ? width * 0.1 : height * 0.1 + (height - width) / 2;
  const dy = height > width ? height * 0.1 : width * 0.1 + (width - height) / 2;
  const startX = minX - dx; const startY = minY - dy; const spanX = maxX + dx - startX; const spanY = maxY + dy - startY;
  if (spanX < 0.00001 || spanY < 0.00001) return;
  hand.forEach((point) => { if (nonzero(point)) { point.x = (point.x - startX) / spanX; point.y = (point.y - startY) / spanY; } });
}

function applyLayer(input: number[], layer: QuantisedLayer) {
  const result = new Array(layer.output);
  for (let output = 0; output < layer.output; output += 1) {
    let sum = layer.bias[output]; const offset = output * layer.input;
    for (let index = 0; index < layer.input; index += 1) sum += input[index] * layer.weights.data[offset + index] * layer.weights.scale;
    result[output] = layer.activation === "relu" ? Math.max(0, sum) : sum;
  }
  if (layer.activation !== "softmax") return result;
  const max = Math.max(...result); const exponentials = result.map((value) => Math.exp(value - max)); const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map((value) => value / total);
}

function zero(): Point { return { x: 0, y: 0, z: 0 }; }
function midpoint(a: Point, b: Point): Point { return nonzero(a) && nonzero(b) ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: 0 } : zero(); }
function nonzero(point: Point) { return point.x !== 0 || point.y !== 0; }
function distance(a: Point, b: Point) { return Math.hypot(a.x - b.x, a.y - b.y); }
function title(value: string) { return value.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()); }
