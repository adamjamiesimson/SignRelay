"""Deterministic extraction plan over the PopSign v2.1 index.

Within each (split, sign), signers are ordered by sha256(sign|signer) and their
recordings by filename. Round r takes the r-th recording of every signer, so each
round adds at most one clip per signer per sign (maximising signer diversity).
A tranche is (split, round, first-N-signers). Output: one JSON list per tranche.
"""
import hashlib, json, sys, collections

def order(rows):
    by = collections.defaultdict(list)
    for r in rows: by[r["signer"]].append(r)
    signers = sorted(by, key=lambda s: hashlib.sha256(f"{rows[0]['sign']}|{s}".encode()).hexdigest())
    return [sorted(by[s], key=lambda r: r["file"]) for s in signers]

def tranche(index, split, rnd, lo, hi):
    groups = collections.defaultdict(list)
    for r in index:
        if r["split"] == split: groups[r["sign"]].append(r)
    out = []
    for sign in sorted(groups):
        for recs in order(groups[sign])[lo:hi]:
            if rnd < len(recs): out.append(recs[rnd])
    return out

if __name__ == "__main__":
    index = json.load(open(sys.argv[1])); outdir = sys.argv[2]
    spec = [("A-train-r0-s0-10", "train", 0, 0, 10), ("A-val-r0", "val", 0, 0, 99),
            ("B-train-r0-s10-25", "train", 0, 10, 25), ("C-test-r0", "test", 0, 0, 99),
            ("D-train-r0-s25-59", "train", 0, 25, 99), ("E-train-r1-s0-59", "train", 1, 0, 99),
            ("F-test-r1", "test", 1, 0, 99)]
    for name, split, rnd, lo, hi in spec:
        rows = tranche(index, split, rnd, lo, hi)
        json.dump(rows, open(f"{outdir}/plan-{name}.json", "w"))
        print(name, len(rows), "clips", len({r['signer'] for r in rows}), "signers", len({r['sign'] for r in rows}), "signs")
