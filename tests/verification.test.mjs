import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Confirmation, targetEvidence, verificationInterval, verificationWindows, windowFor } from '../src/verification.mjs';
import { N_POINTS } from '../src/upstream-preprocess.mjs';

test('short sparse motion uses one unique inference window and fresh confirmations', () => {
  const samples = Array.from({ length: 3 }, (_, n) => {
    const f = new Float32Array(N_POINTS * 3).fill(NaN);
    for (let p = 0; p < 21; p++) f.set([.2 + p * .01, .4 + n * .05, 0], p * 3);
    return { f, t: n * 200 };
  });
  assert.equal(verificationWindows(samples, true, true).length, 0);
  assert.equal(verificationWindows(samples, true).length, 1);
  assert.ok(verificationInterval(true) < 200);
  const signal = new Confirmation();
  assert.equal(signal.push(.8, 0, .6), false);
  assert.equal(signal.push(.8, 120, .6), false);
  assert.equal(signal.push(.8, 240, .6), true);
});

test('target is scored even when another class has a higher logit', () => {
  const metadata = { unknown_index: 2, policy: { temperature: 1 }, prototypes: new Float32Array([1,0,0,1]) };
  const result = targetEvidence(Float32Array.of(1.9,2,-6), Float32Array.of(1,0), metadata, [0,1,-1]);
  assert.ok(result[0].p < result[1].p);
  assert.ok(result[0].score >= .60);
  assert.ok(result[1].score < .60);
  assert.equal(result[2].score, 0);
  const unknown = targetEvidence(Float32Array.of(2,1,8), Float32Array.of(1,0), metadata, [0]);
  assert.equal(unknown[0].score, 0);
});
test('sparse camera path retains motion, duration and continuity requirements', () => {
  const samples = Array.from({ length: 4 }, (_, n) => {
    const f = new Float32Array(N_POINTS * 3).fill(NaN);
    for (let p = 0; p < 21; p++) f.set([.2 + p * .01, .4 + n * .03, 0], p * 3);
    return { f, t: n * 210 };
  });
  assert.equal(windowFor(samples, 1150), null);
  assert.ok(windowFor(samples, 1150, true));
  assert.equal(windowFor(samples.slice(0, 3), 1150, true), null);
  samples[3].t = 1100;
  assert.equal(windowFor(samples, 1150, true), null);
});
test('history filters empty frames, tiny static motion, and tracking gaps', () => {
  const frames = (delta, detected = true) => Array.from({ length: 9 }, (_, n) => {
    const f = new Float32Array(N_POINTS * 3).fill(NaN);
    if (detected) for (let point = 0; point < 21; point++) {
      f.set([.25 + point * .01 + n * delta, .45, 0], point * 3);
    }
    return { f, t: n * 66 };
  });
  assert.equal(windowFor(frames(0, false), 700), null);
  assert.equal(windowFor(frames(.0002), 700), null);
  assert.ok(windowFor(frames(.012), 700));
  const split = frames(.01);
  split.slice(4).forEach(item => { item.t += 310; });
  assert.equal(windowFor(split, 1150), null);
});
test('acceptance needs two real timestamped signals and clears on low evidence', () => {
  const signal = new Confirmation();
  assert.equal(signal.push(.9, 1100, .6), false);
  assert.equal(signal.push(.58, 1320, .6), false);
  assert.equal(signal.push(.94, 1550, .6), false);
  assert.equal(signal.push(.7, 1810, .6), true);
  assert.equal(signal.push(.8, 3200, .6), false);
  assert.equal(signal.push(.8, 3200, .6), false);
  signal.reset();
  assert.equal(signal.push(.9, 3460, .6), false);
});

