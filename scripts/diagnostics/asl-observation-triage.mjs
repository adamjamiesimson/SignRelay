// Aggregate-only diagnostic helpers for development video traces.
// The outputs contain neither landmarks nor the frame-by-frame timeline.

export function summarizeHandContinuity(frames, hasHand) {
  if (!Array.isArray(frames) || !frames.length || typeof hasHand !== "function") throw new Error("Need frames and a hand-validity predicate");
  const episodes = [];
  let open = null;
  for (let i = 0; i < frames.length; i++) {
    if (!Number.isFinite(frames[i].timestamp) || (i && frames[i].timestamp <= frames[i - 1].timestamp))
      throw new Error("Hand continuity needs increasing source timestamps");
    const tracked = Boolean(hasHand(frames[i]));
    if (tracked && !open) open = { first: i, last: i };
    else if (tracked) open.last = i;
    else if (open) { episodes.push(open); open = null; }
  }
  if (open) episodes.push(open);
  const first = episodes[0], last = episodes.at(-1);
  let maxInteriorMissing = 0;
  for (let i = 1; i < episodes.length; i++)
    maxInteriorMissing = Math.max(maxInteriorMissing, episodes[i].first - episodes[i - 1].last - 1);
  const visible = episodes.reduce((sum, run) => sum + run.last - run.first + 1, 0);
  return {
    hand_tracking_episodes: episodes.length,
    hand_visible_frames: visible,
    hand_visible_fraction: visible / frames.length,
    longest_hand_episode_frames: episodes.reduce((max, run) => Math.max(max, run.last - run.first + 1), 0),
    longest_hand_episode_ms: Math.round(episodes.reduce((max, run) =>
      Math.max(max, frames[run.last].timestamp - frames[run.first].timestamp), 0)),
    interruptions_between_hand_episodes: Math.max(0, episodes.length - 1),
    longest_interior_missing_hand_frames: maxInteriorMissing,
    leading_missing_hand_frames: first ? first.first : frames.length,
    trailing_missing_hand_frames: last ? frames.length - last.last - 1 : frames.length,
    first_valid_hand_delay_ms: first ? Math.round(frames[first.first].timestamp - frames[0].timestamp) : null,
    last_valid_hand_to_end_ms: last ? Math.round(frames.at(-1).timestamp - frames[last.last].timestamp) : null,
  };
}

// A candidate in a worker analysis is not necessarily a confirmed output.
// Count unbroken analysis-message proposals without fabricating missed frames.
export function candidateContinuity(analyses, expectedGloss) {
  const expected = String(expectedGloss).trim().toUpperCase();
  let run = 0, longest = 0, expectedCount = 0, otherCount = 0;
  for (const analysis of analyses) {
    const label = typeof analysis.candidate === "string" ? analysis.candidate.trim().toUpperCase() : "";
    if (label === expected) { run++; expectedCount++; longest = Math.max(longest, run); }
    else { run = 0; if (label) otherCount++; }
  }
  return {
    expected_candidate_analyses: expectedCount,
    competing_candidate_analyses: otherCount,
    longest_consecutive_expected_candidate_analyses: longest,
  };
}

const followups = {
  no_hands_visible: "Check camera framing and actual hand detection before assessing sign geometry.",
  sparse_hand_samples: "Review independently annotated stroke frames and whether tracking survives the handshape; do not lower model sample requirements.",
  no_starter_window: "Inspect tracking continuity and whether the hand remains visible long enough for the existing starter prerequisites.",
  competing_proposals: "Have a fluent reviewer check the sign variant and overlapping gesture geometry before modifying ambiguity rules.",
  unconfirmed_proposal: "Check actual proposal spacing, motion boundaries and the existing confirmation sequence; do not bypass two-evidence confirmation.",
  eligible_without_proposal: "Review fluent annotation, hand shape, face/shoulder references and movement completion; tracking eligibility alone is not a matching sign.",
  insufficient_observation: "Inspect motion-gate and reviewed signing evidence before attributing the abstention to classification.",
};

export function triageAslAbstention(report) {
  if (!report || !Array.isArray(report.accepted_glosses))
    throw new Error("Cannot diagnose missing accepted-word evidence");
  if (report.accepted_glosses.length) return null;
  const handFrames = report.valid_hand_frames;
  const eligible = report.starter_tracking_eligible_endpoints;
  const totalFrames = report.frames;
  if (![handFrames, eligible, totalFrames].every(n => Number.isInteger(n) && n >= 0)
      || totalFrames === 0 || handFrames > totalFrames)
    throw new Error("Cannot triage missing or inconsistent development counters");
  const expected = report.expected_gloss;
  if (typeof expected !== "string" || !expected.trim()) throw new Error("Signed expected gloss required");
  const target = expected.toUpperCase();
  const proposals = report.worker_candidates ?? {};
  const expectedCount = proposals[target] ?? 0;
  const otherCount = Object.entries(proposals).reduce((sum, [word, count]) =>
    sum + (word === target ? 0 : Number(count) || 0), 0);
  const incomplete = report.abstention_prefix_probe?.incomplete_labels?.[target] ?? 0;
  const episodes = report.hand_continuity?.hand_tracking_episodes ?? null;
  const ready = report.worker_motion_reasons && Object.values(report.worker_motion_reasons).every(n => Number.isInteger(n) && n >= 0)
    ? (report.worker_motion_reasons.ready ?? 0) : null;
  const primary = !handFrames ? "no_hands_visible"
    : handFrames < 6 ? "sparse_hand_samples"
    : !eligible ? "no_starter_window"
    : otherCount ? "competing_proposals"
    : expectedCount ? "unconfirmed_proposal"
    : "eligible_without_proposal";
  const signals = [];
  if (episodes !== null && episodes > 1) signals.push("hand_visibility_interrupted");
  if (handFrames < 6) signals.push("fewer_than_six_valid_hand_frames");
  if (eligible === 0) signals.push("no_basic_starter_eligible_endpoint");
  if (expectedCount > 0) signals.push("expected_word_proposed_not_confirmed");
  if (otherCount > 0) signals.push("other_word_candidate_observed");
  if (incomplete > 0) signals.push("incomplete_starter_geometry_probe_observed");
  if (report.worker_ambiguity_analyses > 0) signals.push("worker_ambiguity_feedback_observed");
  if (ready === 0) signals.push("no_worker_motion_ready_analysis");
  return {
    primary_observation: primary,
    observed_signals: signals,
    expected_proposal_analyses: expectedCount,
    other_proposal_analyses: otherCount,
    incomplete_expected_geometry_probes: incomplete,
    next_review_check: followups[primary],
    uncertainty: "These are observations on publisher-labelled isolated-sign development footage, not proof of an incomplete human sign, tracking failure cause, or model accuracy. Stroke boundaries and variants require independent fluent review.",
  };
}
