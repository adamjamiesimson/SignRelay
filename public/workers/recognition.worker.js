// lib/decoder.ts
function shouldConfirm({
  confidence,
  threshold,
  streak,
  sameLabel,
  elapsedSinceLast,
  cooldown
}) {
  if (confidence < threshold || streak < 2) return false;
  return !sameLabel || elapsedSinceLast > cooldown;
}

// lib/personalized-recognition.ts
var CALIBRATION_SEQUENCE_LENGTH = 24;
function templatesForLanguage(templates, language) {
  return templates.filter((template) => (template.language ?? "asl") === language);
}
var ZERO_HAND = new Array(66).fill(0);
var ZERO_FACE = new Array(41).fill(0);
var ZERO_POSE = new Array(35).fill(0);
function prepareCalibrationSequence(frames2) {
  if (!frames2.length) return [];
  const features = frames2.map(frameToFeatures);
  return resample(features, CALIBRATION_SEQUENCE_LENGTH);
}
function recognizePersonalTemplate(frames2, templates) {
  if (!templates.length || frames2.length < 18) return null;
  const recent = frames2.slice(-CALIBRATION_SEQUENCE_LENGTH);
  if (recent.filter((frame) => frame.hands.length > 0).length < 15) return null;
  const candidate = prepareCalibrationSequence(recent);
  let best = null;
  for (const template of templates) {
    if (template.frames.length !== CALIBRATION_SEQUENCE_LENGTH) continue;
    const distance4 = sequenceDistance(candidate, template.frames);
    if (!best || distance4 < best.distance) best = { template, distance: distance4 };
  }
  if (!best || best.distance > 0.62) return null;
  const confidence = clamp(0.965 - best.distance * 0.24, 0, 0.96);
  return {
    label: best.template.gloss,
    text: best.template.text,
    confidence
  };
}
function sequenceDistance(a, b) {
  if (!a.length || !b.length) return Number.POSITIVE_INFINITY;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => new Float64Array(cols).fill(Number.POSITIVE_INFINITY));
  matrix[0][0] = 0;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = featureDistance(a[i - 1], b[j - 1]);
      matrix[i][j] = cost + Math.min(matrix[i - 1][j], matrix[i][j - 1], matrix[i - 1][j - 1]);
    }
  }
  return matrix[a.length][b.length] / Math.max(a.length, b.length);
}
function frameToFeatures(frame) {
  const shoulders = frame.pose.length > 12 ? [frame.pose[11], frame.pose[12]] : [];
  const wrists = frame.hands.map((hand) => hand.landmarks[0]).filter(Boolean);
  const anchor = shoulders.length === 2 ? midpoint(shoulders[0], shoulders[1]) : averagePoint(wrists);
  const bodyScale = shoulders.length === 2 ? Math.max(distance(shoulders[0], shoulders[1]), 0.08) : Math.max(pointRange(wrists), 0.18);
  const left = frame.hands.find((hand) => hand.handedness === "Left") ?? frame.hands[1];
  const right = frame.hands.find((hand) => hand.handedness === "Right") ?? frame.hands[0];
  return [
    ...handFeatures(left, anchor, bodyScale),
    ...handFeatures(right === left ? void 0 : right, anchor, bodyScale),
    ...landmarkFeatures(frame.face, anchor, bodyScale, ZERO_FACE),
    ...landmarkFeatures(frame.pose, anchor, bodyScale, ZERO_POSE)
  ];
}
function handFeatures(hand, anchor, bodyScale) {
  if (!hand?.landmarks.length) return ZERO_HAND;
  const wrist = hand.landmarks[0];
  const palm = hand.landmarks[9] ?? hand.landmarks[5] ?? wrist;
  const handScale = Math.max(distance(wrist, palm), 0.025);
  const local = hand.landmarks.slice(0, 21).flatMap((point) => [
    clamp((point.x - wrist.x) / handScale, -5, 5),
    clamp((point.y - wrist.y) / handScale, -5, 5),
    clamp((point.z - wrist.z) / handScale, -5, 5)
  ]);
  while (local.length < 63) local.push(0);
  return [
    1,
    clamp((wrist.x - anchor.x) / bodyScale, -4, 4),
    clamp((wrist.y - anchor.y) / bodyScale, -4, 4),
    ...local
  ];
}
function landmarkFeatures(points, anchor, scale, empty) {
  if (!points.length) return empty;
  const values = points.flatMap((point) => [
    clamp((point.x - anchor.x) / scale, -4, 4),
    clamp((point.y - anchor.y) / scale, -4, 4)
  ]);
  return [1, ...values];
}
function featureDistance(a, b) {
  const length = Math.min(a.length, b.length);
  if (!length) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (let index = 0; index < length; index += 1) {
    const delta = a[index] - b[index];
    total += Math.min(delta * delta, 4);
  }
  return Math.sqrt(total / length);
}
function resample(sequence, targetLength) {
  if (sequence.length === targetLength) return sequence;
  if (sequence.length === 1) return Array.from({ length: targetLength }, () => [...sequence[0]]);
  return Array.from({ length: targetLength }, (_, index) => {
    const sourceIndex = Math.round(index * (sequence.length - 1) / (targetLength - 1));
    return [...sequence[sourceIndex]];
  });
}
function averagePoint(points) {
  if (!points.length) return { x: 0.5, y: 0.5, z: 0 };
  return points.reduce((total, point) => ({
    x: total.x + point.x / points.length,
    y: total.y + point.y / points.length,
    z: total.z + point.z / points.length
  }), { x: 0, y: 0, z: 0 });
}
function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}
function pointRange(points) {
  if (points.length < 2) return 0;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// lib/asl100-runtime.ts
function hasAsl100HandEvidence(sequence) {
  const recent = sequence.slice(-24);
  return recent.filter((frame) => frame.hands.some((hand) => hand.landmarks.length >= 21)).length >= 12;
}
function hasAsl100CompletedSignMotion(sequence) {
  const recent = sequence.slice(-24);
  if (recent.length < 24 || !hasAsl100HandEvidence(recent)) return false;
  const wrists = dominantTrackedWrists(recent);
  if (wrists.length < 15) return false;
  const tail = wrists.slice(-7);
  const tailRange = Math.hypot(range(tail.map((point) => point.x)), range(tail.map((point) => point.y)));
  const pathLength = wrists.slice(1).reduce((total, point, index) => total + distance2(point, wrists[index]), 0);
  return pathLength >= 0.075 && tailRange <= 0.06;
}
function dominantTrackedWrists(sequence) {
  const left = sequence.map((frame) => frame.hands.find((hand) => hand.handedness === "Left")?.landmarks[0]).filter((point) => Boolean(point));
  const right = sequence.map((frame) => frame.hands.find((hand) => hand.handedness === "Right")?.landmarks[0]).filter((point) => Boolean(point));
  return right.length >= left.length ? right : left;
}
function distance2(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function range(values) {
  return Math.max(...values) - Math.min(...values);
}

// lib/asl1000-runtime.ts
var MODEL_MIN_CONFIDENCE = 0.62;
var MODEL_MIN_MARGIN = 0.22;
var modelPromise = null;
function loadModel() {
  modelPromise ?? (modelPromise = Promise.all([
    fetch("/models/asl2000-tgcn/model.json"),
    fetch("/models/asl2000-tgcn/labels.json")
  ]).then(async ([manifestResponse, labelsResponse]) => {
    if (!manifestResponse.ok || !labelsResponse.ok) {
      throw new Error("ASL-2000 model assets could not load");
    }
    if (!("DecompressionStream" in self)) {
      throw new Error("This browser cannot unpack the ASL-2000 model");
    }
    const manifest = await manifestResponse.json();
    const labels = await labelsResponse.json();
    if (!Array.isArray(manifest.binaryParts) || manifest.binaryParts.length === 0) {
      throw new Error("ASL-2000 model shard manifest is invalid");
    }
    const partResponses = await Promise.all(manifest.binaryParts.map(
      (name) => fetch(`/models/asl2000-tgcn/${name}`)
    ));
    if (partResponses.some((response) => !response.ok)) {
      throw new Error("ASL-2000 model assets could not load");
    }
    const partBuffers = await Promise.all(partResponses.map((response) => response.arrayBuffer()));
    const compressed = new Uint8Array(manifest.compressedBytes);
    let compressedOffset = 0;
    for (const part of partBuffers) {
      if (compressedOffset + part.byteLength > compressed.byteLength) {
        throw new Error("ASL-2000 compressed model integrity check failed");
      }
      compressed.set(new Uint8Array(part), compressedOffset);
      compressedOffset += part.byteLength;
    }
    if (compressedOffset !== manifest.compressedBytes) {
      throw new Error("ASL-2000 compressed model integrity check failed");
    }
    const stream = new Blob([compressed.buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
    const binary = await new Response(stream).arrayBuffer();
    if (manifest.format !== "signrelay-tgcn-v1" || binary.byteLength !== manifest.binaryBytes) {
      throw new Error("ASL-2000 model integrity check failed");
    }
    if (labels.length !== manifest.classes) {
      throw new Error("ASL-2000 vocabulary does not match the model");
    }
    return materialiseTgcnModel(manifest, binary, labels);
  }));
  return modelPromise;
}
async function recognizeAsl1000(sequence) {
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
function prepareTgcnInput(sequence, sequenceLength = 50) {
  const inputFeatures = sequenceLength * 2;
  const result = new Float32Array(55 * inputFeatures);
  if (!sequence.length) {
    result.fill(-1);
    return result;
  }
  for (let targetFrame = 0; targetFrame < sequenceLength; targetFrame += 1) {
    const sourceIndex = sequenceLength === 1 ? sequence.length - 1 : Math.round(targetFrame * (sequence.length - 1) / (sequenceLength - 1));
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
function materialiseTgcnModel(manifest, binary, labels) {
  const layers = manifest.layers.map((layer) => ({
    inputFeatures: layer.inputFeatures,
    outputFeatures: layer.outputFeatures,
    residual: layer.residual,
    weight: int8View(binary, layer.weight),
    weightScales: float32View(binary, layer.weightScales),
    attention: int8View(binary, layer.attention),
    attentionScales: float32View(binary, layer.attentionScales),
    normalScale: float16View(binary, layer.normalScale),
    normalShift: float16View(binary, layer.normalShift)
  }));
  return {
    manifest,
    layers,
    classifier: {
      inputFeatures: manifest.classifier.inputFeatures,
      outputFeatures: manifest.classifier.outputFeatures,
      weight: int8View(binary, manifest.classifier.weight),
      weightScales: float32View(binary, manifest.classifier.weightScales),
      bias: float16View(binary, manifest.classifier.bias)
    },
    labels
  };
}
function runMaterialisedTgcn(model, input) {
  let activations = input;
  let pendingResidual = null;
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
function applyGraphLayer(input, layer, nodes) {
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
function openPosePoints(frame) {
  const pose = frame.pose;
  const point = (index) => visible(pose[index]) ? pose[index] : null;
  const body = [
    point(0),
    midpoint2(point(11), point(12)),
    point(12),
    point(14),
    point(16),
    point(11),
    point(13),
    point(15),
    midpoint2(point(23), point(24)),
    point(5),
    point(2),
    point(8),
    point(7)
  ];
  return [...body, ...handPoints(frame, "Left"), ...handPoints(frame, "Right")];
}
function handPoints(frame, side) {
  const hand = frame.hands.find((candidate) => candidate.handedness === side)?.landmarks;
  return Array.from({ length: 21 }, (_, index) => hand?.[index] ?? null);
}
function visible(point) {
  return Boolean(point && (point.visibility === void 0 || point.visibility >= 0.3));
}
function midpoint2(a, b) {
  if (!a || !b) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}
function int8View(binary, descriptor) {
  return new Int8Array(binary, descriptor.offset, descriptor.length);
}
function float32View(binary, descriptor) {
  return new Float32Array(binary, descriptor.offset, descriptor.length);
}
function float16View(binary, descriptor) {
  const encoded = new Uint16Array(binary, descriptor.offset, descriptor.length);
  return Float32Array.from(encoded, halfToFloat);
}
function halfToFloat(value) {
  const sign = value & 32768 ? -1 : 1;
  const exponent = value >> 10 & 31;
  const fraction = value & 1023;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 31) return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}
function softmax(logits) {
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
function topTwo(values) {
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
function title(value) {
  return value.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

// workers/recognition.worker.ts
var MAX_FRAMES = 40;
var CONFIDENCE_THRESHOLD = 0.62;
var COOLDOWN_MS = 2600;
var frames = [];
var candidateLabel = null;
var candidateStreak = 0;
var lastConfirmation = { label: "", time: 0 };
var personalTemplates = [];
var activeLanguage = "asl";
var latestAsl1000 = null;
var pendingAsl1000 = false;
var modelGeneration = 0;
self.onmessage = async (event) => {
  if (event.data.type === "templates") {
    activeLanguage = event.data.language;
    personalTemplates = templatesForLanguage(event.data.templates, activeLanguage);
    frames.length = 0;
    candidateLabel = null;
    candidateStreak = 0;
    latestAsl1000 = null;
    modelGeneration += 1;
    return;
  }
  if (event.data.type === "reset") {
    frames.length = 0;
    candidateLabel = null;
    candidateStreak = 0;
    latestAsl1000 = null;
    modelGeneration += 1;
    return;
  }
  frames.push(event.data.frame);
  while (frames.length > MAX_FRAMES) frames.shift();
  if (activeLanguage === "asl" && !hasAsl100CompletedSignMotion(frames)) {
    latestAsl1000 = null;
    candidateLabel = null;
    candidateStreak = 0;
    modelGeneration += 1;
  } else if (activeLanguage === "asl" && frames.length >= 24 && !pendingAsl1000 && frames.length % 6 === 0) {
    pendingAsl1000 = true;
    const generation = modelGeneration;
    recognizeAsl1000([...frames]).then((prediction) => {
      if (generation === modelGeneration) latestAsl1000 = prediction;
    }).catch(() => {
      latestAsl1000 = null;
    }).finally(() => {
      pendingAsl1000 = false;
    });
  }
  const result = recognize(frames);
  const analysis = {
    type: "analysis",
    state: frames.length < 10 ? "listening" : result ? "processing" : "uncertain",
    candidate: result?.label ?? null,
    confidence: result?.confidence ?? 0,
    bufferSize: frames.length
  };
  self.postMessage(analysis);
  if (!result || result.confidence < CONFIDENCE_THRESHOLD) {
    candidateLabel = null;
    candidateStreak = 0;
    return;
  }
  if (candidateLabel === result.label) candidateStreak += 1;
  else {
    candidateLabel = result.label;
    candidateStreak = 1;
  }
  const now = event.data.frame.timestamp;
  if (shouldConfirm({
    confidence: result.confidence,
    threshold: CONFIDENCE_THRESHOLD,
    streak: candidateStreak,
    sameLabel: lastConfirmation.label === result.label,
    elapsedSinceLast: now - lastConfirmation.time,
    cooldown: COOLDOWN_MS
  })) {
    self.postMessage({
      type: "confirmed",
      text: result.text,
      gloss: result.label,
      confidence: result.confidence,
      timestamp: Date.now()
    });
    lastConfirmation = { label: result.label, time: now };
    candidateStreak = 0;
    frames.splice(0, Math.max(0, frames.length - 5));
  }
};
function recognize(sequence) {
  const personal = recognizePersonalTemplate(sequence, personalTemplates);
  if (activeLanguage !== "asl") return personal;
  return personal ?? recognizeILoveYou(sequence) ?? recognizeHello(sequence) ?? recognizeThankYou(sequence) ?? recognizeYes(sequence) ?? latestAsl1000;
}
function recognizeILoveYou(sequence) {
  const recent = sequence.slice(-10);
  const matches = recent.flatMap((frame) => frame.hands).filter((hand) => hand.gesture === "ILoveYou" && hand.gestureScore >= 0.62);
  if (matches.length < 7) return null;
  const average = matches.reduce((sum, hand) => sum + hand.gestureScore, 0) / matches.length;
  return { label: "I LOVE YOU", text: "I love you", confidence: clamp2(0.84 + average * 0.13) };
}
function recognizeHello(sequence) {
  const samples = dominantHandSamples(sequence.slice(-16));
  if (samples.length < 12 || !isMostlyOpen(samples)) return null;
  const wrists = samples.map((hand) => hand.landmarks[0]);
  const xRange = range2(wrists.map((point) => point.x));
  const yRange = range2(wrists.map((point) => point.y));
  const facePresent = sequence.slice(-16).filter((frame) => frame.face.length > 0).length >= 8;
  const nearHead = wrists.filter((point) => point.y < 0.48).length >= 8;
  const directionChanges = countDirectionChanges(wrists.map((point) => point.x), 8e-3);
  if (!facePresent || !nearHead || xRange < 0.11 || yRange > 0.15 || directionChanges < 1) return null;
  return { label: "HELLO", text: "Hello", confidence: clamp2(0.76 + xRange * 0.75) };
}
function recognizeThankYou(sequence) {
  const recent = sequence.slice(-18);
  const samples = dominantHandSamples(recent);
  if (samples.length < 13 || !isMostlyOpen(samples)) return null;
  const tips = samples.map((hand) => hand.landmarks[8]);
  const start = averagePoint2(tips.slice(0, 4));
  const end = averagePoint2(tips.slice(-4));
  const face = recent.find((frame) => frame.face.length)?.face;
  if (!face?.length) return null;
  const mouth = face[3] ?? face[0];
  const startsNearMouth = distance3(start, mouth) < 0.2;
  const movesDownAndOut = end.y - start.y > 0.075 && distance3(end, mouth) - distance3(start, mouth) > 0.085;
  if (!startsNearMouth || !movesDownAndOut) return null;
  return { label: "THANK YOU", text: "Thank you", confidence: clamp2(0.78 + (end.y - start.y) * 0.7) };
}
function recognizeYes(sequence) {
  const samples = dominantHandSamples(sequence.slice(-22));
  if (samples.length < 16 || !isMostlyFist(samples)) return null;
  const wrists = samples.map((hand) => hand.landmarks[0]);
  const yValues = wrists.map((point) => point.y);
  const xRange = range2(wrists.map((point) => point.x));
  const yRange = range2(yValues);
  const directionChanges = countDirectionChanges(yValues, 8e-3);
  if (yRange < 0.07 || xRange > 0.11 || directionChanges < 2) return null;
  return { label: "YES", text: "Yes", confidence: clamp2(0.77 + yRange * 0.85 + directionChanges * 0.02) };
}
function dominantHandSamples(sequence) {
  const right = sequence.map((frame) => frame.hands.find((hand) => hand.handedness === "Right") ?? frame.hands[0]).filter(Boolean);
  const left = sequence.map((frame) => frame.hands.find((hand) => hand.handedness === "Left") ?? frame.hands[0]).filter(Boolean);
  return right.length >= left.length ? right : left;
}
function extendedFingers(hand) {
  const tips = [8, 12, 16, 20];
  const pips = [6, 10, 14, 18];
  let count = 0;
  for (let index = 0; index < tips.length; index += 1) {
    const tip = hand.landmarks[tips[index]];
    const pip = hand.landmarks[pips[index]];
    if (tip && pip && distance3(tip, hand.landmarks[0]) > distance3(pip, hand.landmarks[0]) * 1.18) count += 1;
  }
  return count;
}
function isMostlyOpen(samples) {
  return samples.filter((hand) => extendedFingers(hand) >= 3).length / samples.length >= 0.72;
}
function isMostlyFist(samples) {
  return samples.filter((hand) => extendedFingers(hand) <= 1).length / samples.length >= 0.72;
}
function countDirectionChanges(values, epsilon) {
  let previous = 0;
  let changes = 0;
  for (let index = 1; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1];
    const direction = Math.abs(delta) < epsilon ? 0 : Math.sign(delta);
    if (direction && previous && direction !== previous) changes += 1;
    if (direction) previous = direction;
  }
  return changes;
}
function averagePoint2(points) {
  return points.reduce((total, point) => ({ x: total.x + point.x / points.length, y: total.y + point.y / points.length, z: total.z + point.z / points.length }), { x: 0, y: 0, z: 0 });
}
function distance3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function range2(values) {
  return Math.max(...values) - Math.min(...values);
}
function clamp2(value) {
  return Math.min(0.97, Math.max(0, value));
}
