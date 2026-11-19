"""Deterministic label mapping from the frozen vocabulary policy."""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))

def load_policy(path=None):
    return json.load(open(path or os.path.join(HERE, "..", "vocabulary", "policy.json")))

def canonical(sign, policy):
    for name, group in policy["merges"].items():
        if sign in group: return name
    for name, group in policy.get("validation_merges", {}).items():
        if sign in group: return name
    return {"thankyou": "THANK-YOU"}.get(sign, sign.upper())

def build(all_signs, policy):
    """Returns (classes, sign->class index or role)."""
    u = policy["unknown_signs"]
    roles = {s: "unknown_train" for s in u["train_as_unknown"]}
    roles.update({s: "unknown_cal" for s in u["calibration_only"]})
    roles.update({s: "unknown_test" for s in u["test_only_never_seen"]})
    known = sorted({canonical(s, policy) for s in all_signs if s not in roles})
    idx = {c: i for i, c in enumerate(known)}
    mapping = {}
    for s in all_signs:
        mapping[s] = roles.get(s) or idx[canonical(s, policy)]
    return known, mapping
