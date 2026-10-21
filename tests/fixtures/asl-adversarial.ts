import type { Point, VisionFrame } from "../../lib/vision-types";
import { NEGATIVE_CONTROLS, trajectory } from "./asl-negative-controls";

/** Synthetic adversarial non-sign movements, grouped by the everyday activity
 * they imitate, plus deterministic capture variations. Same body frame as
 * makeSign (nose 0.27, mouth 0.32, shoulders 0.48). These are kinematic
 * stand-ins, not recordings of people and not reviewed negatives: outcomes are a
 * regression inventory of rule behaviour, never a false-acceptance rate. */
export const ADVERSARIAL_PATTERNS: Record<string, Record<string, () => VisionFrame[]>> = {
  glasses: {
    "adjusting glasses": NEGATIVE_CONTROLS["adjusting glasses"],
    "pushing glasses up the nose": () => trajectory([{ t: 0, x: 0.58, y: 0.8 }, { t: 0.4, x: 0.51, y: 0.33 }, { t: 0.5, x: 0.51, y: 0.3 }, { t: 0.6, x: 0.51, y: 0.33 }, { t: 1, x: 0.6, y: 0.82 }], { duration: 1600 }),
  },
  hair: {
    "pushing hair aside near the forehead": NEGATIVE_CONTROLS["pushing hair aside near the forehead"],
    "tucking hair behind the ear": () => trajectory([{ t: 0, x: 0.64, y: 0.8 }, { t: 0.4, x: 0.66, y: 0.34 }, { t: 0.65, x: 0.74, y: 0.33 }, { t: 1, x: 0.68, y: 0.82 }], { duration: 1800 }),
  },
  "face touching": {
    "scratching the chin": NEGATIVE_CONTROLS["scratching the chin"],
    "resting the cheek on a hand": () => trajectory([{ t: 0, x: 0.62, y: 0.8 }, { t: 0.3, x: 0.6, y: 0.42 }, { t: 0.8, x: 0.6, y: 0.42 }, { t: 1, x: 0.62, y: 0.8 }], { duration: 2600 }),
    "rubbing an eye": () => trajectory([0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1].map((t, i) => ({ t, x: 0.55 + 0.012 * Math.cos(i * 1.6), y: 0.36 + 0.012 * Math.sin(i * 1.6), shape: "fist" as const })), { duration: 1400 }),
  },
  "accidental salute": {
    "raising an open hand from the chin toward the forehead": NEGATIVE_CONTROLS["raising an open hand from the chin toward the forehead"],
    "shielding the eyes from light": () => trajectory([{ t: 0, x: 0.62, y: 0.8 }, { t: 0.35, x: 0.56, y: 0.36 }, { t: 0.85, x: 0.57, y: 0.36 }, { t: 1, x: 0.62, y: 0.8 }], { duration: 2400 }),
    "waving to someone across the room": () => trajectory([0, 0.2, 0.35, 0.5, 0.65, 0.8, 1].map((t, i) => ({ t, x: t === 0 || t === 1 ? 0.7 : 0.72 + (i % 2 ? 0.05 : -0.05), y: t === 0 || t === 1 ? 0.8 : 0.3 })), { duration: 2000 }),
  },
  "fist lifting": {
    "lifting a fist as if holding a cup": NEGATIVE_CONTROLS["lifting a fist as if holding a cup"],
    "small fist shake at the chest": NEGATIVE_CONTROLS["small fist shake at the chest"],
    "fist pump": () => trajectory([{ t: 0, x: 0.66, y: 0.72, shape: "fist" }, { t: 0.4, x: 0.68, y: 0.36, shape: "fist" }, { t: 0.6, x: 0.68, y: 0.38, shape: "fist" }, { t: 1, x: 0.66, y: 0.74, shape: "fist" }], { duration: 900 }),
  },
  conversation: {
    "conversational beat gestures": NEGATIVE_CONTROLS["conversational beat gestures"],
    "open-palm shrug": () => trajectory([{ t: 0, x: 0.58, y: 0.75 }, { t: 0.5, x: 0.72, y: 0.66 }, { t: 1, x: 0.6, y: 0.76 }], { duration: 1200 }),
    "pointing toward the screen": NEGATIVE_CONTROLS["reaching toward the camera"],
  },
  "hand to mouth": {
    "lowering a hand from the mouth to rest": NEGATIVE_CONTROLS["lowering a hand from the mouth to rest"],
    "covering a cough with a fist": () => trajectory([{ t: 0, x: 0.6, y: 0.8, shape: "fist" }, { t: 0.35, x: 0.52, y: 0.36, shape: "fist" }, { t: 0.7, x: 0.52, y: 0.36, shape: "fist" }, { t: 1, x: 0.6, y: 0.8, shape: "fist" }], { duration: 1800 }),
    "blowing a kiss": () => trajectory([{ t: 0, x: 0.6, y: 0.8 }, { t: 0.35, x: 0.52, y: 0.36 }, { t: 0.5, x: 0.52, y: 0.36 }, { t: 1, x: 0.66, y: 0.5, scale: 1.25 }], { duration: 1400 }),
  },
};

type Variation = { side: "Right" | "Left"; speed: number; distance: number; degradation: "clean" | "jitter" | "dropout" };
export const VARIATION_AXES = {
  side: ["Right", "Left"] as const, speed: [0.7, 1, 1.4] as const, distance: [0.85, 1.15] as const,
  degradation: ["clean", "jitter", "dropout"] as const,
};
export const VARIATIONS: Variation[] = VARIATION_AXES.side.flatMap(side => VARIATION_AXES.speed.flatMap(speed =>
  VARIATION_AXES.distance.flatMap(distance => VARIATION_AXES.degradation.map(degradation => ({ side, speed, distance, degradation })))));

/** Apply a capture variation to a whole frame sequence: playback speed, a
 * mirrored left-handed signer, camera distance about the body centre, and
 * either deterministic landmark jitter or every fourth hand detection lost. */
export function vary(frames: VisionFrame[], { side, speed, distance, degradation }: Variation): VisionFrame[] {
  const start = frames[0].timestamp;
  const move = (point: Point, index: number, landmark = -1): Point => {
    const noise = degradation === "jitter" && landmark >= 0 ? 0.004 : 0;
    const x = 0.5 + (point.x - 0.5) * distance + noise * Math.sin(index * 1.9 + landmark * 0.7);
    return { ...point, x: side === "Left" ? 1 - x : x, y: 0.5 + (point.y - 0.5) * distance + noise * Math.cos(index * 1.3 + landmark) };
  };
  return frames.map((frame, index) => ({
    ...frame,
    timestamp: start + (frame.timestamp - start) / speed,
    hands: degradation === "dropout" && index % 4 === 3 ? [] : frame.hands.map(hand => ({ ...hand, handedness: side,
      landmarks: hand.landmarks.map((point, landmark) => move(point, index, landmark)) })),
    pose: frame.pose.map(point => move(point, index)),
    face: frame.face.map(point => move(point, index)),
  }));
}

export const variationKey = (v: Variation) => `${v.side}/x${v.speed}/d${v.distance}/${v.degradation}`;
