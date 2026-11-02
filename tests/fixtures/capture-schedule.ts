import type { VisionFrame } from "../../lib/vision-types";
import { makeSign, type Sign } from "./asl-motion";

// Shared camera/tracker schedule simulator for the word-rule timing
// experiments (synthetic kinematics only; not recordings).
const seeded = (seed: number) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

/** Dense source (10 ms) of signs separated by rests with the hands out of view. */
export function source(signs: readonly string[], restMs: number) {
  const frames: VisionFrame[] = [];
  let at = 0;
  for (const sign of signs) {
    for (const frame of makeSign(sign as Sign, { count: 91 })) frames.push({ ...frame, timestamp: at + frame.timestamp - 1000 });
    at = frames.at(-1)!.timestamp;
    for (let t = 10; t <= restMs; t += 10) frames.push({ ...frames.at(-1)!, hands: [], timestamp: at + t });
    at = frames.at(-1)!.timestamp + 10;
  }
  return frames;
}

export type Schedule = { cameraFps: number; trackingMs: number; seed: number };
/** Camera frames (sample-and-hold of the source at the camera's capture
 * times) picked by a 60 Hz loop whenever the lane is free, 33 ms apart, the
 * newest presented frame only, exactly as the word frame loop schedules. */
export function schedule(frames: VisionFrame[], { cameraFps, trackingMs, seed }: Schedule) {
  const random = seeded(seed), period = 1000 / cameraFps, latency = 20, end = frames.at(-1)!.timestamp;
  const camera: { capture: number; frame: VisionFrame }[] = [];
  let index = 0;
  for (let capture = random() * period; capture <= end; capture += period) {
    while (index + 1 < frames.length && frames[index + 1].timestamp <= capture) index++;
    camera.push({ capture, frame: frames[index] });
  }
  const picked: { capture: number; tick: number; frame: VisionFrame }[] = [];
  let tick = 0, freeAt = 0, lastPick = -Infinity, lastCamera = -1;
  while (tick < end + 500) {
    tick += 1000 / 60 + (random() - 0.5) * 2;
    if (tick < freeAt || tick - lastPick < 33) continue;
    let newest = lastCamera;
    while (newest + 1 < camera.length && camera[newest + 1].capture + latency <= tick) newest++;
    if (newest === lastCamera) continue;
    picked.push({ ...camera[newest], tick });
    lastCamera = newest; lastPick = tick; freeAt = tick + trackingMs * (0.7 + 0.6 * random());
  }
  return picked;
}

