"""Re-extract two published held-out examples for app integration replay.
These are selected known examples, not a new unbiased accuracy evaluation.
"""
import hashlib,json,pathlib,sys,urllib.request
import numpy as np
import onnxruntime as ort
sys.path.insert(0,"training/fingerspelling")
from prepare import metadata,extract,TASK_SHA,TASK_URL

root=pathlib.Path("work/fingerspelling-app");root.mkdir(parents=True,exist_ok=True)
manifest=json.loads(pathlib.Path("docs/fingerspelling/evidence/fsboard-v13-provenance.json").read_text())
report=json.loads(pathlib.Path("docs/fingerspelling/evidence/fsboard-v13-pilot.json").read_text())
ids=["6befb92aee4dcad7bf6ed904","6cd1239964a94fcc9b8eaff0"]
records={r["clipFilename"]:r for r in metadata("test")}
with urllib.request.urlopen(TASK_URL,timeout=45) as response: task=response.read(8373441)
assert len(task)==8373440 and hashlib.sha256(task).hexdigest()==TASK_SHA
(root/"gesture.task").write_bytes(task)
model=pathlib.Path("public/models/asl-fingerspelling/fsboard-pilot-v1.onnx")
assert hashlib.sha256(model.read_bytes()).hexdigest()==report["modelSha256"]
session=ort.InferenceSession(str(model),providers=["CPUExecutionProvider"])
def decode(logits):
 result=[];last=-1
 for value in logits.argmax(-1):
  if value!=last and value:result.append(report["vocabulary"][int(value)])
  last=value
 return "".join(result)
samples=[]
for id in ids:
 source=next(r for r in manifest["rows"] if r["id"]==id)
 row=extract(("test",records[source["source"]],str(root),str(root/"gesture.task")))
 assert row["rawSha256"]==source["rawSha256"]
 z=np.load(row["file"],allow_pickle=False)
 frames=[]
 for i,raw in enumerate(z["raw"]):
  hands=[]
  if np.isfinite(raw).all():
   hands=[{"landmarks":[{"x":float(p[0]),"y":float(p[1]),"z":float(p[2])} for p in raw],"handedness":row["side"],"gesture":"","gestureScore":0}]
  frames.append({"timestamp":i*1000/row["sampleFps"],"hands":hands,"face":[],"pose":[]})
 original=decode(session.run(None,{"features":z["features"][None]})[0][0])
 samples.append({"id":id,"reference":source["phrase"],"aspect":row["aspect"],"rawSha256":row["rawSha256"],"originalPrediction":original,"frames":frames})
(root/"samples.json").write_text(json.dumps(samples))
print("REAL-APP-SOURCES",json.dumps([{k:r[k] for k in ("id","reference","rawSha256","originalPrediction")} for r in samples]),flush=True)
