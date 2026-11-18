import assert from "node:assert/strict";
import { test } from "node:test";
import { scoreTrial } from "./webcam-trials.mjs";

test("webcam scoring distinguishes intentional repeats, duplicates and ordered signs", () => {
  assert.deepEqual(scoreTrial(["YES", "YES"], ["YES", "YES"], true), { outcome: "correct", duplicateWords: 0 });
  assert.deepEqual(scoreTrial(["YES"], ["YES", "YES"], true), { outcome: "duplicate", duplicateWords: 1 });
  assert.equal(scoreTrial(["YES", "NO"], ["NO", "YES"], true).outcome, "incorrect");
  assert.equal(scoreTrial(["YES", "YES"], ["YES"], true).outcome, "incorrect");
  assert.deepEqual(scoreTrial(["YES", "NO"], ["YES", "YES"], true), { outcome: "incorrect", duplicateWords: 1 });
});

test("webcam scoring separates negative outcomes, abstention and capture failure", () => {
  assert.equal(scoreTrial([], [], true).outcome, "rejected");
  assert.deepEqual(scoreTrial([], ["NO", "NO"], true), { outcome: "false accept", duplicateWords: 1 });
  assert.equal(scoreTrial(["NO"], [], true).outcome, "abstained");
  assert.equal(scoreTrial(["NO"], ["NO"], false).outcome, "failed");
});
