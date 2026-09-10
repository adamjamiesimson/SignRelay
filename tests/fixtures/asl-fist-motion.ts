import type { Point } from "../../lib/vision-types";
import { handshape, makeSign } from "./asl-motion";

export type FistMotion = "nod" | "bob" | "close" | "point-bob" | "sorry" | "tilt" | "sideways";

/** Constructed counterexamples and wrist-flexion examples, not signer recordings. */
export function makeFistMotion(kind: FistMotion, options: Parameters<typeof makeSign>[1] & {
  radiusX?: number; radiusY?: number; startAngle?: number; clockwise?: boolean;
  pitchChange?: number;
} = {}) {
  const { scale = 1, shiftY = 0, side = "Right", jitter = 0,
    radiusX = 0.06, radiusY = 0.06, startAngle = 0, clockwise = true, pitchChange = 0.8 } = options;
  const frames = makeSign("IDLE", { duration: 1600, count: 33, ...options });
  return frames.map((frame, index) => {
    const phase = Math.min(1, index / (frames.length - 1) / 0.75);
    const bump = Math.sin(Math.PI * phase) ** 2;
    const angle = startAngle + (clockwise ? 1 : -1) * phase * Math.PI * 2;
    let x = 0.6;
    let y = 0.6;
    if (kind === "bob" || kind === "point-bob") y += 0.065 * Math.sin(phase * Math.PI * 2);
    if (kind === "close") y += 0.065 * Math.sin(phase * Math.PI);
    if (kind === "sorry") { x = 0.5 + radiusX * Math.cos(angle); y = 0.65 + radiusY * Math.sin(angle); }
    const closure = kind === "close" ? Math.min(1, phase / 0.18) : 1;
    const open = handshape("open");
    const points = handshape("fist").map((point, i): Point => ({
      x: point.x, y: open[i].y + (point.y - open[i].y) * closure, z: point.z,
    }));
    if (kind === "point-bob") for (const i of [6, 7, 8]) points[i] = open[i];
    const pitch = 0.15 + (kind === "nod" ? pitchChange * bump : kind === "tilt" ? pitchChange * phase : 0);
    const roll = kind === "sideways" ? 0.8 * bump : 0;
    frame.hands[0].landmarks = points.map((point, i) => {
      const py = point.y * Math.cos(pitch);
      const px = point.x * Math.cos(roll) - py * Math.sin(roll);
      const ry = point.x * Math.sin(roll) + py * Math.cos(roll);
      return {
        x: 0.5 + (x + px - 0.5 + jitter * Math.sin(index * 1.7 + i)) * scale * (side === "Left" ? -1 : 1),
        y: 0.5 + (y + ry - 0.5 + jitter * Math.cos(index * 1.3 + i)) * scale + shiftY,
        z: point.y * Math.sin(pitch) * scale,
      };
    });
    return frame;
  });
}
