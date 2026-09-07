import type { HandObservation, Point, VisionFrame } from "../../lib/vision-types";

export type Sign = "HELLO" | "NO" | "YES" | "PLEASE" | "SORRY" | "THANK YOU" | "IDLE";

/** Kinematic regression fixtures, not recordings or a sign-accuracy benchmark. */
export function handshape(shape: "open" | "fist" | "no", closure = 0): Point[] {
  const points = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  points[1] = { x: 0.035, y: -0.018, z: 0 };
  points[2] = { x: 0.04, y: -0.04, z: 0 };
  points[3] = { x: 0.036, y: -0.068, z: 0 };
  points[4] = { x: 0.02, y: -0.085, z: 0 };
  for (let finger = 0; finger < 4; finger++) {
    const mcp = 5 + finger * 4;
    const x = -0.035 + finger * 0.024;
    const folded = shape === "fist" || (shape === "no" && finger >= 2);
    points[mcp] = { x, y: -0.065, z: 0 };
    points[mcp + 1] = { x, y: -0.105, z: 0 };
    points[mcp + 2] = { x, y: folded ? -0.083 : -0.145, z: 0 };
    points[mcp + 3] = { x, y: folded ? -0.063 : -0.18, z: 0 };
    if (shape === "no" && finger < 2) {
      points[mcp + 3].x += (0.022 - x) * closure;
      points[mcp + 3].y += 0.093 * closure;
    }
  }
  return points;
}

export function makeSign(sign: Sign, options: {
  duration?: number; count?: number; side?: HandObservation["handedness"];
  scale?: number; shiftY?: number; jitter?: number;
} = {}): VisionFrame[] {
  const { duration = 900, count = 21, side = "Right", scale = 1, shiftY = 0, jitter = 0 } = options;
  return Array.from({ length: count }, (_, index) => {
    const phase = Math.min(1, (index / (count - 1)) / 0.75);
    const angle = phase * 2 * Math.PI;
    let x = 0.6;
    let y = 0.38;
    if (sign === "HELLO") x += 0.13 * Math.sin(angle);
    if (sign === "NO") { x = 0.64; y = 0.53; }
    if (sign === "YES") { x = 0.64; y = 0.53 + 0.065 * Math.sin(angle); }
    if (sign === "PLEASE" || sign === "SORRY") { x = 0.5 + 0.06 * Math.cos(angle); y = 0.65 + 0.06 * Math.sin(angle); }
    if (sign === "THANK YOU") { x = 0.53 + 0.11 * phase; y = 0.5 + 0.14 * phase; }
    const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.6, z: 0, visibility: 1 }));
    pose[0] = { x: 0.5, y: 0.27, z: 0, visibility: 1 };
    pose[9] = { x: 0.5, y: 0.32, z: 0, visibility: 1 };
    pose[11] = { x: 0.35, y: 0.48, z: 0, visibility: 1 };
    pose[12] = { x: 0.65, y: 0.48, z: 0, visibility: 1 };
    const face = Array.from({ length: 20 }, () => ({ x: 0.5, y: 0.27, z: 0 }));
    face[3] = { x: 0.5, y: 0.32, z: 0 };
    const transform = (point: Point): Point => ({ ...point,
      x: 0.5 + (point.x - 0.5) * scale * (side === "Left" ? -1 : 1),
      y: 0.5 + (point.y - 0.5) * scale + shiftY, z: point.z * scale,
    });
    const landmarks = handshape(sign === "NO" ? "no" : sign === "YES" || sign === "SORRY" ? "fist" : "open", phase)
      .map((point, pointIndex) => transform({ x: x + point.x + jitter * Math.sin(index * 1.7 + pointIndex),
        y: y + point.y + jitter * Math.cos(index * 1.3 + pointIndex), z: point.z }));
    return { timestamp: 1000 + duration * index / (count - 1),
      hands: [{ landmarks, handedness: side, gesture: "None", gestureScore: 0 }],
      pose: pose.map(transform), face: face.map(transform) };
  });
}
