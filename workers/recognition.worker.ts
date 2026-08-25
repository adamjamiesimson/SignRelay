/// <reference lib="webworker" />

import type { CalibrationTemplate, HandObservation, Point, VisionFrame, WorkerInput, WorkerMessage } from "@/lib/vision-types";
import { shouldConfirm } from "@/lib/decoder";
import { recognizePersonalTemplate } from "@/lib/personalized-recognition";
import { recognizeAsl100 } from "@/lib/asl100-runtime";

const MAX_FRAMES = 32;
const CONFIDENCE_THRESHOLD = 0.82;
const COOLDOWN_MS = 2600;
const frames: VisionFrame[] = [];
let candidateLabel: string | null = null;
let candidateStreak = 0;
let lastConfirmation = { label: "", time: 0 };
let personalTemplates: CalibrationTemplate[] = [];
let latestAsl100: Awaited<ReturnType<typeof recognizeAsl100>> = null;
let pendingAsl100 = false;

self.onmessage = async (event: MessageEvent<WorkerInput>) => {
  if (event.data.type === "templates") {
    personalTemplates = event.data.templates;
    frames.length = 0;
    candidateLabel = null;
    candidateStreak = 0;
    return;
  }

  if (event.data.type === "reset") {
    frames.length = 0;
    candidateLabel = null;
    candidateStreak = 0;
    return;
  }

  frames.push(event.data.frame);
  while (frames.length > MAX_FRAMES) frames.shift();

  if (frames.length >= 24 && !pendingAsl100 && frames.length % 6 === 0) {
    pendingAsl100 = true;
    recognizeAsl100([...frames]).then((prediction) => { latestAsl100 = prediction; }).catch(() => { latestAsl100 = null; }).finally(() => { pendingAsl100 = false; });
  }

  const result = recognize(frames);
  const analysis: WorkerMessage = {
    type: "analysis",
    state: frames.length < 10 ? "listening" : result ? "processing" : "uncertain",
    candidate: result?.label ?? null,
    confidence: result?.confidence ?? 0,
    bufferSize: frames.length,
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
    cooldown: COOLDOWN_MS,
  })) {
    self.postMessage({
      type: "confirmed",
      text: result.text,
      gloss: result.label,
      confidence: result.confidence,
      timestamp: Date.now(),
    } satisfies WorkerMessage);
    lastConfirmation = { label: result.label, time: now };
    candidateStreak = 0;
    frames.splice(0, Math.max(0, frames.length - 5));
  }
};

function recognize(sequence: VisionFrame[]) {
  return recognizePersonalTemplate(sequence, personalTemplates)
    ?? recognizeILoveYou(sequence)
    ?? recognizeHello(sequence)
    ?? recognizeThankYou(sequence)
    ?? recognizeYes(sequence)
    ?? latestAsl100;
}

function recognizeILoveYou(sequence: VisionFrame[]) {
  const recent = sequence.slice(-10);
  const matches = recent.flatMap((frame) => frame.hands)
    .filter((hand) => hand.gesture === "ILoveYou" && hand.gestureScore >= 0.62);
  if (matches.length < 7) return null;
  const average = matches.reduce((sum, hand) => sum + hand.gestureScore, 0) / matches.length;
  return { label: "I LOVE YOU", text: "I love you", confidence: clamp(0.84 + average * 0.13) };
}

function recognizeHello(sequence: VisionFrame[]) {
  const samples = dominantHandSamples(sequence.slice(-16));
  if (samples.length < 12 || !isMostlyOpen(samples)) return null;
  const wrists = samples.map((hand) => hand.landmarks[0]);
  const xRange = range(wrists.map((point) => point.x));
  const yRange = range(wrists.map((point) => point.y));
  const facePresent = sequence.slice(-16).filter((frame) => frame.face.length > 0).length >= 8;
  const nearHead = wrists.filter((point) => point.y < 0.48).length >= 8;
  const directionChanges = countDirectionChanges(wrists.map((point) => point.x), 0.008);
  if (!facePresent || !nearHead || xRange < 0.11 || yRange > 0.15 || directionChanges < 1) return null;
  return { label: "HELLO", text: "Hello", confidence: clamp(0.76 + xRange * 0.75) };
}

function recognizeThankYou(sequence: VisionFrame[]) {
  const recent = sequence.slice(-18);
  const samples = dominantHandSamples(recent);
  if (samples.length < 13 || !isMostlyOpen(samples)) return null;
  const tips = samples.map((hand) => hand.landmarks[8]);
  const start = averagePoint(tips.slice(0, 4));
  const end = averagePoint(tips.slice(-4));
  const face = recent.find((frame) => frame.face.length)?.face;
  if (!face?.length) return null;
  const mouth = face[3] ?? face[0];
  const startsNearMouth = distance(start, mouth) < 0.2;
  const movesDownAndOut = end.y - start.y > 0.075 && distance(end, mouth) - distance(start, mouth) > 0.085;
  if (!startsNearMouth || !movesDownAndOut) return null;
  return { label: "THANK YOU", text: "Thank you", confidence: clamp(0.78 + (end.y - start.y) * 0.7) };
}

function recognizeYes(sequence: VisionFrame[]) {
  const samples = dominantHandSamples(sequence.slice(-22));
  if (samples.length < 16 || !isMostlyFist(samples)) return null;
  const wrists = samples.map((hand) => hand.landmarks[0]);
  const yValues = wrists.map((point) => point.y);
  const xRange = range(wrists.map((point) => point.x));
  const yRange = range(yValues);
  const directionChanges = countDirectionChanges(yValues, 0.008);
  if (yRange < 0.07 || xRange > 0.11 || directionChanges < 2) return null;
  return { label: "YES", text: "Yes", confidence: clamp(0.77 + yRange * 0.85 + directionChanges * 0.02) };
}

function dominantHandSamples(sequence: VisionFrame[]) {
  const right = sequence.map((frame) => frame.hands.find((hand) => hand.handedness === "Right") ?? frame.hands[0]).filter(Boolean);
  const left = sequence.map((frame) => frame.hands.find((hand) => hand.handedness === "Left") ?? frame.hands[0]).filter(Boolean);
  return (right.length >= left.length ? right : left) as HandObservation[];
}

function extendedFingers(hand: HandObservation) {
  const tips = [8, 12, 16, 20];
  const pips = [6, 10, 14, 18];
  let count = 0;
  for (let index = 0; index < tips.length; index += 1) {
    const tip = hand.landmarks[tips[index]];
    const pip = hand.landmarks[pips[index]];
    if (tip && pip && distance(tip, hand.landmarks[0]) > distance(pip, hand.landmarks[0]) * 1.18) count += 1;
  }
  return count;
}

function isMostlyOpen(samples: HandObservation[]) {
  return samples.filter((hand) => extendedFingers(hand) >= 3).length / samples.length >= 0.72;
}

function isMostlyFist(samples: HandObservation[]) {
  return samples.filter((hand) => extendedFingers(hand) <= 1).length / samples.length >= 0.72;
}

function countDirectionChanges(values: number[], epsilon: number) {
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

function averagePoint(points: Point[]): Point {
  return points.reduce((total, point) => ({ x: total.x + point.x / points.length, y: total.y + point.y / points.length, z: total.z + point.z / points.length }), { x: 0, y: 0, z: 0 });
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function range(values: number[]) {
  return Math.max(...values) - Math.min(...values);
}

function clamp(value: number) {
  return Math.min(0.97, Math.max(0, value));
}

export {};
