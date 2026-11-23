import type { VisionFrame } from "../../lib/vision-types";
import { makeSign, type Sign } from "./asl-motion";

/** Synthetic capture conditions shared by the cross-sign, confusion and
 * experiment suites. Kinematic fixtures, not recordings. */
export const SIGNS = ["HELLO", "NO", "YES", "PLEASE", "SORRY", "THANK YOU"] as const satisfies readonly Sign[];
export const settle = (frames: VisionFrame[]) => {
  const last = frames.at(-1)!;
  return [...frames, ...Array.from({ length: 8 }, (_, i) => ({ ...structuredClone(last), timestamp: last.timestamp + (i + 1) * 50 }))];
};
export const CONDITIONS: Record<string, (sign: Sign) => VisionFrame[]> = {
  "10 fps": sign => makeSign(sign, { count: 10 }),
  "15 fps": sign => makeSign(sign, { count: 14 }),
  "30 fps": sign => makeSign(sign, { count: 28 }),
  "fast (600 ms)": sign => makeSign(sign, { duration: 600, count: 14 }),
  "slow (1.6 s)": sign => makeSign(sign, { duration: 1600, count: 36 }),
  "left hand": sign => makeSign(sign, { side: "Left" }),
  "farther from camera": sign => makeSign(sign, { scale: 0.7 }),
  "closer to camera": sign => makeSign(sign, { scale: 1.3 }),
  "landmark jitter": sign => makeSign(sign, { jitter: 0.004 }),
  "every 5th hand frame lost": sign => makeSign(sign).map((frame, i) => i % 5 === 2 ? { ...frame, hands: [] } : frame),
  "every 3rd hand frame lost": sign => makeSign(sign).map((frame, i) => i % 3 === 1 ? { ...frame, hands: [] } : frame),
  "two-frame mid-sign dropout": sign => makeSign(sign).map((frame, i) => i === 10 || i === 11 ? { ...frame, hands: [] } : frame),
  "no pose": sign => makeSign(sign).map(frame => ({ ...frame, pose: [] })),
  "no face": sign => makeSign(sign).map(frame => ({ ...frame, face: [] })),
  "unknown handedness": sign => makeSign(sign).map(frame => ({ ...frame, hands: frame.hands.map(hand => ({ ...hand, handedness: "Unknown" as const })) })),
};
