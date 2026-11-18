import assert from "node:assert/strict";
import { test } from "node:test";
import { LatestFrame } from "./latest-frame.mjs";
import { FrameTrace } from "./frame-trace.mjs";
import { PoseContext } from "./pose-context.mjs";

test("a latest-frame slot closes replaced, expired and cancelled frames exactly once", () => {
  const discarded = [];
  const closed = [];
  const slot = new LatestFrame((record, reason) => discarded.push([record.id, reason]));
  const add = (id, at) => slot.offer({ id, at }, { close: () => closed.push(id) });
  add(1, 5);
  add(2, 25);
  assert.equal(slot.take(40).record.id, 2);
  assert.equal(slot.take(40), null);
  add(3, 60);
  assert.equal(slot.take(181), null);
  add(4, 190);
  slot.clear("cancelled");
  slot.clear("cancelled");
  assert.deepEqual(discarded, [[1, "replaced"], [3, "stale"], [4, "cancelled"]]);
  assert.deepEqual(closed, [1, 3, 4]);
});

test("pose responses are asynchronous, source-time-bounded and safe on failure", () => {
  const sent = [];
  const worker = { postMessage: value => sent.push(value), terminate() { this.ended = true; } };
  const context = new PoseContext(worker);
  const img = { close() {} };
  assert.equal(context.offer(300, () => img, 1), false);
  worker.onmessage({ data: { type: "ready" } });
  assert.equal(context.offer(300, () => img, 2), true);
  assert.equal(context.offer(600, () => img, 3), false);
  assert.deepEqual(context.read(350), []);
  const points = [{ x: 0.5, y: 0.5, z: 0 }];
  worker.onmessage({ data: { type: "pose", timestamp: 300, points, duration: 50 } });
  assert.deepEqual(context.read(299), []);
  assert.deepEqual(context.read(650), points);
  assert.deepEqual(context.read(651), []);
  assert.equal(context.offer(600, () => img, 4), true);
  assert.equal(context.offer(650, () => img, 1805), false);
  assert.equal(worker.ended, true);
  assert.equal(context.failed, true);
  assert.deepEqual(context.read(700), []);
  assert.equal(sent.length, 2);
});

test("frame accounting keeps totals and only a bounded recent ring with causal model source IDs", () => {
  const trace = new FrameTrace(2);
  const first = trace.present(0, 10, 1);
  trace.mark(first, "accepted");
  trace.mark(first, "sent");
  trace.occupy(1);
  trace.complete(first, { detected: true, hand: true, detection: { malformed: 0, offscreen: 0 },
    segmentation: { windows: [{ ids: [1, 1, 2] }], rejected: 0, reset: false, resetSamples: 0, capacityEvicted: 0 },
    result: { event: "PLEASE" } }, 40);
  trace.mark(trace.present(30, 45, 3, 1), "busy");
  trace.mark(trace.present(60, 70, null, 0, false), "captured");
  const { frames, counters } = trace.snapshot();
  assert.deepEqual(frames.map(frame => frame.id), [2, 3]);
  assert.equal(counters.presented, 3);
  assert.equal(counters.cameraFramesRead, 1);
  assert.equal(counters.processed, 1);
  assert.equal(counters.modelSourceFrames, 2);
  assert.equal(counters.modelSlots, 3);
  assert.equal(counters.suggestions, 1);
});
