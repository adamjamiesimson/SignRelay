import type { VisionFrame } from "./vision-types";

/** Non-identifying counters for a human-labelled, single-hand experiment.
 * Pose agreement is a consistency check, not independent anatomical truth.
 * Never rewrites labels or stores coordinates.
 */
export function diagnoseHandedness(frame: VisionFrame, expected: "Left" | "Right" | "Unknown") {
  return frame.hands.map(hand => {
    const wrist = hand.landmarks[0];
    const pose = (["Left", "Right"] as const).map((side, i) => {
      const point = frame.pose[i ? 16 : 15];
      const distance = wrist && point && (point.visibility ?? 1) >= 0.5
        ? Math.hypot(wrist.x - point.x, wrist.y - point.y) : Infinity;
      return { side, distance };
    }).sort((a, b) => a.distance - b.distance);
    const nearestPose = Number.isFinite(pose[0].distance) && pose[1].distance - pose[0].distance > 0.02 ? pose[0].side : "Unknown";
    const side = hand.handedness;
    return { taskLabel: side, expected, agreesWithHuman: expected === "Unknown" ? null : side === expected,
      nearestPose, agreesWithPose: nearestPose === "Unknown" ? null : side === nearestPose,
      aslNodes: side === "Left" ? "13–33" : side === "Right" ? "34–54" : "unassigned",
      bslNodes: side === "Left" ? "18–38" : side === "Right" ? "39–59" : "unassigned" };
  });
}
