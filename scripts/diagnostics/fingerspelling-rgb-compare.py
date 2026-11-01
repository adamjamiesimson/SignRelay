"""Quantify extraction differences; never silently call delegates equivalent."""
import itertools,json,pathlib,sys
import numpy as np,onnxruntime as ort
sys.path.insert(0,"training/fingerspelling/accuracy")
from features import encode
from metrics import greedy
root=pathlib.Path("work/rgb");samples={r["id"]:r for r in json.loads((root/"samples.json").read_text())}
browser=json.loads((root/"browser.json").read_text())
model=ort.InferenceSession("public/models/asl-fingerspelling/fsboard-pilot-v1.onnx",providers=["CPUExecutionProvider"])
rows=[]
def pack(frames,mask):
 counts={s:sum(any(h["side"]==s for h in frame) for frame,k in zip(frames,mask) if k) for s in ("Left","Right")}
 side=max(counts,key=counts.get);raw=[]
 for frame,k in zip(frames,mask):
  if not k:continue
  hand=next((h for h in frame if h["side"]==side),None)
  raw.append(hand["points"] if hand else np.full((21,3),np.nan).tolist())
 return np.asarray(raw,np.float32),side
for case in browser["results"]:
 if "unsupported" in case:rows.append({k:case[k] for k in ("id","delegate","variant","unsupported")});continue
 sample=samples[case["id"]];native=sample["native"][case["variant"]];other=case["frames"]
 assert len(native)==len(other)==len(sample["timestamps"])
 errors=[];pixels=[];categories=matched=only_native=only_browser=both_empty=0
 for a,b in zip(native,other):
  unused=set(range(len(b)))
  if not a and not b:both_empty+=1
  for h in a:
   if not unused:only_native+=1;continue
   j=min(unused,key=lambda i:np.linalg.norm(np.asarray(h["points"][0])-np.asarray(b[i]["points"][0])))
   unused.remove(j);second=b[j];matched+=1;categories+=int(h["side"]==second["side"])
   delta=np.asarray(h["points"])-np.asarray(second["points"]);errors.extend(np.linalg.norm(delta,axis=1).tolist())
   pixels.extend(np.linalg.norm(delta[:,:2]*np.asarray([sample["width"],sample["height"]]),axis=1).tolist())
  only_browser+=len(unused)
 stamps=np.asarray(sample["timestamps"]);mask=(stamps>=sample["annotationStartMs"])&(stamps<=sample["annotationEndMs"])
 a,sa=pack(native,mask);b,sb=pack(other,mask);times=stamps[mask]/1000
 xa=encode(a,times,sa,sample["aspect"],"v2");xb=encode(b,times,sb,sample["aspect"],"v2")
 ha=greedy(model.run(None,{"features":xa[None]})[0][0]);hb=greedy(model.run(None,{"features":xb[None]})[0][0])
 row={"id":case["id"],"delegate":case["delegate"],"variant":case["variant"],"reference":sample["reference"],"rgbFrames":len(native),
  "pairedHands":matched,"sameReturnedCategory":categories,"onlyNativeHands":only_native,"onlyBrowserHands":only_browser,"bothEmptyFrames":both_empty,
  "normalizedXyzEuclideanError":{"mean":float(np.mean(errors)) if errors else None,"p95":float(np.percentile(errors,95)) if errors else None,"max":max(errors) if errors else None},
  "xyPixelError":{"mean":float(np.mean(pixels)) if pixels else None,"p95":float(np.percentile(pixels,95)) if pixels else None,"max":max(pixels) if pixels else None},
  "featureMaxAbsDifference":float(np.max(np.abs(xa-xb))),"nativeReturnedCategory":sa,"browserReturnedCategory":sb,
  "baselineNativeExtractionText":ha,"baselineBrowserExtractionText":hb,"sameDecodedText":ha==hb,
  "browserTaskMs":{"median":float(np.median(case["timings"])),"p95":float(np.percentile(case["timings"],95))}}
 rows.append(row)
report={"kind":"identical lossless real RGB / identical decoded timestamps / reset task per sequence and mirror variant",
 "tasksVersion":"0.10.35","renderer":browser["renderer"],"userAgent":browser["userAgent"],"results":rows,
 "scope":"Numeric image-landmark and returned-category comparison. GPU may be software-rendered. No physical handedness or physical webcam claim.",
 "downstreamComparison":"Both extracted arrays use the identical Python v2 normalization and native baseline ONNX, isolating extraction from JS features/runtime."}
pathlib.Path("outputs").mkdir(exist_ok=True);pathlib.Path("outputs/fingerspelling-rgb-parity.json").write_text(json.dumps(report,indent=2))
print("RGB-EXTRACTION-RESULT",json.dumps(report),flush=True)
