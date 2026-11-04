// Research feature extractor for a temporal isolated-sign recognizer that is
// meant to replace the geometry-only ASL starter rules
// (docs/research/temporal-recognizer/DIRECTION.md). Not used by the app.
//
// Every frame becomes named channels in body-relative units (shoulder widths
// from the shoulder midpoint, y downwards). The dominant hand is the one that
// moves more; a left-dominant signer is mirrored so both hands share one model.
// Channel groups:
//   handshape  finger extension (5), thumb-index aperture, spread, palm facing (3)  - angles/ratios, mirror-safe
//   location   wrist and index tip (x, y), distances to forehead, eyes, mouth, chest - body-relative
//   motion     wrist velocity (x, y) and speed in shoulder widths per second
//   twoHand    other hand present, inter-wrist distance and offset, symmetry of motion
// plus sequence-level segmentation (main active span) and repetition measures.
import type { HandObservation, Point, VisionFrame } from "./vision-types";

export const CHANNEL_GROUPS = {
  handshape: ["ext_thumb", "ext_index", "ext_middle", "ext_ring", "ext_pinky", "aperture", "spread", "palm_x", "palm_y", "palm_z"],
  location: ["wrist_x", "wrist_y", "tip_x", "tip_y", "d_forehead", "d_eyes", "d_mouth", "d_chest"],
  motion: ["vel_x", "vel_y", "speed"],
  twoHand: ["other_present", "hands_dist", "hands_dx", "hands_dy", "mirror_motion"],
} as const;
export type ChannelGroup = keyof typeof CHANNEL_GROUPS;
export const CHANNELS: readonly string[] = Object.values(CHANNEL_GROUPS).flat();
export const CHANNEL_INDEX: Record<string, number> = Object.fromEntries(CHANNELS.map((name, i) => [name, i]));

type Body = { cx: number; cy: number; scale: number; forehead: Point; eyes: Point; mouth: Point; chest: Point };
const finite = (p: Point | undefined): p is Point => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const validHand = (h: HandObservation | undefined): h is HandObservation => !!h && h.landmarks.length === 21 && h.landmarks.every(finite);

/** Body reference from the pose; null when shoulders are not tracked (the frame then carries the last body). */
export function bodyOf(frame: VisionFrame): Body | null {
  const l = frame.pose[11], r = frame.pose[12];
  if (!finite(l) || !finite(r) || (l.visibility ?? 1) < 0.4 || (r.visibility ?? 1) < 0.4) return null;
  const cx = (l.x + r.x) / 2, cy = (l.y + r.y) / 2, scale = Math.max(dist(l, r), 0.05);
  const nose = finite(frame.pose[0]) ? frame.pose[0] : { x: cx, y: cy - 0.75 * scale, z: 0 };
  const eyes = finite(frame.pose[2]) && finite(frame.pose[5]) ? { x: (frame.pose[2].x + frame.pose[5].x) / 2, y: (frame.pose[2].y + frame.pose[5].y) / 2, z: 0 }
    : { x: nose.x, y: nose.y - 0.12 * scale, z: 0 };
  const mouth = finite(frame.pose[9]) && finite(frame.pose[10]) ? { x: (frame.pose[9].x + frame.pose[10].x) / 2, y: (frame.pose[9].y + frame.pose[10].y) / 2, z: 0 }
    : { x: nose.x, y: nose.y + 0.15 * scale, z: 0 };
  return { cx, cy, scale, eyes, mouth, forehead: { x: eyes.x, y: eyes.y - 0.3 * scale, z: 0 }, chest: { x: cx, y: cy + 0.45 * scale, z: 0 } };
}

/** Finger extension in [0, 1]: tip distance from the wrist relative to the finger's full length. */
function extension(p: Point[], mcp: number, tip: number) {
  const full = dist(p[mcp], p[mcp + 1]) + dist(p[mcp + 1], p[mcp + 2]) + dist(p[mcp + 2], p[tip]);
  const reach = dist(p[0], p[tip]) - dist(p[0], p[mcp]);
  return Math.max(0, Math.min(1, full > 1e-6 ? reach / full : 0));
}

export function handshapeOf(hand: HandObservation): number[] {
  const p = hand.landmarks;
  const palm = Math.max(dist(p[0], p[9]), 1e-4);
  // Palm normal from wrist->index MCP x wrist->pinky MCP (MediaPipe z is relative depth).
  const a = { x: p[5].x - p[0].x, y: p[5].y - p[0].y, z: p[5].z - p[0].z }, b = { x: p[17].x - p[0].x, y: p[17].y - p[0].y, z: p[17].z - p[0].z };
  let n = { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
  const norm = Math.hypot(n.x, n.y, n.z) || 1;
  n = { x: n.x / norm, y: n.y / norm, z: n.z / norm };
  // A left hand is the mirror image of a right hand. Mirroring x in a and b
  // turns the cross product (x, y, z) into (x, -y, -z), so a left hand's normal
  // is mapped back onto the right-hand layout by negating y and z.
  if (hand.handedness === "Left") n = { x: n.x, y: -n.y, z: -n.z };
  return [extension(p, 1, 4), extension(p, 5, 8), extension(p, 9, 12), extension(p, 13, 16), extension(p, 17, 20),
    dist(p[4], p[8]) / palm, dist(p[8], p[20]) / Math.max(dist(p[5], p[17]), 1e-4), n.x, n.y, n.z];
}

/** Which hand label moves more over the sequence (ties: Right). */
export function dominantLabel(frames: VisionFrame[]): "Left" | "Right" {
  const travel = { Left: 0, Right: 0 };
  const last: Partial<Record<"Left" | "Right", Point>> = {};
  for (const frame of frames) for (const hand of frame.hands) {
    if (!validHand(hand) || hand.handedness === "Unknown") continue;
    const label = hand.handedness, w = hand.landmarks[0];
    if (last[label]) travel[label] += dist(last[label]!, w);
    last[label] = w;
  }
  return travel.Left > travel.Right ? "Left" : "Right";
}

export type FeatureSequence = {
  /** One row of CHANNELS per frame that had the dominant hand. */
  rows: number[][];
  times: number[];
  dominant: "Left" | "Right";
  mirrored: boolean;
  /** Frames dropped: no dominant hand or never any body reference. */
  missing: number;
};

/** Per-frame channels. Frames without the dominant hand are skipped (not zero-filled). */
export function extractFeatures(frames: VisionFrame[]): FeatureSequence {
  const dominant = dominantLabel(frames);
  // MediaPipe labels the hand as seen in an unmirrored image; a right-dominant
  // signer's hand is labelled "Right" in this pipeline (lib/hand-continuity).
  // Left-dominant signing is mirrored onto the right-handed layout.
  const mirrored = dominant === "Left";
  const sx = mirrored ? -1 : 1;
  const rows: number[][] = [], times: number[] = [];
  let body: Body | null = null, prev: { t: number; x: number; y: number; ox?: number; oy?: number } | null = null, missing = 0;
  for (const frame of frames) {
    body = bodyOf(frame) ?? body;
    const hand = frame.hands.find(h => validHand(h) && h.handedness === dominant) ?? (frame.hands.length === 1 && validHand(frame.hands[0]) ? frame.hands[0] : undefined);
    if (!hand || !body) { missing++; continue; }
    const other = frame.hands.find(h => h !== hand && validHand(h));
    const rel = (p: Point) => ({ x: sx * (p.x - body!.cx) / body!.scale, y: (p.y - body!.cy) / body!.scale });
    const w = rel(hand.landmarks[0]), tip = rel(hand.landmarks[8]);
    const d = (anchor: Point) => dist(hand.landmarks[8], anchor) / body!.scale;
    const dt = prev ? Math.max((frame.timestamp - prev.t) / 1000, 1e-3) : 0;
    const vx = prev ? (w.x - prev.x) / dt : 0, vy = prev ? (w.y - prev.y) / dt : 0;
    const o = other ? rel(other.landmarks[0]) : null;
    let mirrorMotion = 0;
    if (o && prev && prev.ox !== undefined) {
      const ovx = (o.x - prev.ox) / dt, ovy = (o.y - prev.oy!) / dt;
      const dot = (-ovx) * vx + ovy * vy, mag = Math.hypot(vx, vy) * Math.hypot(ovx, ovy);
      mirrorMotion = mag > 1e-6 ? dot / mag : 0; // 1 = mirror-symmetric motion, -1 = opposite
    }
    rows.push([...handshapeOf(hand), w.x, w.y, tip.x, tip.y, d(body.forehead), d(body.eyes), d(body.mouth), d(body.chest),
      vx, vy, Math.hypot(vx, vy), o ? 1 : 0, o ? Math.hypot(o.x - w.x, o.y - w.y) : 0, o ? o.x - w.x : 0, o ? o.y - w.y : 0, mirrorMotion]);
    times.push(frame.timestamp);
    prev = { t: frame.timestamp, x: w.x, y: w.y, ox: o?.x, oy: o?.y };
  }
  return { rows, times, dominant, mirrored, missing };
}

/** The main active span: frames whose smoothed speed exceeds a fraction of the
 * clip's peak, extended by a short margin, choosing the span with most motion.
 * Returns [start, end) indices into rows, or null when nothing moves. */
export function segmentActive(seq: FeatureSequence, { threshold = 0.25, marginMs = 150 } = {}): [number, number] | null {
  const speed = seq.rows.map(r => r[CHANNEL_INDEX.speed]);
  if (speed.length < 3) return null;
  const smooth = speed.map((_, i) => (speed[Math.max(0, i - 1)] + speed[i] + speed[Math.min(speed.length - 1, i + 1)]) / 3);
  const peak = Math.max(...smooth);
  if (!(peak > 0.05)) return null;
  const spans: [number, number, number][] = [];
  let start = -1, energy = 0;
  smooth.forEach((v, i) => {
    if (v >= threshold * peak) { if (start < 0) { start = i; energy = 0; } energy += v; }
    else if (start >= 0) { spans.push([start, i, energy]); start = -1; }
  });
  if (start >= 0) spans.push([start, smooth.length, energy]);
  // Spans separated by less than the margin are one movement.
  const merged: [number, number, number][] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && seq.times[span[0]] - seq.times[last[1] - 1] <= 2 * marginMs) { last[1] = span[1]; last[2] += span[2]; }
    else merged.push([...span]);
  }
  const best = merged.reduce((a, b) => (b[2] > a[2] ? b : a));
  let [s, e] = best;
  while (s > 0 && seq.times[best[0]] - seq.times[s - 1] <= marginMs) s--;
  while (e < seq.rows.length && seq.times[e] - seq.times[best[1] - 1] <= marginMs) e++;
  return [s, e];
}

/** Repetition: direction reversals along the main axis of wrist travel, and the
 * normalised autocorrelation peak of the velocity (cyclic movements score high). */
export function repetitionOf(rows: number[][]) {
  const vx = rows.map(r => r[CHANNEL_INDEX.vel_x]), vy = rows.map(r => r[CHANNEL_INDEX.vel_y]);
  const sxx = vx.reduce((s, v) => s + v * v, 0), syy = vy.reduce((s, v) => s + v * v, 0), sxy = vx.reduce((s, v, i) => s + v * vy[i], 0);
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const along = vx.map((v, i) => v * Math.cos(angle) + vy[i] * Math.sin(angle));
  let reversals = 0, sign = 0;
  for (const v of along) { const s = Math.abs(v) < 0.15 ? 0 : Math.sign(v); if (s && sign && s !== sign) reversals++; if (s) sign = s; }
  const energy = sxx + syy;
  let peak = 0;
  for (let lag = 2; lag < Math.floor(rows.length / 2); lag++) {
    let c = 0;
    for (let i = 0; i + lag < rows.length; i++) c += vx[i] * vx[i + lag] + vy[i] * vy[i + lag];
    peak = Math.max(peak, energy > 1e-9 ? c / energy : 0);
  }
  return { reversals, autocorrelation: peak };
}

/** Linear resampling of rows to a fixed length. */
export function resample(rows: number[][], length: number): number[][] {
  if (!rows.length) return [];
  if (rows.length === 1) return Array.from({ length }, () => [...rows[0]]);
  return Array.from({ length }, (_, i) => {
    const at = (i * (rows.length - 1)) / (length - 1), lo = Math.floor(at), hi = Math.min(rows.length - 1, lo + 1), f = at - lo;
    return rows[lo].map((v, c) => v + (rows[hi][c] - v) * f);
  });
}
