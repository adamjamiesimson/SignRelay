"""Two known recordings, now display-oriented. Integration cases, not unbiased accuracy."""
import hashlib,json,pathlib,sys,urllib.request
import numpy as np,onnxruntime as ort
sys.path.insert(0,"training/fingerspelling")
from prepare import metadata,TASK_SHA,TASK_URL
sys.path.insert(0,"training/fingerspelling/accuracy")
from features import encode
from metrics import beam
sys.path.insert(0,"training/fingerspelling/upright")
from data import extract
root=pathlib.Path("work/fingerspelling-app");root.mkdir(parents=True,exist_ok=True)
old=json.loads(pathlib.Path("docs/fingerspelling/evidence/fsboard-v13-provenance.json").read_text())
records={r["clipFilename"]:r for r in metadata("test")}
with urllib.request.urlopen(TASK_URL,timeout=45) as response:task=response.read(8373441)
assert len(task)==8373440 and hashlib.sha256(task).hexdigest()==TASK_SHA
(root/"gesture.task").write_bytes(task)
contract=json.loads(pathlib.Path("docs/fingerspelling/evidence/upright-runtime.json").read_text());model=pathlib.Path("public"+contract["url"])
assert hashlib.sha256(model.read_bytes()).hexdigest()==contract["sha256"]
session=ort.InferenceSession(str(model),providers=["CPUExecutionProvider"]);samples=[]
for id in ("6befb92aee4dcad7bf6ed904","6cd1239964a94fcc9b8eaff0"):
 source=next(r for r in old["rows"] if r["id"]==id)
 item={"id":id,"role":"integration","sourceSplit":"test","record":records[source["source"]]}
 row=extract((item,str(root),str(root/"gesture.task")));assert row["rawSha256"]==source["rawSha256"]
 with np.load(row["file"],allow_pickle=False) as z:raw=z["raw"].copy();times=z["times"].copy()
 frames=[]
 for i,points in enumerate(raw):
  hands=[{"landmarks":[{"x":float(p[0]),"y":float(p[1]),"z":float(p[2])} for p in points],"handedness":row["side"],"gesture":"","gestureScore":0}] if np.isfinite(points).all() else []
  frames.append({"timestamp":float((times[i]-times[0])*1000),"hands":hands,"face":[],"pose":[]})
 x=encode(raw,times,row["side"],row["aspect"],"v3");prediction=beam(session.run(None,{"features":x[None]})[0][0])
 samples.append({"id":id,"reference":source["phrase"],"aspect":row["aspect"],"rawSha256":source["rawSha256"],"originalPrediction":prediction,"frames":frames,"rgbPolicy":"display-matrix-v1"})
(root/"samples.json").write_text(json.dumps(samples))
print("REAL-APP-SOURCES",json.dumps([{k:r[k] for k in ("id","reference","rawSha256","originalPrediction","rgbPolicy")} for r in samples]),flush=True)
