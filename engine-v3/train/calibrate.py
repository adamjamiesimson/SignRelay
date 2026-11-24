"""Fit the open-set decision policy and class prototypes from a trained run's validation split.

Without this step a retrained model ships placeholder gate numbers (temperature 1.0, min_top1 0) and no
prototypes, so `min_proto` and the prototype cosine do nothing and every argmax is published. This
script reads the run's checkpoint and the cache's validation split, then writes exactly what
`export_onnx.py --policy/--prototypes` expects:

  runs/<name>/policy.json      temperature, min_top1, min_proto, max_unknown, min_hand_frames
  runs/<name>/prototypes.npy   [C, D] L2-normalised mean embedding per class

Fitting is deliberately simple and inspectable: a temperature sweep on the known validation clips
(minimising NLL), then a grid over (min_top1, min_proto) that keeps the unknown false-accept rate at or
below the budget while maximising how many correct known windows are accepted. Clips whose sign is not
in the run's class list are the unknown windows; a cache with none of them cannot constrain the gate,
which is said outright rather than silently skipped.

  python calibrate.py --run runs/v3.2-islr --cache ~/data/cache
  python calibrate.py --run ... --cache ... --unknown-budget 0.0 --print-grid
"""
from __future__ import annotations

import argparse, json, math, os, sys
import numpy as np
import torch
import torch.nn.functional as F

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "pipeline"))
from v3model import SignModel, prepare_clip, TMAX  # noqa: E402
from points import N_POINTS  # noqa: E402


def load_run(run, which="best.pt"):
    ck = torch.load(os.path.join(run, which), map_location="cpu", weights_only=False)
    cfg = ck.get("args", {})
    with open(os.path.join(run, "classes.json")) as handle:
        classes = json.load(handle)
    model = SignModel(classes["unknown_index"] + 1, d=cfg.get("dim", 192), depth=cfg.get("depth", 2),
                      kind=cfg.get("kind", "convformer"))
    model.load_state_dict(ck["model"])
    model.eval()
    return model, classes, cfg


def load_val(cache):
    z = np.load(f"{cache}/val.npz")
    meta = json.load(open(f"{cache}/val.json"))
    offs = z["offsets"]
    return [(z["pts"][offs[i]:offs[i + 1]], row["sign"], row.get("hand_frames") or 0)
            for i, row in enumerate(meta)]


@torch.no_grad()
def score(model, clips, no_face=False, threads=2):
    """(logits [N, C+1], embeddings [N, D]) for each clip, indices aligned with the input."""
    torch.set_num_threads(threads)
    logits, embeddings = [], []
    for start in range(0, len(clips), 32):
        batch = []
        for clip in clips[start:start + 32]:
            if no_face:
                clip = clip.copy(); clip[:, 55:] = np.nan
            prepared = prepare_clip(clip.astype(np.float32))
            if prepared is None:
                # An unusable clip still occupies its row, so indexes stay aligned with the metadata.
                prepared = prepare_clip(np.zeros((8, N_POINTS, 3), np.float32))
            batch.append(prepared)
        xs, vs, ms = (torch.from_numpy(np.stack(part)) for part in zip(*batch))
        embeddings.append(F.normalize(model.embed(xs, vs, ms), dim=-1))
        logits.append(model.head(embeddings[-1]))
    return torch.cat(logits).numpy(), torch.cat(embeddings).numpy()


def softmax_at(logits, temperature):
    scaled = (logits - logits.max(axis=1, keepdims=True)) / temperature
    e = np.exp(scaled)
    return e / e.sum(axis=1, keepdims=True)


def fit_temperature(logits_known, labels_known):
    """Lowest NLL over a fixed grid: the shipped checkpoint's 0.81 came from the same kind of sweep."""
    best_t, best_loss = 1.0, math.inf
    for temperature in np.arange(0.5, 2.05, 0.05):
        picked = softmax_at(logits_known, float(temperature))[np.arange(len(labels_known)), labels_known]
        loss = float(-np.log(np.clip(picked, 1e-9, 1)).mean())
        if loss < best_loss:
            best_t, best_loss = float(temperature), loss
    return best_t


def gate_sweep(known, unknown, budget, grid=None):
    """Returns ((min_top1, min_proto), correct-rate, relaxed) where `relaxed` says no grid point met the
    budget and the closest one was used instead."""
    """Best (min_top1, min_proto): unknown accepts <= budget, then the most correct accepts.

    known/unknown: rows of (p_top1, proto_cos, correct) — `correct` says the argmax matched the label.
    """
    grid = grid or [(t, p) for t in np.arange(0.0, 0.95, 0.05) for p in np.arange(0.0, 0.95, 0.05)]
    best, best_score, fallback, fallback_score = None, -1.0, None, math.inf
    for min_top1, min_proto in grid:
        kept = sum(1 for row in known if row[0] >= min_top1 and row[1] >= min_proto and row[2])
        accepted_unknown = sum(1 for row in unknown if row[0] >= min_top1 and row[1] >= min_proto)
        rate = accepted_unknown / max(1, len(unknown))
        correct_rate = kept / max(1, len(known))
        if rate <= budget and correct_rate > best_score:
            best_score, best = correct_rate, (float(min_top1), float(min_proto))
        # No grid point may satisfy a tight budget on a weak model; remember the closest one anyway.
        if rate < fallback_score:
            fallback_score, fallback = rate, (float(min_top1), float(min_proto))
    if best is None:
        return fallback, best_score if best_score > 0 else 0.0, True
    return best, best_score, False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--cache", required=True)
    ap.add_argument("--which", default="best.pt")
    ap.add_argument("--unknown-budget", type=float, default=0.05,
                    help="share of unknown validation windows the gate may accept")
    ap.add_argument("--max-unknown-probability", type=float, default=None,
                    help="explicit max_unknown; default: the median unknown-window probability, 0.3 with no unknowns")
    ap.add_argument("--threads", type=int, default=2)
    args = ap.parse_args()

    model, classes, cfg = load_run(args.run, args.which)
    known_index = {gloss: index for index, gloss in enumerate(classes["classes"])}
    val = load_val(args.cache)
    logits, embeddings = score(model, [clip for clip, _, _ in val],
                               no_face=bool(cfg.get("no_face")), threads=args.threads)

    # Prototypes are the L2-normalised mean embedding per class, exactly what the browser's gate and
    # the taught-sign matcher compare against; unknown clips have no prototype.
    count = len(classes["classes"])
    sums = np.zeros((count, embeddings.shape[1]), np.float64)
    seen = np.zeros(count, np.int64)
    for index, (_, sign, _) in enumerate(val):
        if sign in known_index:
            sums[known_index[sign]] += embeddings[index]
            seen[known_index[sign]] += 1
    prototypes = np.divide(sums, np.maximum(np.linalg.norm(sums, axis=1, keepdims=True), 1e-9)).astype(np.float32)

    # Rows mirror decide() in the browser: probability and margin come from the tempered softmax, the
    # prototype cosine is taken against the class the model actually picked.
    probability = softmax_at(logits, 1.0)
    argmax = probability.argmax(axis=1)
    known_rows = [i for i in range(len(val)) if val[i][1] in known_index]
    labels_known = np.array([known_index[val[i][1]] for i in known_rows])
    temperature = fit_temperature(logits[known_rows], labels_known)
    tempered = softmax_at(logits, temperature)
    rows = []
    for index in range(len(val)):
        pick = int(argmax[index])
        proto = float(np.dot(embeddings[index], prototypes[pick])) if pick < count else None
        correct = known_index.get(val[index][1]) == pick
        rows.append({"known": val[index][1] in known_index, "p": float(tempered[index][pick]),
                     "proto": proto, "correct": correct})
    known = [(row["p"], row["proto"], row["correct"]) for row in rows if row["known"]]
    unknown = [(row["p"], row["proto"], False) for row in rows if not row["known"]]

    if unknown:
        (min_top1, min_proto), kept, relaxed = gate_sweep(known, unknown, args.unknown_budget)
        if relaxed:
            print(f"warning: no (min_top1, min_proto) accepts at most {args.unknown_budget:.0%} of unknown "
                  "windows on this model; using the closest point - train longer or raise the budget")
        max_unknown = args.max_unknown_probability
        if max_unknown is None:
            # The unknown windows' own top-1 probability, at the median: the browser's p_unknown check
            # then catches about half of them outright, and the rest is the threshold grid's job.
            unknown_p = tempered[[i for i, row in enumerate(rows) if not row["known"]]].max(axis=1)
            max_unknown = round(min(0.5, float(np.quantile(unknown_p, 0.5))), 3)
    else:
        (min_top1, min_proto), kept, _ = gate_sweep(known, [], args.unknown_budget)
        max_unknown = args.max_unknown_probability or 0.3
        print("no unknown windows in the validation split: the unknown budget could not be measured, "
              "so max_unknown keeps the shipped default and should be re-checked with real unknowns")

    policy = {"temperature": round(temperature, 4), "min_top1": round(min_top1, 3),
              "min_proto": round(min_proto, 3), "min_margin": None, "max_unknown": max_unknown,
              "min_hand_frames": 3,
              "note": f"fitted from {len(known)} known and {len(unknown)} unknown validation clips; "
                      f"{kept * 100:.0f}% of correct known windows accepted at the unknown budget "
                      f"{args.unknown_budget}"}
    json.dump(policy, open(os.path.join(args.run, "policy.json"), "w"), indent=1)
    np.save(os.path.join(args.run, "prototypes.npy"), prototypes)
    classes_seen = int((seen > 0).sum())
    print(f"temperature {policy['temperature']} | min_top1 {policy['min_top1']} | min_proto {policy['min_proto']} "
          f"| max_unknown {policy['max_unknown']}")
    print(f"known clips {len(known)} ({classes_seen} of {count} classes seen in validation), "
          f"unknown clips {len(unknown)}, correct accepted {kept * 100:.0f}%")
    print(f"wrote {args.run}/policy.json and {args.run}/prototypes.npy")
    print("export with: export_onnx.py --run %s --out <dir> --policy %s/policy.json --prototypes %s/prototypes.npy"
          % (args.run, args.run, args.run))
    classes_seen = int((seen > 0).sum())
    print(f"temperature {policy['temperature']} | min_top1 {policy['min_top1']} | min_proto {policy['min_proto']} "
          f"| max_unknown {policy['max_unknown']}")
    print(f"known clips {len(known)} (of {len(classes['classes'])} classes, {classes_seen} seen), "
          f"unknown clips {len(unknown)}, correct accepted {kept * 100:.0f}%")
    print(f"wrote {args.run}/policy.json and {args.run}/prototypes.npy")
    print("export with: export_onnx.py --run %s --out <dir> --policy %s/policy.json --prototypes %s/prototypes.npy"
          % (args.run, args.run, args.run))


if __name__ == "__main__":
    main()
