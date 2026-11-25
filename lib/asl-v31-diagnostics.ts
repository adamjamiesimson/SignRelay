import { ASL_V31_POLICY } from "./asl-v31-assets.mjs";
import { MAX_SEGMENT_MS } from "./asl-v31-segmenter";

/** Live V3.1 pipeline diagnostics, shown only in the developer/performance view (`?perf`).
 * Counts and the latest decision summary stay in memory on this device: nothing here is
 * uploaded or persisted, and no camera image or landmark data is included. */

export type AslV31DecisionStatus = "accepted" | "uncertain" | "unknown" | "too-few-hands";

export type AslV31Decision = {
  status: AslV31DecisionStatus;
  best: string;
  top3: { label: string; p: number }[];
  pTop1: number;
  pUnknown: number;
  proto: number | null;
  handFrames: number;
  /** Why the gate rejected the segment, in words a tester can act on; empty when accepted. */
  reason: string;
};

type Policy = { max_unknown: number; min_top1: number; min_margin: number | null; min_proto: number; min_hand_frames: number };

/** Explain a V3.1 policy decision with the same order of checks as engine-v3/web/decision.mjs. */
export function describeDecision(input: {
  status: string; best: string; top5: { label: string; p: number }[];
  scores: { p_top1: number; margin: number; p_unknown: number; proto_cos: number | null };
}, policy: Policy, handFrames: number): AslV31Decision {
  const { p_top1: pTop1, margin, p_unknown: pUnknown, proto_cos: proto } = input.scores;
  const fixed = (value: number) => value.toFixed(2);
  let status = input.status as AslV31DecisionStatus;
  let reason = "";
  if (handFrames < policy.min_hand_frames) {
    status = "too-few-hands";
    reason = `only ${handFrames} hand frame${handFrames === 1 ? "" : "s"} in the sign (needs ${policy.min_hand_frames})`;
  } else if (status === "unknown" && pUnknown >= policy.max_unknown) {
    reason = `looks like an unsupported sign (unknown score ${fixed(pUnknown)} ≥ ${fixed(policy.max_unknown)})`;
  } else if (status === "uncertain" && pTop1 < policy.min_top1) {
    reason = `not confident (top score ${fixed(pTop1)} < ${fixed(policy.min_top1)})`;
  } else if (status === "uncertain") {
    reason = `two signs too close (margin ${fixed(margin)} < ${fixed(policy.min_margin ?? 0)})`;
  } else if (status === "unknown") {
    reason = `unlike training examples of ${input.best} (similarity ${fixed(proto ?? 0)} < ${fixed(policy.min_proto)})`;
  }
  return { status, best: input.best, top3: input.top5.slice(0, 3), pTop1, pUnknown, proto, handFrames, reason };
}

export type AslV31Diagnostics = {
  observations: number;
  handFrames: number;
  shoulderFrames: number;
  segmentsOpened: number;
  segmentsCompleted: number;
  segmentsCapped: number;
  segmentsTooFewHands: number;
  /** Completed segments replaced by a newer one or too old by the time the model was free. */
  segmentsSkipped: number;
  model: "not-started" | "loading" | "ready" | "failed";
  modelError: string;
  inferences: number;
  inferenceFailures: number;
  lastInferenceMs: number | null;
  decisions: Record<AslV31DecisionStatus, number>;
  suggestionsPosted: number;
  /** Signs confirmed from the signer's own taught examples rather than the 523-class head. */
  personalMatches: number;
  /** Accepted results discarded because the next movement had already moved on. */
  suggestionsStale: number;
  lastDecision: (AslV31Decision & { ageMs: number }) | null;
};

export function emptyAslV31Diagnostics(): AslV31Diagnostics {
  return { observations: 0, handFrames: 0, shoulderFrames: 0, segmentsOpened: 0, segmentsCompleted: 0, segmentsCapped: 0,
    segmentsTooFewHands: 0, segmentsSkipped: 0, model: "not-started", modelError: "", inferences: 0, inferenceFailures: 0,
    lastInferenceMs: null, decisions: { accepted: 0, uncertain: 0, unknown: 0, "too-few-hands": 0 },
    suggestionsPosted: 0, suggestionsStale: 0, personalMatches: 0, lastDecision: null };
}

/** What the page did with the worker's suggestions (counted on the main thread). */
export type AslV31UiCounts = { received: number; ignored: number; shown: number; added: number; spoken: number };

/** The first stage that is not working, phrased as one thing the tester can do. */
export function aslV31Hint(d: AslV31Diagnostics, ui: AslV31UiCounts, trackedFrames: number): string {
  if (d.model === "failed") return `Model failed to start: ${d.modelError || "unknown error"}. Reload the page.`;
  if (trackedFrames === 0 || d.observations === 0) return "No camera frames have reached recognition yet.";
  if (d.handFrames === 0) return "No hands detected. Add light in front of you and keep both hands inside the picture.";
  if (d.segmentsOpened === 0) return d.shoulderFrames === 0
    ? "No sign started. Shoulders are not in view, so a sign starts when your hand moves: sign normally, then pause."
    : "No sign started. Raise your signing hand to chest height to begin a sign.";
  if (d.segmentsCompleted === 0 && d.segmentsTooFewHands === 0) {
    if (d.shoulderFrames === 0) return "Signs never finish and shoulders are not visible, so a sign ends only when the hand stops moving or leaves the picture. Pause after each sign, or sit back so both shoulders are in view.";
    return d.segmentsCapped ? "Signs run together. After each sign, lower your hands below your chest for half a second."
      : "A sign is in progress. Lower your hands below your chest for half a second to finish it.";
  }
  if (d.segmentsCompleted === 0) return "Signs were too short to track. Sign a little more slowly with your hand facing the camera.";
  if (d.model !== "ready" && d.inferences === 0) return "Recognition model is still loading.";
  if (d.inferences === 0) return "Completed signs are waiting for the model.";
  if (d.decisions.accepted === 0) {
    const last = d.lastDecision;
    // The gate name is read from the shipped policy, not written into the copy: the panel said
    // "Strict" for a week while the app shipped policy-demo, which sent the next reader hunting
    // for a threshold that was not the one rejecting the sign.
    return last ? `The model ran ${d.inferences}× but ${ASL_V31_POLICY} rejected every sign. Last: ${last.reason}.`
      : `The model ran ${d.inferences}× but ${ASL_V31_POLICY} rejected every sign.`;
  }
  if (ui.received < d.suggestionsPosted) return "Some suggestions did not reach the page (tab hidden or camera stopped).";
  if (ui.received > ui.shown + ui.ignored) return "A suggestion arrived but was not displayed.";
  return "Pipeline healthy. Accepted suggestions need “Add to transcript” before they are added or spoken.";
}

export function formatAslV31Diagnostics(d: AslV31Diagnostics, ui: AslV31UiCounts, trackedFrames: number, delegate: string | null) {
  const last = d.lastDecision;
  const lastLine = last
    ? `Last decision ${(last.ageMs / 1000).toFixed(0)} s ago: ${last.status}${last.reason ? ` — ${last.reason}` : ""}. `
      + `Top: ${last.top3.map(item => `${item.label} ${item.p.toFixed(2)}`).join(", ")}`
    : "No model decision yet.";
  return [
    `Tracking ${trackedFrames} frames (${delegate ?? "?"}) · to recognizer ${d.observations} · hands ${d.handFrames} · shoulders ${d.shoulderFrames}`,
    `Signs started ${d.segmentsOpened} · completed ${d.segmentsCompleted} · capped at ${MAX_SEGMENT_MS / 1000} s ${d.segmentsCapped} · too short ${d.segmentsTooFewHands} · skipped ${d.segmentsSkipped}`,
    `Model ${d.model}${d.modelError ? ` (${d.modelError})` : ""} · runs ${d.inferences}${d.lastInferenceMs === null ? "" : ` (${d.lastInferenceMs.toFixed(0)} ms)`} · failures ${d.inferenceFailures}`,
    `Gate ${ASL_V31_POLICY}: accepted ${d.decisions.accepted} · uncertain ${d.decisions.uncertain} · unknown ${d.decisions.unknown} · too few hands ${d.decisions["too-few-hands"]}`,
    `Suggestions sent ${d.suggestionsPosted} · taught-sign matches ${d.personalMatches} · stale ${d.suggestionsStale} · received ${ui.received} · shown ${ui.shown} · added ${ui.added} · spoken ${ui.spoken}`,
    lastLine,
    `Next step: ${aslV31Hint(d, ui, trackedFrames)}`,
  ];
}
