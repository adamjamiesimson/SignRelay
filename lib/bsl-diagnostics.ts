/** Live BSL pipeline diagnostics, shown only in the developer/performance view (`?perf`).
 * Counts and the latest decision summary stay in memory on this device: nothing here is
 * uploaded or persisted, and no camera image or landmark data is included. */

export type BslDecisionStatus = "accepted" | "uncertain" | "too-few-hands" | "no-movement";

export type BslDecision = {
  status: BslDecisionStatus;
  best: string;
  top5: { label: string; p: number }[];
  pTop1: number;
  margin: number;
  /** Model windows evaluated for this sign (16 frames at 25 fps, stride 8). */
  windows: number;
  /** Resampled 25 fps frames in the selected sign span. */
  spanFrames: number;
  handFrames: number;
  /** Observed frames where the anatomical wrist assignment overruled the Tasks hand label. */
  slotDisagreements: number;
  inferenceMs: number;
  reason: string;
};

export type BslPolicy = { minTop1: number; minMargin: number; minHandFrames: number };

export function describeBslDecision(input: Omit<BslDecision, "status" | "reason">, policy: BslPolicy): BslDecision {
  const fixed = (value: number) => value.toFixed(2);
  let status: BslDecisionStatus = "accepted", reason = "";
  if (input.windows === 0) { status = "no-movement"; reason = "no complete 16-frame sign window"; }
  else if (input.handFrames < policy.minHandFrames) {
    status = "too-few-hands";
    reason = `only ${input.handFrames} hand frame${input.handFrames === 1 ? "" : "s"} in the sign (needs ${policy.minHandFrames})`;
  } else if (input.pTop1 < policy.minTop1) {
    status = "uncertain"; reason = `not confident (top score ${fixed(input.pTop1)} < ${fixed(policy.minTop1)})`;
  } else if (input.margin < policy.minMargin) {
    status = "uncertain"; reason = `two signs too close (margin ${fixed(input.margin)} < ${fixed(policy.minMargin)})`;
  }
  return { ...input, status, reason };
}

export type BslDiagnostics = {
  engine: "legacy" | "v2";
  observations: number;
  handFrames: number;
  shoulderFrames: number;
  /** Completed movements handed to the model (one per sign in v2). */
  signsCompleted: number;
  /** Completed movements dropped because the model was still busy with an older one. */
  signsSkipped: number;
  model: "not-started" | "loading" | "ready" | "failed";
  modelError: string;
  inferences: number;
  inferenceFailures: number;
  lastInferenceMs: number | null;
  decisions: Record<BslDecisionStatus, number>;
  suggestionsPosted: number;
  suggestionsStale: number;
  /** Repeated suggestions of the same sign inside the cooldown, suppressed. */
  duplicatesSuppressed: number;
  lastDecision: (BslDecision & { ageMs: number }) | null;
};

export function emptyBslDiagnostics(engine: BslDiagnostics["engine"] = "v2"): BslDiagnostics {
  return { engine, observations: 0, handFrames: 0, shoulderFrames: 0, signsCompleted: 0, signsSkipped: 0,
    model: "not-started", modelError: "", inferences: 0, inferenceFailures: 0, lastInferenceMs: null,
    decisions: { accepted: 0, uncertain: 0, "too-few-hands": 0, "no-movement": 0 },
    suggestionsPosted: 0, suggestionsStale: 0, duplicatesSuppressed: 0, lastDecision: null };
}

export type BslUiCounts = { received: number; ignored: number; shown: number; added: number; spoken: number };

export function bslHint(d: BslDiagnostics, ui: BslUiCounts, trackedFrames: number): string {
  if (d.model === "failed") return `BSL model failed to start: ${d.modelError || "unknown error"}. Reload the page.`;
  if (trackedFrames === 0 || d.observations === 0) return "No camera frames have reached recognition yet.";
  if (d.handFrames === 0) return "No hands detected. Add light in front of you and keep both hands inside the picture.";
  if (d.shoulderFrames === 0) return "Shoulders are not visible. Sit back so your head, both shoulders and elbows are in view.";
  if (d.signsCompleted === 0) return "No completed sign yet. Make one sign, then hold your hands still for half a second.";
  if (d.model !== "ready" && d.inferences === 0) return "BSL model is still loading.";
  if (d.inferences === 0) return "Completed signs are waiting for the model.";
  if (d.decisions.accepted === 0) {
    const last = d.lastDecision;
    return last ? `The model ran ${d.inferences}× but rejected every sign. Last: ${last.reason}.`
      : `The model ran ${d.inferences}× but rejected every sign.`;
  }
  if (ui.received < d.suggestionsPosted) return "Some suggestions did not reach the page (tab hidden or camera stopped).";
  return "Pipeline healthy. BSL suggestions need “Add to transcript” before they are added or spoken.";
}

export function formatBslDiagnostics(d: BslDiagnostics, ui: BslUiCounts, trackedFrames: number) {
  const last = d.lastDecision;
  const lastLine = last
    ? `Last BSL decision ${(last.ageMs / 1000).toFixed(0)} s ago: ${last.status}${last.reason ? ` — ${last.reason}` : ""}. `
      + `Top: ${last.top5.slice(0, 3).map(item => `${item.label} ${item.p.toFixed(2)}`).join(", ")}`
      + ` · ${last.windows} window${last.windows === 1 ? "" : "s"}, ${last.spanFrames} sign frames, ${last.handFrames} hand frames, ${last.slotDisagreements} hand-label corrections`
    : "No BSL model decision yet.";
  return [
    `BSL ${d.engine} · tracking ${trackedFrames} frames · to recognizer ${d.observations} · hands ${d.handFrames} · shoulders ${d.shoulderFrames}`,
    `Signs completed ${d.signsCompleted} · skipped (model busy) ${d.signsSkipped}`,
    `Model ${d.model}${d.modelError ? ` (${d.modelError})` : ""} · runs ${d.inferences}${d.lastInferenceMs === null ? "" : ` (${d.lastInferenceMs.toFixed(0)} ms)`} · failures ${d.inferenceFailures}`,
    `Decisions: accepted ${d.decisions.accepted} · uncertain ${d.decisions.uncertain} · too few hands ${d.decisions["too-few-hands"]} · no movement ${d.decisions["no-movement"]}`,
    `Suggestions sent ${d.suggestionsPosted} · stale ${d.suggestionsStale} · duplicates suppressed ${d.duplicatesSuppressed} · received ${ui.received} · shown ${ui.shown} · added ${ui.added} · spoken ${ui.spoken}`,
    lastLine,
    `Next step: ${bslHint(d, ui, trackedFrames)}`,
  ];
}
