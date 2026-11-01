"""Native ONNX on eight genuine held-out landmark streams and declared perturbations.
Derived stress inputs are NOT new recordings, real negatives or physical-camera evidence.
"""
import hashlib,json,pathlib,sys
import numpy as np,onnxruntime as ort
sys.path.insert(0,"training/fingerspelling/accuracy")
from features import encode
from metrics import beam
root=pathlib.Path("work/upright-evaluation");out=pathlib.Path("outputs/reliability-derived-stress.json")
index={r["id"]:r for r in json.loads(pathlib.Path("docs/fingerspelling/evidence/upright-browser-fixture-index.json").read_text())}
contract=json.loads(pathlib.Path("docs/fingerspelling/evidence/upright-runtime.json").read_text());model=pathlib.Path("public"+contract["url"])
assert hashlib.sha256(model.read_bytes()).hexdigest()==contract["sha256"]
session=ort.InferenceSession(str(model),providers=["CPUExecutionProvider"]);rows=[]
for file in sorted((root/"browser").glob("*.json")):
 sample=json.loads(file.read_text())
 assert sample["id"] in index and sample["reference"]==index[sample["id"]]["reference"]
 raw=np.asarray(sample["raw"],dtype=np.float32);times=np.asarray(sample["times"],dtype=np.float64)
 assert np.allclose(encode(raw,times,sample["side"],sample["aspect"],"v3"),np.asarray(sample["features"],np.float32),atol=2e-4),"Frozen feature contract mismatch"
 for variant in ("original","drop-every-fifth","missing-five-observations","gap-three-observations","mirror-and-returned-category-swap"):
  r=raw.copy();t=times.copy();side=sample["side"]
  if variant=="drop-every-fifth":keep=np.arange(len(r))%5!=4;r=r[keep];t=t[keep]
  if variant=="missing-five-observations":r[len(r)//2:len(r)//2+5]=np.nan
  if variant=="gap-three-observations":keep=np.ones(len(r),bool);keep[len(r)//2:len(r)//2+3]=False;r=r[keep];t=t[keep]
  if variant=="mirror-and-returned-category-swap":r[:,:,0]=1-r[:,:,0];side="Right" if side=="Left" else "Left"
  x=encode(r,t,side,sample["aspect"],"v3");prediction=beam(session.run(None,{"features":x[None]})[0][0])
  duration=float(t[-1]-t[0]);fps=(len(t)-1)/duration;gap=float(np.diff(t).max())
  visible=float(np.isfinite(r).all(axis=(1,2)).mean())
  rules=contract["policy"]["policy"]
  quality=.85<=duration<=16 and fps>=12 and gap<=.2 and visible>=.6
  eligible=quality and rules["minFrames"]<=len(t)<=rules["maxFrames"] and rules["minimumTextLength"]<=len(prediction)<=rules["maximumTextLength"]
  rows.append({"id":sample["id"],"reference":sample["reference"],"variant":variant,"rawPrediction":prediction,"candidate":prediction if eligible else "","eligible":eligible,"frames":len(t),"observedFps":fps,"maxGapMs":gap*1000,"visibleFraction":visible})
assert len(rows)==40
report={"kind":"Declared derived perturbations of eight genuine sequences; counterfactual native neural probes even where app quality would abstain; not physical-camera validation or new independent examples","modelSha256":contract["sha256"],"sourceRun":41285144707,"rows":rows}
out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2));print("DERIVED-STRESS-RESULT",json.dumps(report),flush=True)
