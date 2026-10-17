import { makeSign } from "./asl-motion";
import type { VisionFrame } from "../../lib/vision-types";

// Constructed motion controls. These contain no captured signer landmarks.
function moveHand(frame: VisionFrame, x: number, y: number) {
  const wrist = frame.hands[0].landmarks[0];
  const dx = x - wrist.x, dy = y - wrist.y;
  for (const point of frame.hands[0].landmarks) { point.x += dx; point.y += dy; }
}

export function continuingChestCircle() {
  const frames = makeSign("PLEASE", { duration: 500, count: 25 });
  frames.forEach((frame, i) => {
    const angle = i / (frames.length - 1) * 3 * Math.PI;
    moveHand(frame, 0.5 + 0.06 * Math.cos(angle), 0.65 + 0.06 * Math.sin(angle));
  });
  return frames;
}

export function apparentCircleFromBodyMotion(moveHandWithBody: boolean) {
  const frames = makeSign("IDLE", { count: 25 });
  frames.forEach((frame, i) => {
    moveHand(frame, 0.6, 0.65);
    const angle = Math.min(1, i / 18) * 2 * Math.PI;
    const dx = 0.06 * Math.cos(angle), dy = 0.06 * Math.sin(angle);
    for (const point of [...frame.pose, ...frame.face]) { point.x += dx; point.y += dy; }
    if (moveHandWithBody) for (const point of frame.hands[0].landmarks) { point.x += dx; point.y += dy; }
  });
  return frames;
}

export function approachMouthThenDepart(outward = true) {
  const frames = makeSign("IDLE", { duration: 600, count: 25 });
  frames.forEach((frame, i) => {
    if (i < 5) moveHand(frame, 0.53, 0.75 - i / 4 * 0.25);
    else {
      const progress = Math.max(0, (i - 8) / 16);
      moveHand(frame, 0.53 + (outward ? 0.11 * progress : 0), 0.5 + 0.14 * progress);
    }
  });
  return frames;
}

export function mouthDepartureWithReturningWrist() {
  const frames = makeSign("PLEASE");
  // Keep horizontal travel below the outward THANK YOU requirement, while
  // retaining enough wrist movement to exercise competing circle evidence.
  frames.forEach((frame, i) => {
    const phase = Math.min(1, i / (frames.length - 1) / 0.75);
    moveHand(frame, 0.5 + 0.018 * Math.cos(phase * 2 * Math.PI), frame.hands[0].landmarks[0].y);
  });
  const tip = frames[0].hands[0].landmarks[8];
  const mouth = { ...tip };
  frames.forEach((frame, i) => {
    frame.face[3] = { ...mouth };
    frame.face[1] = { ...mouth, y: mouth.y - 0.05 };
    // The tracked fingertip departs and stays clear of the mouth while the
    // wrist completes its loop. Keep palm size fixed to isolate the veto.
    frame.hands[0].landmarks[8].y += Math.max(0, Math.min(1, (i - 2) / 4)) * 0.16;
  });
  return frames;
}
