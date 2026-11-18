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

test("browser hand points with unused visibility fields remain observed", () => {
  const tracked = hand("Left");
  for (const point of tracked.landmarks) point.visibility = 0;
  const frame = { timestamp: 0, hands: [tracked], pose: [{ x: 0.5, y: 0.5, z: 0, visibility: 0 }] };
  const value = observation(frame, 0.75);
  assert.equal(value.h, true);
  assert.equal(value.x[1], 0);
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

test("an emission owns its evidence and a short observed release admits an intentional repeat", () => {
  const stream = new Stream(model({ offset: [0, 0, 0, 3, 0, 0] }));
  const events = [];
  const blocked = new Set();
  for (let time = 0; time <= 2450; time += 50) {
    const trace = { windows: [], rejected: 0 };
    const neutral = time >= 1450 && time < 1700;
    const result = stream.push(sample(time, neutral ? [] : undefined), trace);
    if (result?.event) events.push({ label: result.event, ...trace.confirmedEvent });
    if (trace.eventBlocked) blocked.add(trace.eventBlocked);
  }
  assert.deepEqual(events.map(item => [item.label, item.id]), [["YES", 1], ["YES", 2]]);
  assert(events[0].end < events[1].start);
  assert(events[1].start >= 1700);
  assert(blocked.has("consumed hand evidence"));
});

test("a camera delivery gap cannot release a sign with the hand still held", () => {
  const stream = new Stream(model());
  const events = [];
  for (const [start, end, hands] of [[0, 1400, true], [2200, 3900, true], [3900, 4150, false], [4150, 5000, true]]) {
    for (let time = start; time < end; time += 50) {
      const result = stream.push(sample(time, hands ? undefined : []));
      if (result?.event) events.push([result.eventId, time]);
    }
  }
  assert.deepEqual(events.map(([id]) => id), [1, 2]);
  assert(events[1][1] >= 4150);
});

test("stream calibration can reject a score the isolated model would accept", () => {
  const fitted = model({ streamScore: 3, streamMargin: 1 });
  const samples = Array.from({ length: 30 }, (_, index) => sample(index * 50));
  assert.equal(predict(fitted, tensor(samples, "landmark")).label, "HELLO");
  const stream = new Stream(fitted);
  assert(samples.every(frame => !stream.push(frame)?.event));
  assert.throws(() => model({ streamScore: 3 }), /Incompatible/);
});

test("freshness blocks an old window without consuming the next sign's evidence", () => {
  const fitted = model();
  const streams = [new Stream(fitted), new Stream(fitted, { rejection: { recentEvidence: true } })];
  const events = streams.map(() => []);
  const rejection = [];
  for (let time = 0; time <= 2500; time += 50) {
    const hands = time <= 300 && time % 100 === 0 || time >= 1500;
    streams.forEach((stream, i) => {
      const trace = { windows: [], rejected: 0 };
      const result = stream.push(sample(time, hands ? undefined : []), trace);
      if (result?.event) events[i].push(time);
      if (i && trace.eventBlocked === "stale hand evidence") rejection.push(time);
    });
  }
  assert.equal(events[0].length, 2);
  assert(events[0][0] < 1500);
  assert.equal(events[1].length, 1);
  assert(events[1][0] >= 1500);
  assert(rejection.some(time => time < 1500));
});

test("an experimental class-relative floor rejects OTHER ambiguity without changing the base logits", () => {
  const fitted = model();
  const stream = new Stream(fitted, { rejection: { otherMargin: { HELLO: 3 } } });
  let tested = false;
  for (let time = 0; time <= 1350; time += 50) {
    const trace = { windows: [], rejected: 0 };
    const result = stream.push(sample(time), trace);
    assert(!result?.event);
    if (!trace.windows.length) continue;
    assert.equal(trace.windows[0].label, "HELLO");
    assert.equal(trace.windows[0].otherMargin, 2);
    assert.equal(trace.windows[0].rejection, "other margin");
    tested = true;
  }
  assert(tested);
});

test("tensor instrumentation records real source IDs and leaves numeric inputs unchanged", () => {
  const samples = Array.from({ length: 6 }, (_, index) => ({ ...sample(index * 50), id: index + 1 }));
  const trace = { ids: [] };
  assert.deepEqual(tensor(samples, "landmark", trace), tensor(samples, "landmark"));
  assert.equal(trace.ids.length, 16);
  assert.deepEqual([...new Set(trace.ids)], [1, 2, 3, 4, 5, 6]);
});
