"""Robustness tranche: re-extract a fixed subset of sealed-test clips under video perturbations.

  python perturb_plan.py <plan-C-test-r0.json> <out-plan.json> [--per-class 1]
Conditions (ffmpeg filters applied to the source pixels before the standard 15 Hz / 480 px path):
  far       content scaled to 55 % inside a neutral border (camera ~1.8x farther)
  dark      gamma/brightness reduced (dim room)
  bright    over-exposed
  noise     strong temporal sensor noise
  fast      played 1.35x faster (quick signer)
  slow      played 0.7x speed (slow signer)
  webcam    landscape 4:3 framing with the portrait clip pillarboxed (laptop webcam geometry)
Run only after the model and policy are frozen (it reads sealed-test clips).
"""
import json, sys, hashlib
COND = {
    "far": ("scale=iw*0.55:ih*0.55,pad=iw/0.55:ih/0.55:(ow-iw)/2:(oh-ih)/2:color=0x808080", None),
    "dark": ("eq=brightness=-0.18:contrast=0.75:gamma=0.6", None),
    "bright": ("eq=brightness=0.22:contrast=0.85", None),
    "noise": ("noise=alls=28:allf=t", None),
    "fast": ("setpts=PTS/1.35", None),
    "slow": ("setpts=PTS/0.7", None),
    "webcam": ("scale=-2:ih*0.75,pad=ih*4/3:ih:(ow-iw)/2:0:color=0x808080", "webcam"),
}
src, out = sys.argv[1], sys.argv[2]
rows = json.load(open(src)); by = {}
for r in rows: by.setdefault(r["sign"], []).append(r)
pick = [sorted(v, key=lambda r: hashlib.sha256(("perturb" + r["file"]).encode()).hexdigest())[0] for k, v in sorted(by.items())]
plan = []
for r in pick:
    for c, (vf, geo) in COND.items():
        q = dict(r, condition=c, vf_pre=vf, split="robust", **({"geometry": geo} if geo else {}))
        plan.append(q)
json.dump(plan, open(out, "w")); print(len(pick), "clips x", len(COND), "conditions =", len(plan))
