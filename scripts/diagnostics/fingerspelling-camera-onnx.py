"""Verify actual RGB camera -> app-captured feature tensor -> native ONNX text."""
import hashlib,json,pathlib,sys
import numpy as np,onnxruntime as ort
sys.path.insert(0,"training/fingerspelling/accuracy")
from metrics import beam
example=sys.argv[1];root=pathlib.Path("work/fingerspelling-camera")/example
path=root/"actual-captured-features.json"
if not path.exists():
 print("RGB-NATIVE-CAPTURE-PARITY",json.dumps({"id":example,"measured":False,"reason":"Quality abstained; no inference tensor"}));sys.exit(0)
runtime_path=pathlib.Path("docs/fingerspelling/evidence/upright-runtime.json")
if runtime_path.exists():runtime=json.loads(runtime_path.read_text())
else:runtime=json.loads(pathlib.Path("docs/fingerspelling/evidence/accuracy-v2-runtime.json").read_text())
model=pathlib.Path("public"+runtime["url"]);assert hashlib.sha256(model.read_bytes()).hexdigest()==runtime["sha256"]
row=json.loads(path.read_text());x=np.asarray(row["features"],np.float32).reshape(1,row["frames"],132)
session=ort.InferenceSession(str(model),providers=["CPUExecutionProvider"])
raw_prediction=beam(session.run(None,{"features":x})[0][0])
rules=runtime["policy"]["policy"]
assert runtime["policy"]["threshold"] is None,"Re-audit native policy parity if calibration changes"
visible=float((x[0,:,130]==1).mean())
eligible=rules["minFrames"]<=row["frames"]<=rules["maxFrames"] and visible>=rules["minVisibleFraction"] and rules["minimumTextLength"]<=len(raw_prediction)<=rules["maximumTextLength"]
prediction=raw_prediction if eligible else ""
assert prediction==row["prediction"],"Actual RGB native/browser captured-input text/policy mismatch"
result={"id":example,"measured":True,"nativeCapturedTextParity":True,"frames":row["frames"],"prediction":prediction,"nativeRawPrediction":raw_prediction,"nativeStructuralEligible":eligible,"modelSha256":runtime["sha256"]}
file=pathlib.Path("outputs")/("fingerspelling-recorded-camera-"+example+".json");report=json.loads(file.read_text());report.update(result);file.write_text(json.dumps(report,indent=2))
print("RGB-NATIVE-CAPTURE-PARITY",json.dumps(result),flush=True)
