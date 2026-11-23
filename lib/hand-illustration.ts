/** Geometry for the homepage illustration. It draws two stylised hands in the
 * 21-point layout hand trackers use, so the picture resembles what SignRelay
 * actually tracks, but every pose here is hand-authored: nothing is recorded,
 * recognised or scored. Pure functions, so the motion can be tested without a
 * browser and rendered without re-rendering React on every frame. */

export type Point = { x: number; y: number };

/** One illustrated hand. Angles are in degrees, 0 = fingers pointing up. */
export type HandPose = {
  x: number;
  y: number;
  angle: number;
  /** Turning the palm away from the viewer narrows it (0 = facing, 1 = edge-on). */
  turn: number;
  scale: number;
  /** Flexion per finger, thumb first: 0 straight, 1 fully folded. */
  curl: [number, number, number, number, number];
  spread: number;
  opacity: number;
};

export type Scene = { dominant: HandPose; support: HandPose };

// Hand-local layout for a right hand seen palm-on, wrist at the origin and the
// thumb toward −x. Units are palm widths.
const BASES: Point[] = [
  { x: -0.3, y: -0.2 }, { x: -0.38, y: -0.95 }, { x: -0.13, y: -1 }, { x: 0.12, y: -0.96 }, { x: 0.34, y: -0.86 },
];
const LENGTHS = [[0.3, 0.26, 0.22], [0.4, 0.23, 0.19], [0.44, 0.27, 0.2], [0.41, 0.25, 0.19], [0.32, 0.19, 0.17]];
const FAN = [-48, -7, -1, 5, 12];
// Seen from the front, a folded finger's first segment points almost at the
// viewer, so it projects short; the next two fold back down over the palm.
const BEND = [80, 100, 60];

const rad = (degrees: number) => (degrees * Math.PI) / 180;

/** The 21 points (wrist, then thumb, index, middle, ring and pinky from base to
 * tip). `side` 1 draws a right hand, −1 its mirror image. */
export function handPoints(pose: HandPose, side: 1 | -1 = 1): Point[] {
  const width = 1 - 0.55 * pose.turn;
  const local: Point[] = [{ x: 0, y: 0 }];
  for (let finger = 0; finger < 5; finger++) {
    const curl = pose.curl[finger];
    let { x, y } = BASES[finger];
    if (finger === 0) {
      // The thumb swings across the palm as it folds rather than bending in place.
      const direction = rad(FAN[0] * (1 - 1.35 * curl) - 6 * pose.spread);
      local.push({ x, y });
      let cumulative = 0;
      for (const length of LENGTHS[0]) {
        cumulative += curl * 34;
        const reach = length * (1 - 0.32 * curl);
        x += Math.sin(direction + rad(cumulative)) * reach;
        y -= Math.cos(direction + rad(cumulative)) * reach;
        local.push({ x, y });
      }
      continue;
    }
    // Seen from the front, a bending finger foreshortens and then folds back
    // over the palm; a slight lean toward the thumb keeps a fist readable.
    const direction = rad(FAN[finger] * (0.35 + pose.spread));
    local.push({ x, y });
    let flexion = 0;
    for (let joint = 0; joint < 2; joint++) {
      flexion += BEND[joint] * curl;
      const length = LENGTHS[finger][joint];
      const along = length * Math.cos(rad(flexion));
      const lean = -length * Math.sin(rad(flexion)) * 0.16;
      x += Math.sin(direction) * along + lean;
      y -= Math.cos(direction) * along;
      local.push({ x, y });
    }
    flexion += BEND[2] * curl;
    const length = LENGTHS[finger][2];
    x += Math.sin(direction) * length * Math.cos(rad(flexion)) - length * Math.sin(rad(flexion)) * 0.16;
    y -= Math.cos(direction) * length * Math.cos(rad(flexion));
    local.push({ x, y });
  }
  const cos = Math.cos(rad(pose.angle * side)), sin = Math.sin(rad(pose.angle * side));
  return local.map(({ x, y }) => {
    const px = x * width * side, py = y;
    return { x: pose.x + (px * cos - py * sin) * pose.scale, y: pose.y + (px * sin + py * cos) * pose.scale };
  });
}

/** Bone chains in tracker order, drawn as open polylines. */
export const HAND_CHAINS = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [0, 17, 18, 19, 20], [5, 9, 13, 17]];
export const FINGERTIPS = [4, 8, 12, 16, 20];

const fixed = (value: number) => Math.round(value * 10) / 10;
export function bonesPath(points: Point[]) {
  return HAND_CHAINS.map(chain => chain.map((index, i) => `${i ? "L" : "M"}${fixed(points[index].x)} ${fixed(points[index].y)}`).join("")).join("");
}
/** The palm between the tracked wrist, thumb base and knuckles, with a soft
 * curve along the knuckle line. */
export function palmPath(points: Point[]) {
  const [wrist, thumb, index, middle, ring, pinky] = [points[0], points[1], points[5], points[9], points[13], points[17]];
  const p = (point: Point) => `${fixed(point.x)} ${fixed(point.y)}`;
  return `M${p(wrist)}L${p(thumb)}L${p(index)}Q${p(middle)} ${p({ x: (middle.x + ring.x) / 2, y: (middle.y + ring.y) / 2 })}Q${p(ring)} ${p(pinky)}Z`;
}
/** Fingertips worth marking: a folded finger's tip is hidden in the fist. */
export function visibleTips(points: Point[], pose: HandPose) {
  return FINGERTIPS.filter((_, finger) => pose.curl[finger] < 0.45).map(index => points[index]);
}
/** Circles as one path, so a whole set of joints updates with one attribute. */
export function dotsPath(points: Point[], radius: number) {
  return points.map(({ x, y }) => `M${fixed(x - radius)} ${fixed(y)}a${radius} ${radius} 0 1 0 ${radius * 2} 0a${radius} ${radius} 0 1 0 ${-radius * 2} 0`).join("");
}
export function palmCentre(points: Point[]): Point {
  const ids = [0, 5, 9, 13, 17];
  return { x: ids.reduce((sum, i) => sum + points[i].x, 0) / 5, y: ids.reduce((sum, i) => sum + points[i].y, 0) / 5 };
}

const FLAT: HandPose["curl"] = [0.12, 0, 0, 0, 0];
const FIST: HandPose["curl"] = [0.85, 1, 1, 1, 1];
const A_HAND: HandPose["curl"] = [0.4, 1, 1, 1, 1];
const RELAXED: HandPose["curl"] = [0.35, 0.3, 0.36, 0.42, 0.48];
const base = (patch: Partial<HandPose>): HandPose => ({ x: 260, y: 200, angle: 0, turn: 0, scale: 58, curl: FLAT, spread: 0.1, opacity: 1, ...patch });
/** The resting non-dominant hand, low in the frame with a slow breath. */
const resting = (p: number): HandPose => base({ x: 116, y: 252 + Math.sin(p * Math.PI * 2) * 1.5, angle: -18, scale: 54, curl: RELAXED, opacity: 0.5, turn: 0.15 });

const ease = (t: number) => 0.5 - Math.cos(Math.PI * Math.min(1, Math.max(0, t))) / 2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function mixPose(a: HandPose, b: HandPose, t: number): HandPose {
  return {
    x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), angle: lerp(a.angle, b.angle, t), turn: lerp(a.turn, b.turn, t),
    scale: lerp(a.scale, b.scale, t), spread: lerp(a.spread, b.spread, t), opacity: lerp(a.opacity, b.opacity, t),
    curl: a.curl.map((value, i) => lerp(value, b.curl[i], t)) as HandPose["curl"],
  };
}

/** Illustrative movement for each demo word, as a function of progress 0–1.
 * These evoke the signs; they are not instructions for producing them. */
export const SIGN_MOTION: Record<string, (p: number) => Scene> = {
  // A flat hand moves out from the brow, like a salute.
  HELLO: p => ({ dominant: base({ x: lerp(232, 284, ease(p)), y: lerp(146, 158, ease(p)), angle: lerp(-26, 8, ease(p)), turn: 0.08 }), support: resting(p) }),
  // A flat hand moves forward and down from the chin.
  "THANK YOU": p => ({ dominant: base({ x: lerp(222, 254, ease(p)), y: lerp(168, 206, ease(p)), angle: lerp(-6, 30, ease(p)), turn: lerp(0.12, 0.42, ease(p)) }), support: resting(p) }),
  // An open hand circles on the chest.
  PLEASE: p => {
    const a = ease(p) * Math.PI * 2;
    return { dominant: base({ x: 226 + Math.sin(a) * 18, y: 226 - Math.cos(a) * 12 + 12, angle: -14 + Math.sin(a) * 6, turn: 0.32 }), support: resting(p) };
  },
  // A closed hand, thumb up, circles on the chest.
  SORRY: p => {
    const a = ease(p) * Math.PI * 2;
    return { dominant: base({ x: 226 + Math.sin(a) * 16, y: 232 - Math.cos(a) * 11 + 11, angle: -6, curl: A_HAND, spread: 0, scale: 56, turn: 0.18 }), support: resting(p) };
  },
  // A fist nods twice.
  YES: p => ({ dominant: base({ x: 262, y: 192 + Math.abs(Math.sin(p * Math.PI * 2)) * 12, angle: Math.sin(p * Math.PI * 2) * 12, curl: FIST, spread: 0, scale: 56 }), support: resting(p) }),
  // Index and middle fingers close onto the thumb, twice.
  NO: p => {
    const pinch = Math.abs(Math.sin(p * Math.PI * 2));
    return { dominant: base({ x: 262, y: 184, angle: -10 + pinch * 6, curl: [0.3 + pinch * 0.35, pinch * 0.5, pinch * 0.5, 1, 1], spread: 0.15 }), support: resting(p) };
  },
  // Movement that does not settle into any known sign: nothing is added.
  "—": p => ({
    dominant: base({ x: 250 + Math.sin(p * Math.PI * 1.5) * 20, y: 210 - Math.sin(p * Math.PI) * 22, angle: lerp(-20, 16, p), curl: RELAXED, spread: 0.4, turn: 0.22 }),
    support: base({ x: lerp(116, 150, Math.sin(p * Math.PI)), y: lerp(252, 222, Math.sin(p * Math.PI)), angle: -18, scale: 54, curl: RELAXED, opacity: lerp(0.5, 0.85, Math.sin(p * Math.PI)), turn: 0.15 }),
  }),
};

// An illustration, not a recording or a live result: it only uses the six
// demo words, shows no invented confidence figures, and includes the
// no-match outcome the real recognizer gives when it is unsure.
export const DEMO_SEQUENCE = [
  { sign: "HELLO", translation: "Hello", confirmed: true },
  { sign: "THANK YOU", translation: "Thank you", confirmed: true },
  { sign: "—", translation: "No confident match", confirmed: false },
  { sign: "PLEASE", translation: "Please", confirmed: true },
  { sign: "YES", translation: "Yes", confirmed: true },
  { sign: "SORRY", translation: "Sorry", confirmed: true },
  { sign: "NO", translation: "No", confirmed: true },
] as const;

/** Milliseconds: move into the sign, perform it, then show the outcome. */
export const TIMING = { transition: 700, perform: 1800, hold: 1300 } as const;
export const STEP_MS = TIMING.transition + TIMING.perform + TIMING.hold;
export const LOOP_MS = STEP_MS * DEMO_SEQUENCE.length;

export type Phase = "watching" | "checking" | "result";
export type Frame = { index: number; phase: Phase; scene: Scene; pulse: number };

/** The whole illustration at one moment of its loop. */
export function frameAt(ms: number): Frame {
  const t = ((ms % LOOP_MS) + LOOP_MS) % LOOP_MS;
  const index = Math.floor(t / STEP_MS);
  const local = t - index * STEP_MS;
  const motion = SIGN_MOTION[DEMO_SEQUENCE[index].sign];
  const previous = SIGN_MOTION[DEMO_SEQUENCE[(index + DEMO_SEQUENCE.length - 1) % DEMO_SEQUENCE.length].sign];
  let scene: Scene;
  if (local < TIMING.transition) {
    const from = previous(1), to = motion(0), k = ease(local / TIMING.transition);
    scene = { dominant: mixPose(from.dominant, to.dominant, k), support: mixPose(from.support, to.support, k) };
  } else {
    scene = motion(Math.min(1, (local - TIMING.transition) / TIMING.perform));
  }
  const performed = local - TIMING.transition;
  const phase: Phase = performed < TIMING.perform * 0.45 ? "watching" : performed < TIMING.perform ? "checking" : "result";
  const pulse = phase === "result" && DEMO_SEQUENCE[index].confirmed ? Math.min(1, (performed - TIMING.perform) / 900) : 0;
  return { index, phase, scene, pulse };
}

/** The still picture shown when motion is reduced. */
export const STILL_FRAME: Frame = { index: 0, phase: "result", scene: SIGN_MOTION.HELLO(1), pulse: 0 };
