import type { HandObservation, Point, VisionFrame } from "../../lib/vision-types";
import { handshape } from "./asl-motion";

/** Synthetic everyday (non-sign) hand movements in the same body frame as
 * makeSign: shoulders at y=0.48 (width 0.3), nose 0.27, mouth 0.32. They are
 * kinematic stand-ins, not recordings of people and not reviewed negatives. */
type Key = { t: number; x: number; y: number; scale?: number; shape?: "open" | "fist" };
const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

export function trajectory(keys: Key[], { duration, fps = 22, side = "Right" as HandObservation["handedness"], settleMs = 400 }:
  { duration: number; fps?: number; side?: HandObservation["handedness"]; settleMs?: number }): VisionFrame[] {
  const step = 1000 / fps;
  const count = Math.round(duration / step) + 1 + Math.round(settleMs / step);
  const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.6, z: 0, visibility: 1 }));
  pose[0] = { x: 0.5, y: 0.27, z: 0, visibility: 1 };
  pose[9] = { x: 0.5, y: 0.32, z: 0, visibility: 1 };
  pose[11] = { x: 0.35, y: 0.48, z: 0, visibility: 1 };
  pose[12] = { x: 0.65, y: 0.48, z: 0, visibility: 1 };
  const face = Array.from({ length: 20 }, () => ({ x: 0.5, y: 0.27, z: 0 }));
  face[3] = { x: 0.5, y: 0.32, z: 0 };
  return Array.from({ length: count }, (_, index) => {
    const t = Math.min(1, index * step / duration);
    const after = keys.findIndex(key => key.t >= t);
    const b = keys[Math.max(0, after)], a = keys[Math.max(0, after - 1)];
    const f = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
    const x = lerp(a.x, b.x, f), y = lerp(a.y, b.y, f), scale = lerp(a.scale ?? 1, b.scale ?? 1, f);
    const shape = (f < 0.5 ? a.shape : b.shape) ?? "open";
    const landmarks: Point[] = handshape(shape).map(point => ({ x: x + point.x * scale * (side === "Left" ? -1 : 1), y: y + point.y * scale, z: 0 }));
    return { timestamp: 1000 + index * step, hands: [{ landmarks, handedness: side, gesture: "None", gestureScore: 0 }],
      pose: pose.map(point => ({ ...point })), face: face.map(point => ({ ...point })) };
  });
}

export const NEGATIVE_CONTROLS: Record<string, () => VisionFrame[]> = {
  "hands resting at the chest": () => trajectory([{ t: 0, x: 0.6, y: 0.78 }, { t: 1, x: 0.6, y: 0.78 }], { duration: 3000 }),
  "adjusting glasses": () => trajectory([{ t: 0, x: 0.62, y: 0.8 }, { t: 0.35, x: 0.56, y: 0.42 }, { t: 0.55, x: 0.56, y: 0.42 }, { t: 1, x: 0.62, y: 0.8 }], { duration: 2200 }),
  "pushing hair aside near the forehead": () => trajectory([{ t: 0, x: 0.58, y: 0.4 }, { t: 1, x: 0.72, y: 0.41 }], { duration: 800 }),
  "conversational beat gestures": () => trajectory([0, 0.17, 0.33, 0.5, 0.67, 0.83, 1].map((t, i) => ({ t, x: 0.6, y: 0.7 + (i % 2 ? 0.035 : 0) })), { duration: 1500 }),
  "reaching toward the camera": () => trajectory([{ t: 0, x: 0.56, y: 0.5 }, { t: 0.5, x: 0.5, y: 0.52, scale: 1.7 }, { t: 1, x: 0.56, y: 0.5 }], { duration: 1600 }),
  "reaching across the chest": () => trajectory([{ t: 0, x: 0.3, y: 0.78 }, { t: 1, x: 0.76, y: 0.74 }], { duration: 1000 }),
  "scratching the chin": () => trajectory([0, 0.2, 0.4, 0.6, 0.8, 1].map((t, i) => ({ t, x: 0.53 + (i % 2 ? 0.012 : 0), y: 0.5 })), { duration: 1500 }),
  "lowering a hand from the mouth to rest": () => trajectory([{ t: 0, x: 0.53, y: 0.5 }, { t: 0.4, x: 0.53, y: 0.5 }, { t: 1, x: 0.72, y: 0.86 }], { duration: 1000 }),
  "lifting a fist as if holding a cup": () => trajectory([{ t: 0, x: 0.6, y: 0.82, shape: "fist" }, { t: 0.5, x: 0.56, y: 0.52, shape: "fist" }, { t: 1, x: 0.6, y: 0.82, shape: "fist" }], { duration: 1800 }),
  "raising an open hand from the chin toward the forehead": () => trajectory([{ t: 0, x: 0.53, y: 0.5 }, { t: 1, x: 0.68, y: 0.36 }], { duration: 800 }),
  "small fist shake at the chest": () => trajectory([0, 0.25, 0.5, 0.75, 1].map((t, i) => ({ t, x: 0.62 + (i % 2 ? 0.02 : 0), y: 0.6, shape: "fist" as const })), { duration: 900 }),
};
