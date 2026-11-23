import { makeSign } from "./asl-motion";

/** Constructed counterexample: a near-chest arc with an outward suffix.
 * Not a recording, label annotation, or evidence of real-world accuracy. */
export function incompleteArcWithOutwardSuffix() {
  const frames = makeSign("PLEASE", { duration: 1500, count: 37 });
  frames.forEach((frame, index) => {
    const wrist = { ...frame.hands[0].landmarks[0] };
    const angle = Math.min(1, index / 36 / 0.75) * 2 * Math.PI + 2.5;
    for (const point of frame.hands[0].landmarks) {
      point.x += 0.5 + 0.06 * Math.cos(angle) - wrist.x;
      point.y += 0.6 + 0.06 * Math.sin(angle) - wrist.y;
    }
  });
  return frames.slice(0, 24);
}
