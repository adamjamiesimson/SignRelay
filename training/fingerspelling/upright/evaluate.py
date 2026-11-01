"""Open sealed splits only after the dev-only selection artifact is fixed."""
import collections,gzip,hashlib,io,json,os,pathlib,sys,time
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/"accuracy"))
import numpy as np,onnxruntime as ort,torch
from features import encode
from models import SequenceModel
from metrics import VOCAB,greedy,beam,align,summarize,confidence_features,clustered_interval
from calibration import fit,choose,diagnose,probability,quality,selective
def sha(b):return hashlib.sha256(b).hexdigest()
root=pathlib.Path("work/upright");selected=pathlib.Path("work/upright-selected");out=pathlib.Path("work/upright-evaluation");out.mkdir(parents=True,exist_ok=True)
selection=json.loads((selected/"selection.json").read_text());training=json.loads((selected/"report.json").read_text())
assert sha((selected/"model.onnx").read_bytes())==selection["modelSha256"]
paths=sorted((root/"sealed").glob("manifest-*.json"));assert len(paths)==8
manifests=[json.loads(p.read_text()) for p in paths]
assert {m["planSha256"] for m in manifests}=={selection["planSha256"]}
records=[r for m in manifests for r in m["rows"]]
assert all(r["role"] in ("cal_fit","cal_policy","final","left_final","challenge") for r in records)
assert len({r["id"] for r in records})==len(records)
role_signers={role:{r["signer"] for r in records if r["role"]==role} for role in ("cal_fit","cal_policy","final","left_final","challenge")}
old=json.loads(pathlib.Path("docs/fingerspelling/evidence/fsboard-v13-provenance.json").read_text())
train_signers={r["signer"] for r in old["rows"] if r["split"]=="train"}
dev_signers={r["signer"] for r in training["dev"]["greedyPredictions"]}
for a,sa in role_signers.items():
 assert not sa&train_signers and not sa&dev_signers
 for b,sb in role_signers.items():
  if a!=b and {a,b}!={"final","challenge"}:assert not sa&sb
prior=json.loads(gzip.decompress(pathlib.Path("docs/fingerspelling/evidence/accuracy-v2-provenance.json.gz").read_bytes()))
assert not {r["source"] for r in records}&({r["source"] for r in old["rows"]}|{r["source"] for r in prior["rows"]})
def load(row,base=root):
 path=base/row["role"]/(row["id"]+".npz") if "role" in row else base/(row["id"]+".npz")
 blob=path.read_bytes();assert sha(blob)==row["featureSha256"]
 with np.load(io.BytesIO(blob),allow_pickle=False) as z:return z["raw"].copy(),z["times"].copy()
torch.set_num_threads(2)
options=ort.SessionOptions();options.intra_op_num_threads=2
baseline=ort.InferenceSession("public/models/asl-fingerspelling/fsboard-pilot-v1.onnx",sess_options=options,providers=["CPUExecutionProvider"])
previous_model=ort.InferenceSession("public/models/asl-fingerspelling/fsboard-accuracy-v2.onnx",sess_options=options,providers=["CPUExecutionProvider"])
candidate=ort.InferenceSession(str(selected/"model.onnx"),sess_options=options,providers=["CPUExecutionProvider"])
spec=selection["spec"];decoder=selection["decoder"]
def evaluate(rows,version,session,decode):
 predictions=[]
 for row in rows:
  raw,times=load(row);x=encode(raw,times,row["side"],row["aspect"],version);start=time.perf_counter();lp=session.run(None,{"features":x[None]})[0][0];ms=(time.perf_counter()-start)*1000
  text=greedy(lp) if decode=="greedy" else beam(lp);presence=65 if version=="v2" else 130
  if not np.any(x[:,presence]):text=""
  predictions.append({"id":row["id"],"signer":row["signer"],"category":row["side"],"reference":row["reference"],"prediction":text,
   "frames":len(x),"visibleFraction":float(np.isfinite(raw).all(axis=(1,2)).mean()),"seconds":float(times[-1]-times[0]),"nativeOnnxMs":ms,
   "edits":sum(op!="correct" for op,_,_ in align(row["reference"],text)),"confidenceFeatures":confidence_features(lp,x,text,presence)})
 return predictions
# All hyperparameters and selection are already fixed. Calibrators never see final labels.
cal_fit_records=[r for r in records if r["role"]=="cal_fit"];cal_policy_records=[r for r in records if r["role"]=="cal_policy"]
cal_fit_rows=evaluate(cal_fit_records,spec["features"],candidate,decoder);cal_policy_rows=evaluate(cal_policy_records,spec["features"],candidate,decoder)
calibration=fit(cal_fit_rows);policy=choose(cal_policy_rows,calibration)
print("CALIBRATION-FROZEN",json.dumps({"calibration":calibration,"policy":policy,"policyDiagnostics":diagnose(cal_policy_rows,calibration)}),flush=True)
results={}
def metric(rows):
 value=summarize(rows);value["cerSignerBootstrap95"]=clustered_interval(rows);value["exactSignerBootstrap95"]=clustered_interval(rows,"exact");return value
def paired(a,b):
 assert [(r["id"],r["reference"]) for r in a]==[(r["id"],r["reference"]) for r in b]
 groups=collections.defaultdict(list)
 for x,y in zip(a,b):groups[x["signer"]].append((x,y))
 keys=sorted(groups);rng=np.random.default_rng(20261101);values=[]
 if len(keys)<2:return None
 for _ in range(1000):
  pairs=[pair for i in rng.integers(0,len(keys),len(keys)) for pair in groups[keys[int(i)]]]
  values.append(sum(x["edits"]-y["edits"] for x,y in pairs)/sum(len(x["reference"]) for x,_ in pairs))
 return list(map(float,np.percentile(values,[2.5,97.5])))
all_predictions={}
for role in ("final","left_final","challenge"):
 rows=[r for r in records if r["role"]==role]
 old_rows=evaluate(rows,"v2",baseline,"greedy");new_rows=evaluate(rows,spec["features"],candidate,decoder);greedy_rows=evaluate(rows,spec["features"],candidate,"greedy")
 for r in new_rows:r["estimatedExactProbability"]=probability(r,calibration);r["qualityEligible"]=quality(r);r["qualified"]=quality(r) and policy["threshold"] is not None and r["estimatedExactProbability"]>=policy["threshold"]
 previous_rows=evaluate(rows,"v3",previous_model,"beam8")
 all_predictions[role]={"previousModel":previous_rows,"baseline":old_rows,"selected":new_rows,"selectedGreedy":greedy_rows}
 returned={s:metric([r for r in new_rows if r["category"]==s]) for s in sorted({r["category"] for r in new_rows})}
 speed={}
 for name,lo,hi in [("slow",0,2),("medium",2,4),("fast",4,float("inf"))]:
  subset=[r for r in new_rows if lo<=len(r["reference"])/max(r["seconds"],.01)<hi]
  if subset:speed[name]=metric(subset)
 results[role]={"previousModel":metric(previous_rows),"baseline":metric(old_rows),"selectedGreedy":metric(greedy_rows),"selected":metric(new_rows),
  "baselineMinusSelectedCerPairedSignerBootstrap95":paired(old_rows,new_rows),"qualified":selective(new_rows,calibration,policy),
  "calibrationDiagnostics":diagnose(new_rows,calibration),"returnedCategory":returned,"speedCharactersPerSecond":speed,
  "signers":len({r["signer"] for r in rows}),"physicalHandednessGroundTruthAvailable":False}
# Exact native PyTorch / ONNX comparison and runner-only genuine browser fixtures.
state=torch.load(selected/"model.pt",weights_only=True);native=SequenceModel(spec);native.load_state_dict(state["state"]);native.eval()
real=[r for r in records if r["role"]=="final"][:6]+[r for r in records if r["role"]=="left_final"][:2]
fixtures=out/"browser";fixtures.mkdir(exist_ok=True);parity=[]
for i,row in enumerate(real):
 raw,times=load(row);x=encode(raw,times,row["side"],row["aspect"],spec["features"])
 with torch.no_grad():a=native(torch.from_numpy(x)[None]).numpy()
 b=candidate.run(None,{"features":x[None]})[0];error=float(np.max(np.abs(a-b)))
 assert error<2e-4 and greedy(a[0])==greedy(b[0]),"Native export parity mismatch"
 parity.append({"id":row["id"],"maxAbsLogitError":error,"sameGreedyText":True})
 payload={"id":row["id"],"reference":row["reference"],"side":row["side"],"aspect":row["aspect"],"times":times.tolist(),"raw":np.where(np.isfinite(raw),raw,np.nan).tolist(),
  "features":x.tolist(),"logits":a[0].tolist(),"prediction":greedy(a[0]) if decoder=="greedy" else beam(a[0]),"estimatedExactProbability":None}
 raw_json=[[[float(v) if np.isfinite(v) else None for v in point] for point in frame] for frame in raw];payload["raw"]=raw_json
 fake_row={"confidenceFeatures":confidence_features(a[0],x,payload["prediction"],65 if spec["features"]=="v2" else 130)}
 payload["estimatedExactProbability"]=probability(fake_row,calibration)
 (fixtures/(str(i)+".json")).write_text(json.dumps(payload))
# True action negatives are source/visual reviewed, never used to fit the policy.
negative_manifest=json.loads(pathlib.Path("work/negatives/manifest.json").read_text())
review=json.loads(pathlib.Path("training/fingerspelling/accuracy/negative-review.json").read_text())
negative_rows=[]
for row in negative_manifest["rows"]:
 raw,times=load(row,pathlib.Path("work/negatives"));entry={**row,"reviewedCategory":review["categories"][row["id"]],"visibleActionAcrossReviewedFrames":row["id"] in review["actionVisibleThroughoutReviewedFrames"]}
 for name,session,version,dec in [("previousModel",previous_model,"v3","beam8"),("baseline",baseline,"v2","greedy"),("selected",candidate,spec["features"],decoder)]:
  x=encode(raw,times,row["side"],row["aspect"],version);lp=session.run(None,{"features":x[None]})[0][0]
  text=greedy(lp) if dec=="greedy" else beam(lp);presence=65 if version=="v2" else 130
  fraction=float(np.isfinite(raw).all(axis=(1,2)).mean());visible=np.any(x[:,presence])
  emitted=text if visible else "";gate=len(x)>=13 and fraction>=.6
  value={"prediction":emitted,"rawPrediction":text,"structuralEligible":bool(gate),"visibleFraction":fraction,"frames":len(x)}
  if name=="selected":
   item={"confidenceFeatures":confidence_features(lp,x,emitted,presence),"frames":len(x),"visibleFraction":fraction,"prediction":emitted}
   value["estimatedExactProbability"]=probability(item,calibration);value["qualified"]=bool(gate and quality(item) and policy["threshold"] is not None and value["estimatedExactProbability"]>=policy["threshold"])
  entry[name]=value
 negative_rows.append(entry)
def negatives_summary(rows):
 return {"previousModelStructuralCandidateFalseAccepts":sum(r["previousModel"]["structuralEligible"] and bool(r["previousModel"]["prediction"]) for r in rows),"windows":len(rows),"baselineRawNonempty":sum(bool(r["baseline"]["rawPrediction"]) for r in rows),"selectedRawNonempty":sum(bool(r["selected"]["rawPrediction"]) for r in rows),
  "baselineStructuralCandidateFalseAccepts":sum(r["baseline"]["structuralEligible"] and bool(r["baseline"]["prediction"]) for r in rows),
  "selectedStructuralCandidateFalseAccepts":sum(r["selected"]["structuralEligible"] and bool(r["selected"]["prediction"]) for r in rows),
  "selectedQualifiedCandidateFalseAccepts":sum(r["selected"]["qualified"] for r in rows)}
negative_report={"scope":"29 predetermined source-labelled/AI-contact-sheet-reviewed real video intervals; five sources/two conservative source groups, physical identities unverified. Not a population FPR.",
 "all":negatives_summary(negative_rows),"visibleActionSubset":negatives_summary([r for r in negative_rows if r["visibleActionAcrossReviewedFrames"]]),
 "perSource":{source:negatives_summary([r for r in negative_rows if r["sourceId"]==source]) for source in sorted({r["sourceId"] for r in negative_rows})},
 "rows":negative_rows,"sources":negative_manifest["sources"],"review":review}
# Preserve source/hash provenance, not media or keypoints.
all_manifests=manifests+[json.loads(p.read_text()) for p in sorted((root/"development").glob("manifest-*.json"))]
assert len(all_manifests)==16
provenance={"dataset":"googleai/fsboard/versions/13","license":"CC BY 4.0","attribution":"Google / Deaf Professional Arts Network; independent timestamp-aware MediaPipe extraction",
 "rgbPolicy":"display-matrix-v1","planSha256":selection["planSha256"],"metadataSha256":manifests[0]["metadataSha256"],"taskSha256":manifests[0]["taskSha256"],"rows":[r for m in all_manifests for r in m["rows"]]}
(out/"provenance.json.gz").write_bytes(gzip.compress(json.dumps(provenance,sort_keys=True).encode(),mtime=0))
runtime={"url":"/models/asl-fingerspelling/fsboard-upright-v1.onnx","bytes":selection["modelBytes"],"sha256":selection["modelSha256"],"featureVersion":spec["features"],"features":spec["inputs"],
 "presenceIndex":65 if spec["features"]=="v2" else 130,"decoder":decoder,"calibration":calibration,"policy":policy}
report={"rgbPolicy":"display-matrix-v1","kind":"locked dev selection, disjoint calibration, once-opened fresh final evaluation","sourceCommit":os.environ.get("GITHUB_SHA","local"),"selection":selection,
 "roles":results,"calibration":{"fit":diagnose(cal_fit_rows,calibration),"policy":diagnose(cal_policy_rows,calibration),"model":calibration,"policySelection":policy},
 "predictions":all_predictions,"negativeEvaluation":negative_report,"nativeOnnxParity":parity,"runtime":runtime,
 "dataCaveats":["No signer is novel to the project: all FSboard v13 released signers were previously sampled. All final clips are fresh and final signers are disjoint from this sprint's train/dev/calibration.",
 "Left final has one returned-Left signer, previously represented only in the historical model validation. Physical dominant hand is unknown.",
 "No dictionary or hardcoded phrase correction; visual CTC beam uses no language model. Physical webcam results have not been collected."]}
(out/"report.json").write_text(json.dumps(report,indent=2));(out/"runtime.json").write_text(json.dumps(runtime,indent=2));(out/"negatives.json").write_text(json.dumps(negative_report,indent=2))
for filename in ("model.onnx","selection.json"): (out/filename).write_bytes((selected/filename).read_bytes())
print("SEALED-FINAL-RESULT",json.dumps({"experiment":selection["experiment"],"decoder":decoder,"modelSha256":selection["modelSha256"],"final":results["final"],"leftFinal":results["left_final"],"challenge":results["challenge"],"negatives":negative_report["all"],"policyThreshold":policy["threshold"]}),flush=True)
