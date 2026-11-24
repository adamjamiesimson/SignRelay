// Scoring for BSL recognition trials. Strict label equality; no synonym rescoring.
// An "accepted" output is any model suggestion or automatic confirmation the pipeline produced.

const norm = label => String(label ?? "").replaceAll("_", " ").replaceAll("-", " ").replace(/\s+/g, " ").trim().toUpperCase();

/** One trial -> outcome. Supported: correct | wrong | abstained. Others: false-accept | rejected. */
export function bslOutcome(trial) {
  const accepted = [...(trial.suggested ?? []), ...(trial.confirmed ?? [])];
  if (trial.category !== "supported") return accepted.length ? "false-accept" : "rejected";
  if (!accepted.length) return "abstained";
  return accepted.every(label => norm(label) === norm(trial.expected_gloss)) ? "correct" : "wrong";
}

/** Threshold-free model ranking: the decision with the highest top-1 probability for this clip. */
export function bestDecision(trial) {
  return (trial.decisions ?? []).filter(decision => decision.top5?.length)
    .sort((a, b) => b.pTop1 - a.pTop1)[0] ?? null;
}

function rate(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : null;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))].toFixed(1));
}

export function scoreBslTrials(trials) {
  const groups = {};
  for (const trial of trials) (groups[trial.cohort ?? "all"] ??= []).push(trial);
  const summarise = list => {
    const outcomes = list.map(trial => ({ trial, outcome: bslOutcome(trial), best: bestDecision(trial) }));
    const supported = outcomes.filter(item => item.trial.category === "supported");
    const negatives = outcomes.filter(item => item.trial.category !== "supported");
    const count = (items, outcome) => items.filter(item => item.outcome === outcome).length;
    const correct = count(supported, "correct"), wrong = count(supported, "wrong"), abstained = count(supported, "abstained");
    const ranked = supported.filter(item => item.best);
    const inTop = k => ranked.filter(item => item.best.top5.slice(0, k).some(entry => norm(entry.label) === norm(item.trial.expected_gloss))).length;
    const inference = list.flatMap(trial => (trial.decisions ?? []).map(decision => decision.inferenceMs).filter(value => value > 0));
    const perCategory = {};
    for (const item of negatives) {
      const key = item.trial.category;
      perCategory[key] ??= { trials: 0, false_accepts: 0 };
      perCategory[key].trials++;
      if (item.outcome === "false-accept") perCategory[key].false_accepts++;
    }
    return {
      supported_trials: supported.length, correct, wrong, abstained,
      accuracy_all_supported: rate(correct, supported.length),
      coverage: rate(correct + wrong, supported.length),
      precision_when_accepted: rate(correct, correct + wrong),
      model_ranked_trials: ranked.length,
      top1_threshold_free: rate(inTop(1), supported.length),
      top5_threshold_free: rate(inTop(5), supported.length),
      negative_trials: negatives.length, false_accepts: count(negatives, "false-accept"),
      false_accept_rate: rate(count(negatives, "false-accept"), negatives.length), negatives_by_category: perCategory,
      duplicate_outputs: list.reduce((total, trial) => total + Math.max(0, (trial.suggested?.length ?? 0) + (trial.confirmed?.length ?? 0) - 1), 0),
      errors: list.filter(trial => trial.status !== "complete").length,
      inference_ms: { windows_total_p50: percentile(inference, 0.5), windows_total_p95: percentile(inference, 0.95), samples: inference.length },
      per_trial: outcomes.map(({ trial, outcome, best }) => ({ trial_id: trial.trial_id, expected: trial.expected_gloss, category: trial.category,
        outcome, accepted: [...(trial.suggested ?? []), ...(trial.confirmed ?? [])], best_top5: best?.top5.map(entry => `${entry.label} ${entry.p.toFixed(2)}`) ?? [] })),
    };
  };
  return Object.fromEntries([...Object.entries(groups).map(([cohort, list]) => [cohort, summarise(list)]), ["all", summarise(trials)]]);
}
