import { expect, it } from "vitest";
import { shouldAnalyseFrame } from "../lib/frame-timing";

function simulateCamera(minIntervalMs?: number) {
  let last = -Infinity, lastVideo = -1, seed = 7, accepted = 0;
  for (let tick = 0; tick < 600; tick++) {
    seed = (seed * 16807) % 2147483647;
    const now = tick * 1000 / 60 + (seed / 2147483647 - 0.5) * 0.8;
    const videoTime = Math.floor(now * 30 / 1000) / 30;
    if (shouldAnalyseFrame(now, last, videoTime, lastVideo, minIntervalMs)) {
      accepted++;
      last = now;
      lastVideo = videoTime;
    }
  }
  return accepted / 10;
}

it("delivers about 20 analysis opportunities per second at 60 Hz display and 30 fps video", () => {
  expect(simulateCamera()).toBeCloseTo(20, 0);
  expect(simulateCamera(50)).toBeLessThan(18.5);
});

it("skips a repeated decoded frame or a callback arriving before the analysis cadence", () => {
  expect(shouldAnalyseFrame(100, 0, 1.5, 1.5)).toBe(false);
  expect(shouldAnalyseFrame(44, 0, 1.6, 1.5)).toBe(false);
  expect(shouldAnalyseFrame(49.8, 0, 1.6, 1.5)).toBe(true);
});
