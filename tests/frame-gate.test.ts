import { describe, expect, it } from "vitest";
import { MIN_ANALYSIS_INTERVAL_MS, shouldAnalyseFrame } from "../lib/frame-timing";

/** Display callbacks every 1000/60 ms with a little jitter, a 30 fps camera.
 * Returns analysed frames per second and the median gap between them. */
function simulate(minInterval: number, { display = 60, camera = 30, seconds = 10, jitter = 0.4 } = {}) {
  let last = -Infinity, lastVideo = -1, seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const accepted: number[] = [];
  for (let tick = 0; tick < seconds * display; tick++) {
    const now = tick * 1000 / display + (random() - 0.5) * 2 * jitter;
    const videoTime = Math.floor(now * camera / 1000) / camera;
    if (shouldAnalyseFrame(now, last, videoTime, lastVideo, minInterval)) { accepted.push(now); last = now; lastVideo = videoTime; }
  }
  const gaps = accepted.slice(1).map((time, index) => time - accepted[index]).sort((a, b) => a - b);
  return { perSecond: accepted.length / seconds, medianGap: gaps[Math.floor(gaps.length / 2)] };
}

describe("camera frame gate", () => {
  it("delivers the evaluated cadence: 20 analysed frames per second from a 30 fps camera on a 60 Hz display", () => {
    const result = simulate(MIN_ANALYSIS_INTERVAL_MS);
    expect(result.perSecond).toBeGreaterThan(19.5);
    expect(result.perSecond).toBeLessThan(20.5);
    expect(result.medianGap).toBeCloseTo(50, 0);
  });
  it("documents why the threshold is not 50 ms: display jitter makes that miss every other opportunity", () => {
    const result = simulate(50);
    expect(result.perSecond).toBeLessThan(18.5);
    expect(result.medianGap).toBeGreaterThan(60);
  });
  it("never analyses the same video frame twice and never exceeds 20 per second on a faster display", () => {
    expect(shouldAnalyseFrame(100, 0, 1.5, 1.5)).toBe(false);
    expect(shouldAnalyseFrame(44, 0, 1.6, 1.5)).toBe(false);
    expect(shouldAnalyseFrame(45, 0, 1.6, 1.5)).toBe(true);
    expect(simulate(MIN_ANALYSIS_INTERVAL_MS, { display: 120, camera: 60 }).perSecond).toBeLessThan(21);
    expect(simulate(MIN_ANALYSIS_INTERVAL_MS, { display: 144, camera: 30 }).perSecond).toBeLessThan(21);
  });
});
