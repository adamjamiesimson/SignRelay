// Engine V3 decision policy (open-set). The policy object is produced by
// train/calibrate.py from validation signers + calibration-only unknown signs and is
// fingerprint-bound to the model in meta.json. Mirrored by train/policy.py:decide.

export function softmax(z, T = 1) {
  const m = Math.max(...z); const e = z.map(v => Math.exp((v - m) / T)); const s = e.reduce((a, b) => a + b, 0);
  return e.map(v => v / s);
}

/**
 * logits: Float32Array(C+1) (last = UNKNOWN), emb: Float32Array(D) L2-normalised.
 * Returns { status: "accepted" | "unknown" | "uncertain", label, index, top5, scores }.
 */
export function decide(logits, emb, meta) {
  const P = meta.policy, C = meta.classes.length;
  const prob = softmax(Array.from(logits), P.temperature);
  const known = prob.slice(0, C);
  const order = known.map((p, i) => [p, i]).sort((a, b) => b[0] - a[0]);
  const [p1, i1] = order[0], p2 = order[1][0];
  const pUnknown = prob[C];
  let proto = null;
  if (meta.prototypes && emb) {
    const D = emb.length, row = meta.prototypes.subarray(i1 * D, (i1 + 1) * D);
    let dot = 0; for (let k = 0; k < D; k++) dot += row[k] * emb[k];
    proto = dot;
  }
  const scores = { p_top1: p1, margin: p1 - p2, p_unknown: pUnknown, proto_cos: proto };
  const top5 = order.slice(0, 5).map(([p, i]) => ({ label: meta.classes[i], p }));
  let status = "accepted";
  if (pUnknown >= P.max_unknown) status = "unknown";
  else if (p1 < P.min_top1 || (P.min_margin != null && p1 - p2 < P.min_margin)) status = "uncertain";
  else if (P.min_proto != null && proto != null && proto < P.min_proto) status = "unknown";
  return { status, label: status === "accepted" ? meta.classes[i1] : null, best: meta.classes[i1], index: i1, top5, scores };
}
