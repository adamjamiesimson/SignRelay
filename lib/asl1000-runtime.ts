import type { Point, VisionFrame } from "./vision-types";

type PackedArray = {
  offset: number;
  length: number;
  shape: number[];
  dtype: "i8" | "f16" | "f32";
};

type PackedGraphLayer = {
  inputFeatures: number;
  outputFeatures: number;
  residual: boolean;
  weight: PackedArray;
  weightScales: PackedArray;
  attention: PackedArray;
  attentionScales: PackedArray;
  normalScale: PackedArray;
  normalShift: PackedArray;
};

type PackedClassifier = {
  inputFeatures: number;
  outputFeatures: number;
  weight: PackedArray;
  weightScales: PackedArray;
  bias: PackedArray;
};

export type TgcnManifest = {
  format: "signrelay-tgcn-v1";
  classes: number;
  nodes: number;
  sequenceLength: number;
  inputFeatures: number;
  hiddenFeatures: number;
  stages: number;
  layers: PackedGraphLayer[];
  classifier: PackedClassifier;
  binaryBytes: number;
  compressedBytes: number;
  binaryParts: string[];
};

type MaterialisedLayer = {
  inputFeatures: number;
  outputFeatures: number;
  residual: boolean;
  weight: Int8Array;
  weightScales: Float32Array;
  attention: Int8Array;
  attentionScales: Float32Array;
  normalScale: Float32Array;
  normalShift: Float32Array;
};

type MaterialisedModel = {
  manifest: TgcnManifest;
  layers: MaterialisedLayer[];
  classifier: {
    inputFeatures: number;
    outputFeatures: number;
    weight: Int8Array;
    weightScales: Float32Array;
    bias: Float32Array;
  };
  labels: string[];
};

export type Asl1000Prediction = {
  label: string;
  text: string;
  confidence: number;
  margin: number;
};

// Pose-TGCN is still a closed-set isolated-sign classifier. These gates are
// applied after the movement-completion gate in the recognition worker so an
// arbitrary mathematical winner is not automatically treated as language.
const MODEL_MIN_CONFIDENCE = 0.62;
const MODEL_MIN_MARGIN = 0.22;

let modelPromise: Promise<MaterialisedModel> | null = null;

function loadModel() {
  modelPromise ??= Promise.all([
    fetch("/models/asl1000-tgcn/model.json"),
    fetch("/models/asl1000-tgcn/labels.json"),
  ]).then(async ([manifestResponse, labelsResponse]) => {
    if (!manifestResponse.ok || !labelsResponse.ok) {
      throw new Error("ASL-1000 model assets could not load");
    }
    if (!("DecompressionStream" in self)) {
      throw new Error("This browser cannot unpack the ASL-1000 model");
    }
    const manifest = await manifestResponse.json() as TgcnManifest;
    const labels = await labelsResponse.json() as string[];
    if (!Array.isArray(manifest.binaryParts) || manifest.binaryParts.length === 0) {
      throw new Error("ASL-1000 model shard manifest is invalid");
    }
    const partResponses = await Promise.all(manifest.binaryParts.map((name) =>
      fetch(`/models/asl1000-tgcn/${name}`)
    ));
    if (partResponses.some((response) => !response.ok)) {
      throw new Error("ASL-1000 model assets could not load");
    }
    const partBuffers = await Promise.all(partResponses.map((response) => response.arrayBuffer()));
    const compressed = new Uint8Array(manifest.compressedBytes);
    let compressedOffset = 0;
    for (const part of partBuffers) {
      if (compressedOffset + part.byteLength > compressed.byteLength) {
        throw new Error("ASL-1000 compressed model integrity check failed");
      }
      compressed.set(new Uint8Array(part), compressedOffset);
      compressedOffset += part.byteLength;
    }
    if (compressedOffset !== manifest.compressedBytes) {
      throw new Error("ASL-1000 compressed model integrity check failed");
    }
    const stream = new Blob([compressed.buffer])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    const binary = await new Response(stream).arrayBuffer();
    if (manifest.format !== "signrelay-tgcn-v1" || binary.byteLength !== manifest.binaryBytes) {
      throw new Error("ASL-1000 model integrity check failed");
    }
    if (labels.length !== manifest.classes) {
      throw new Error("ASL-1000 vocabulary does not match the model");
    }
    return materialiseTgcnModel(manifest, binary, labels);
  });
  return modelPromise;
}

export async function recognizeAsl1000(sequence: VisionFrame[]): Promise<Asl1000Prediction | null> {
  const model = await loadModel();
  if (sequence.length < 24) return null;
  const input = prepareTgcnInput(sequence.slice(-40), model.manifest.sequenceLength);
  const logits = runMaterialisedTgcn(model, input);
  const probabilities = softmax(logits);
  const [best, runnerUp] = topTwo(probabilities);
  const confidence = probabilities[best];
  const margin = confidence - probabilities[runnerUp];
  const label = model.labels[best];
  if (!label || confidence < MODEL_MIN_CONFIDENCE || margin < MODEL_MIN_MARGIN) return null;
  return { label, text: title(label), confidence, margin };
}

export function prepareTgcnInput(sequence: VisionFrame[], sequenceLength = 50) {
  const inputFeatures = sequenceLength * 2;
  const result = new Float32Array(55 * inputFeatures);
  if (!sequence.length) {
    result.fill(-1);
    return result;
  }
  for (let targetFrame = 0; targetFrame < sequenceLength; targetFrame += 1) {
    const sourceIndex = sequenceLength === 1
      ? sequence.length - 1
      : Math.round(targetFrame * (sequence.length - 1) / (sequenceLength - 1));
    const points = openPosePoints(sequence[sourceIndex]);
    for (let node = 0; node < points.length; node += 1) {
      const point = points[node];
      const offset = node * inputFeatures + targetFrame * 2;
      if (!point || point.visibility === 0) {
        result[offset] = -1;
        result[offset + 1] = -1;
      } else {
        result[offset] = 2 * (point.x - 0.5);
        result[offset + 1] = 2 * (point.y - 0.5);
      }
    }
  }
  return result;
}

export function runPackedTgcn(manifest: TgcnManifest, binary: ArrayBuffer, labels: string[], input: Float32Array) {
  return runMaterialisedTgcn(materialiseTgcnModel(manifest, binary, labels), input);
}

function materialiseTgcnModel(manifest: TgcnManifest, binary: ArrayBuffer, labels: string[]): MaterialisedModel {
  const layers = manifest.layers.map((layer) => ({
    inputFeatures: layer.inputFeatures,
    outputFeatures: layer.outputFeatures,
    residual: layer.residual,
    weight: int8View(binary, layer.weight),
    weightScales: float32View(binary, layer.weightScales),
    attention: int8View(binary, layer.attention),
    attentionScales: float32View(binary, layer.attentionScales),
    normalScale: float16View(binary, layer.normalScale),
    normalShift: float16View(binary, layer.normalShift),
  }));
  return {
    manifest,
    layers,
    classifier: {
      inputFeatures: manifest.classifier.inputFeatures,
      outputFeatures: manifest.classifier.outputFeatures,
      weight: int8View(binary, manifest.classifier.weight),
      weightScales: float32View(binary, manifest.classifier.weightScales),
      bias: float16View(binary, manifest.classifier.bias),
    },
    labels,
  };
}

function runMaterialisedTgcn(model: MaterialisedModel, input: Float32Array) {
  let activations = input;
  let pendingResidual: Float32Array | null = null;
  for (let index = 0; index < model.layers.length; index += 1) {
    const layer = model.layers[index];
    if (!layer.residual && model.layers[index + 1]?.residual) pendingResidual = activations;
    const output = applyGraphLayer(activations, layer, model.manifest.nodes);
    if (layer.residual && pendingResidual) {
      for (let value = 0; value < output.length; value += 1) output[value] += pendingResidual[value];
      pendingResidual = null;
    }
    activations = output;
  }

  const pooled = new Float32Array(model.manifest.hiddenFeatures);
  for (let node = 0; node < model.manifest.nodes; node += 1) {
    const offset = node * model.manifest.hiddenFeatures;
    for (let feature = 0; feature < pooled.length; feature += 1) pooled[feature] += activations[offset + feature];
  }
  for (let feature = 0; feature < pooled.length; feature += 1) pooled[feature] /= model.manifest.nodes;

  const { classifier } = model;
  const logits = new Float32Array(classifier.outputFeatures);
  for (let output = 0; output < classifier.outputFeatures; output += 1) {
    let sum = 0;
    const weightOffset = output * classifier.inputFeatures;
    for (let feature = 0; feature < classifier.inputFeatures; feature += 1) {
      sum += pooled[feature] * classifier.weight[weightOffset + feature];
    }
    logits[output] = sum * classifier.weightScales[output] + classifier.bias[output];
  }
  return logits;
}

function applyGraphLayer(input: Float32Array, layer: MaterialisedLayer, nodes: number) {
  const support = new Float32Array(nodes * layer.outputFeatures);
  for (let node = 0; node < nodes; node += 1) {
    const inputOffset = node * layer.inputFeatures;
    const outputOffset = node * layer.outputFeatures;
    for (let source = 0; source < layer.inputFeatures; source += 1) {
      const value = input[inputOffset + source];
      const weightOffset = source * layer.outputFeatures;
      for (let output = 0; output < layer.outputFeatures; output += 1) {
        support[outputOffset + output] += value * layer.weight[weightOffset + output];
      }
    }
    for (let output = 0; output < layer.outputFeatures; output += 1) {
      support[outputOffset + output] *= layer.weightScales[output];
    }
  }

  const result = new Float32Array(nodes * layer.outputFeatures);
  for (let node = 0; node < nodes; node += 1) {
    const outputOffset = node * layer.outputFeatures;
    for (let sourceNode = 0; sourceNode < nodes; sourceNode += 1) {
      const attention = layer.attention[node * nodes + sourceNode];
      if (attention === 0) continue;
      const supportOffset = sourceNode * layer.outputFeatures;
      for (let output = 0; output < layer.outputFeatures; output += 1) {
        result[outputOffset + output] += attention * support[supportOffset + output];
      }
    }
    const attentionScale = layer.attentionScales[node];
    for (let output = 0; output < layer.outputFeatures; output += 1) {
      const offset = outputOffset + output;
      result[offset] = Math.tanh(result[offset] * attentionScale * layer.normalScale[offset] + layer.normalShift[offset]);
    }
  }
  return result;
}

function openPosePoints(frame: VisionFrame): Array<Point | null> {
  const pose = frame.pose;
  const point = (index: number) => visible(pose[index]) ? pose[index] : null;
  const body = [
    point(0), midpoint(point(11), point(12)),
    point(12), point(14), point(16),
    point(11), point(13), point(15),
    midpoint(point(23), point(24)),
    point(5), point(2), point(8), point(7),
  ];
  return [...body, ...handPoints(frame, "Left"), ...handPoints(frame, "Right")];
}

function handPoints(frame: VisionFrame, side: "Left" | "Right") {
  const hand = frame.hands.find((candidate) => candidate.handedness === side)?.landmarks;
  return Array.from({ length: 21 }, (_, index) => hand?.[index] ?? null);
}

function visible(point: Point | undefined): point is Point {
  return Boolean(point && (point.visibility === undefined || point.visibility >= 0.3));
}

function midpoint(a: Point | null, b: Point | null): Point | null {
  if (!a || !b) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

function int8View(binary: ArrayBuffer, descriptor: PackedArray) {
  return new Int8Array(binary, descriptor.offset, descriptor.length);
}

function float32View(binary: ArrayBuffer, descriptor: PackedArray) {
  return new Float32Array(binary, descriptor.offset, descriptor.length);
}

function float16View(binary: ArrayBuffer, descriptor: PackedArray) {
  const encoded = new Uint16Array(binary, descriptor.offset, descriptor.length);
  return Float32Array.from(encoded, halfToFloat);
}

export function halfToFloat(value: number) {
  const sign = (value & 0x8000) ? -1 : 1;
  const exponent = (value >> 10) & 0x1f;
  const fraction = value & 0x03ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 31) return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

function softmax(logits: Float32Array) {
  const maximum = Math.max(...logits);
  const probabilities = new Float32Array(logits.length);
  let total = 0;
  for (let index = 0; index < logits.length; index += 1) {
    const value = Math.exp(logits[index] - maximum);
    probabilities[index] = value;
    total += value;
  }
  for (let index = 0; index < probabilities.length; index += 1) probabilities[index] /= total;
  return probabilities;
}

function topTwo(values: Float32Array): [number, number] {
  let best = values[0] >= values[1] ? 0 : 1;
  let runnerUp = best === 0 ? 1 : 0;
  for (let index = 2; index < values.length; index += 1) {
    if (values[index] > values[best]) {
      runnerUp = best;
      best = index;
    } else if (values[index] > values[runnerUp]) {
      runnerUp = index;
    }
  }
  return [best, runnerUp];
}

function title(value: string) {
  return value.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}
