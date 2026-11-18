import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTRACT, LANDMARK_WIDTH, LABELS, RGB_WIDTH, STEPS, Stream, logits, observation, parseModel, predict, tensor } from "./core.mjs";

function model(overrides = {}) {
  return parseModel({
    contract: CONTRACT, mode: "landmark", version: "test", steps: STEPS, labels: LABELS, channels: 1,
    mean: Array(LANDMARK_WIDTH).fill(0), scale: Array(LANDMARK_WIDTH).fill(1),
    conv: Array(3 * LANDMARK_WIDTH).fill(0), bias: [0], head: Array(4 * LABELS.length).fill(0),
    offset: [2, 0, 0, 0, 0, 0], minScore: 1, minMargin: 1, ...overrides,
  });
}

const hand = handedness => ({ handedness, landmarks: Array.from({ length: 21 }, (_, i) =>
  ({ x: 0.3 + i * 0.01, y: 0.5 - i * 0.01, z: 0 })) });
const sample = (timestamp, hands = [hand("Right")]) => observation({ timestamp, hands, pose: [] }, 0.75);

test("absent pose becomes zero masks and both hand slots stay distinct", () => {
  const empty = sample(0, []);
  assert.equal(empty.h, false);
  assert(empty.x.every(Number.isFinite));
  assert.deepEqual(empty.x.slice(0, 2), [0, 0]);
  const both = sample(0, [hand("Right"), hand("Left")]);
  assert.equal(both.x.length, LANDMARK_WIDTH);
  assert.deepEqual([both.x[3], both.x[45]], [1, 1]);
  assert.deepEqual([sample(0).x[3], sample(0).x[45]], [0, 1]);
});

test("elapsed-time resampling preserves missing observations and rejects bad frames", () => {
  const samples = [sample(0), sample(100), sample(800, []), sample(900)];
  const values = tensor(samples, "landmark");
  assert.equal(values.length, STEPS * LANDMARK_WIDTH);
  assert.equal(values[45], 1);
  assert.equal(values[8 * LANDMARK_WIDTH + 45], 0);
  assert.equal(values[15 * LANDMARK_WIDTH + 45], 1);
  assert.equal(tensor(samples.slice(0, 2), "landmark"), null);
  assert.equal(tensor(samples, "hybrid").length, STEPS * (LANDMARK_WIDTH + RGB_WIDTH));
  assert.throws(() => tensor([samples[1], samples[0]], "landmark"), /Non-monotonic/);
  assert.throws(() => tensor([{ ...samples[0], x: [null] }, ...samples.slice(1)], "landmark"), /Invalid landmark/);
});

test("scoring validates the wire shape and retains explicit other and abstention", () => {
  const data = new Float32Array(STEPS * LANDMARK_WIDTH);
  assert.deepEqual(logits(model(), data), [2, 0, 0, 0, 0, 0]);
  assert.equal(predict(model(), data).label, "HELLO");
  assert.equal(predict(model({ minMargin: 2.1 }), data).reason, "uncertain match");
  assert.equal(predict(model({ offset: [0, 0, 0, 0, 0, 2] }), data).reason, "unsupported movement");
  assert.equal(predict(model(), null).label, null);
  assert.throws(() => model({ labels: ["NO"], mean: [] }), /Incompatible/);
});

test("stream emits once per run, resets across interruptions and never emits without visible hands", () => {
  const stream = new Stream(model());
  let received = [];
  for (let time = 0; time < 2500; time += 50) {
    const result = stream.push(sample(time));
    if (result?.event) received.push(result.event);
  }
  assert.deepEqual(received, ["HELLO"]);
  assert.throws(() => stream.push(sample(2400)), /Non-monotonic/);
  received = [];
  for (let time = 3500; time < 6500; time += 50) {
    const result = stream.push(sample(time, []));
    if (result?.event) received.push(result.event);
  }
  assert.deepEqual(received, []);
  for (let time = 6500; time < 8000; time += 50) {
    const result = stream.push(sample(time));
    if (result?.event) received.push(result.event);
  }
  assert.deepEqual(received, ["HELLO"]);
  assert(stream.samples.length <= 33);
});

test("a steady six FPS still fills a one-second recognition window", () => {
  const stream = new Stream(model());
  const suggestions = Array.from({ length: 12 }, (_, index) => stream.push(sample(index * 167))?.event);
  assert.deepEqual(suggestions.filter(Boolean), ["HELLO"]);
});
