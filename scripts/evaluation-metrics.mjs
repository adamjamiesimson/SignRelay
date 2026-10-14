const gloss = value => typeof value === "string" ? value.normalize("NFC").trim().replace(/\s+/g, " ").toUpperCase() : null;
const failed = row => row.status === "error" || (Array.isArray(row.errors) && row.errors.length > 0);

export function validateTrials(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error("No evaluation trials found");
  const ids = new Set(), hashes = new Set(), participantSplits = new Map();
  return rows.map((row, index) => {
    const fail = message => { throw new Error(`Trial ${index + 1}: ${message}`); };
    for (const key of ["session_id", "participant_id", "language", "trial_type", "expected_gloss", "predicted_gloss", "accepted"]) {
      if (!(key in row)) fail(`missing ${key}`);
    }
    if (!["sign", "no_sign", "unknown_sign"].includes(row.trial_type)) fail("invalid trial_type");
    if (typeof row.accepted !== "boolean") fail("accepted must be boolean");
    for (const key of ["session_id", "participant_id", "language"]) if (typeof row[key] !== "string" || !row[key].trim()) fail(`invalid ${key}`);
    const expected = gloss(row.expected_gloss);
    if (row.trial_type === "sign" && !expected) fail("signed trial needs an expected gloss");
    if (row.trial_type !== "sign" && expected) fail("negative trial must have null expected_gloss");
    const predictions = row.accepted_glosses ?? (row.accepted ? [row.predicted_gloss] : []);
    if (!Array.isArray(predictions) || predictions.some(value => !gloss(value))) fail("invalid accepted_glosses");
    if (row.accepted !== Boolean(predictions.length)) fail("accepted disagrees with accepted_glosses");
    if (row.accepted && gloss(row.predicted_gloss) !== gloss(predictions[0])) fail("predicted_gloss must equal the first accepted gloss");
    if (!row.accepted && row.predicted_gloss != null && row.predicted_gloss !== "") fail("rejected trial has a predicted gloss");
    const split = row.evaluation_split ?? "unspecified";
    if (!["development", "held_out", "unspecified"].includes(split)) fail("invalid evaluation_split");
    if (row.trial_id) { if (ids.has(row.trial_id)) fail("duplicate trial_id"); ids.add(row.trial_id); }
    if (row.recording_sha256) {
      if (!/^[a-f0-9]{64}$/.test(row.recording_sha256)) fail("invalid recording fingerprint");
      if (hashes.has(row.recording_sha256)) fail("duplicate recording counted as an independent trial");
      hashes.add(row.recording_sha256);
    }
    if (split !== "unspecified") {
      const previous = participantSplits.get(row.participant_id);
      if (previous && previous !== split) fail("participant appears in development and held_out splits");
      participantSplits.set(row.participant_id, split);
    }
    return { ...row, expected_gloss: expected, accepted_glosses: predictions.map(gloss), evaluation_split: split };
  });
}

export function summarizeTrials(input) {
  const rows = validateTrials(input), groups = new Map();
  for (const row of rows) {
    const key = `${row.language}/${row.evaluation_split}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([group, trials]) => {
    const signed = trials.filter(r => r.trial_type === "sign");
    // Any extra wrong word makes the trial wrong, even if another output was
    // correct. Never cherry-pick the first/correct confirmation.
    const correct = signed.filter(r => !failed(r) && r.accepted_glosses.length && r.accepted_glosses.every(g => g === r.expected_gloss));
    const wrong = signed.filter(r => r.accepted_glosses.some(g => g !== r.expected_gloss));
    const accepted = signed.filter(r => r.accepted);
    const negatives = kind => {
      const rows = trials.filter(r => r.trial_type === kind);
      const falseAccepts = rows.filter(r => r.accepted).length;
      const errors = rows.filter(failed).length;
      // An interrupted/failed trial cannot establish a correct rejection.
      // Preserve every observed false accept, but withhold a rate until the
      // whole negative cohort completed without runtime errors.
      return { trials: rows.length, completed_trials: rows.length - errors, errors,
        false_accepts: falseAccepts, rate: rows.length && !errors ? falseAccepts / rows.length : null };
    };
    const confusions = {};
    for (const row of wrong) for (const predicted of new Set(row.accepted_glosses)) {
      if (predicted === row.expected_gloss) continue;
      const pair = `${row.expected_gloss} → ${predicted}`; confusions[pair] = (confusions[pair] ?? 0) + 1;
    }
    return { group, trials: trials.length, signed_trials: signed.length, correct: correct.length,
      signed_accuracy: signed.length ? correct.length / signed.length : null,
      coverage: signed.length ? accepted.length / signed.length : null,
      precision_when_accepted: accepted.length ? correct.length / accepted.length : null,
      wrong_accepted_trials: wrong.length, abstentions: signed.length - accepted.length,
      no_sign: negatives("no_sign"), unknown_sign: negatives("unknown_sign"),
      errors: trials.filter(failed).length, confusions,
      holdout_verified: false,
    };
  });
}
