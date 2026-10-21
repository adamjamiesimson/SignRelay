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

const median = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** Observable tracker behaviour only: when MediaPipe returned a valid hand and
 * which label it gave. It does not know where the human sign started or ended,
 * so every counter here describes the tracker, not the signer.
 * @param {{timestamp: number, hands: {handedness: string}[]}[]} frames
 * @param {(hand: any) => boolean} validHand */
export function summarizeTrackerBehavior(frames, validHand, sustainFrames = 3) {
  if (!Array.isArray(frames) || frames.length < 2 || typeof validHand !== "function") throw new Error("Need at least two frames and a hand-validity predicate");
  const intervals = [];
  for (let i = 1; i < frames.length; i++) {
    const gap = frames[i].timestamp - frames[i - 1].timestamp;
    if (!Number.isFinite(gap) || gap <= 0) throw new Error("Tracker summary needs increasing source timestamps");
    intervals.push(gap);
  }
  const hands = frames.map(frame => frame.hands.filter(validHand));
  const missingRuns = [];
  const reacquisitionDelays = [];
  let run = 0, lastTracked = null, coveredMs = 0, episodeStart = null;
  for (let i = 0; i < frames.length; i++) {
    if (hands[i].length) {
      if (run && lastTracked !== null) { missingRuns.push(run); reacquisitionDelays.push(frames[i].timestamp - frames[lastTracked].timestamp); }
      if (episodeStart === null) episodeStart = i;
      run = 0; lastTracked = i;
    } else {
      if (episodeStart !== null) { coveredMs += frames[i - 1].timestamp - frames[episodeStart].timestamp; episodeStart = null; }
      if (lastTracked !== null) run++;
    }
  }
  if (episodeStart !== null) coveredMs += frames.at(-1).timestamp - frames[episodeStart].timestamp;
  // Label continuity is only judged where exactly one valid hand is visible in
  // consecutive frames; two-hand frames are a different tracking situation.
  // A change away from the established label counts as sustained only if the
  // new label then holds; returning after a brief flicker is not a switch.
  // Reacquisition with a new label is not judged here.
  let flickers = 0, sustained = 0, stable = null;
  for (let i = 0; i < frames.length; i++) {
    if (hands[i].length !== 1 || (i && hands[i - 1].length !== 1)) { stable = hands[i].length === 1 ? hands[i][0].handedness : null; continue; }
    const now = hands[i][0].handedness;
    if (stable === null) { stable = now; continue; }
    if (now === stable) continue;
    let held = 1;
    while (i + held < frames.length && hands[i + held].length === 1 && hands[i + held][0].handedness === now) held++;
    if (held >= sustainFrames) { sustained++; stable = now; }
    else flickers++;
    i += held - 1;
  }
  const buckets = { "1": 0, "2-3": 0, "4-7": 0, "8+": 0 };
  for (const length of missingRuns) buckets[length === 1 ? "1" : length <= 3 ? "2-3" : length <= 7 ? "4-7" : "8+"]++;
  const duration = frames.at(-1).timestamp - frames[0].timestamp;
  return {
    source_frame_interval_ms: { median: Math.round(median(intervals)), max: Math.round(Math.max(...intervals)) },
    frames_with_one_hand: hands.filter(list => list.length === 1).length,
    frames_with_two_hands: hands.filter(list => list.length >= 2).length,
    hand_reacquisitions: reacquisitionDelays.length,
    reacquisition_delay_ms: reacquisitionDelays.length ? { min: Math.round(Math.min(...reacquisitionDelays)),
      median: Math.round(median(reacquisitionDelays)), max: Math.round(Math.max(...reacquisitionDelays)) } : null,
    interior_missing_runs_by_frames: buckets,
    tracked_temporal_coverage: duration > 0 ? Math.round(coveredMs / duration * 1000) / 1000 : null,
    single_hand_label_flickers: flickers,
    single_hand_label_sustained_switches: sustained,
    note: "Tracker observations only. A missing interval may be a rest, occlusion, framing or a tracker failure; a label switch may be a real hand change. Neither identifies stroke boundaries.",
  };
}
