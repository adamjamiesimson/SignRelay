"""Held-signer calibration of exact-sequence correctness, not intent recognition."""
import math
import numpy as np
from metrics import wilson,summarize
POLICY={"minimumTextLength":3,"maximumTextLength":32,"minVisibleFraction":.6,"minFrames":13,"maxFrames":320,
 "minimumPolicyAccepted":20,"targetWilsonLower":.8,"thresholdGrid":[.5,.55,.6,.65,.7,.75,.8,.85,.9,.95]}
def quality(row):
 return POLICY["minFrames"]<=row["frames"]<=POLICY["maxFrames"] and row["visibleFraction"]>=POLICY["minVisibleFraction"] and POLICY["minimumTextLength"]<=len(row["prediction"])<=POLICY["maximumTextLength"]
def fit(rows):
 rows=[r for r in rows if quality(r)]
 if len(rows)<30:raise ValueError("Insufficient eligible calibration-fit examples")
 x=np.asarray([r["confidenceFeatures"] for r in rows],np.float64);y=np.asarray([r["prediction"]==r["reference"] for r in rows],np.float64)
 mean=x.mean(axis=0);std=x.std(axis=0);std[std<1e-6]=1
 a=np.column_stack([np.ones(len(x)),(x-mean)/std]);w=np.zeros(a.shape[1]);penalty=np.eye(len(w));penalty[0,0]=0
 for _ in range(60):
  p=1/(1+np.exp(-np.clip(a@w,-30,30)));gradient=a.T@(p-y)+penalty@w
  hessian=(a.T*(p*(1-p)))@a+penalty+np.eye(len(w))*1e-6
  step=np.linalg.solve(hessian,gradient);w-=step
  if np.max(np.abs(step))<1e-8:break
 return {"kind":"L2 logistic exact-sequence correctness; conditional on fingerspelling input","means":mean.tolist(),"standardDeviations":std.tolist(),"intercept":float(w[0]),"coefficients":w[1:].tolist(),
  "fitSequences":len(rows),"fitCorrect":int(y.sum()),"fitSigners":len({r["signer"] for r in rows}),"featureOrder":["meanEmitLogP","minEmitLogP","meanEntropyNormalized","blankArgmaxFraction","charactersPerFrame","visibleFraction","longestMissingFraction"]}
def probability(row,cal):
 x=(np.asarray(row["confidenceFeatures"])-np.asarray(cal["means"]))/np.asarray(cal["standardDeviations"])
 z=float(cal["intercept"]+x@np.asarray(cal["coefficients"]));return 1/(1+math.exp(-max(-30,min(30,z))))
def diagnose(rows,cal):
 p=np.asarray([probability(r,cal) for r in rows]);y=np.asarray([r["prediction"]==r["reference"] for r in rows],np.float64)
 ece=0;bins=[]
 for lo in np.arange(0,1,.1):
  mask=(p>=lo)&(p<lo+.1)
  if mask.any():
   accuracy=float(y[mask].mean());confidence=float(p[mask].mean());ece+=float(mask.mean())*abs(accuracy-confidence);bins.append({"lower":float(lo),"count":int(mask.sum()),"confidence":confidence,"accuracy":accuracy})
 return {"sequences":len(rows),"brier":float(np.mean((p-y)**2)),"logLoss":float(np.mean(-y*np.log(np.maximum(p,1e-12))-(1-y)*np.log(np.maximum(1-p,1e-12)))),"ece10":ece,"bins":bins}
def choose(rows,cal):
 choices=[]
 for threshold in POLICY["thresholdGrid"]:
  selected=[r for r in rows if quality(r) and probability(r,cal)>=threshold];correct=sum(r["reference"]==r["prediction"] for r in selected);interval=wilson(correct,len(selected))
  choices.append({"threshold":threshold,"accepted":len(selected),"correct":correct,"accuracy":correct/len(selected) if selected else None,"wilson95":interval})
 eligible=[r for r in choices if r["accepted"]>=POLICY["minimumPolicyAccepted"] and r["wilson95"][0]>=POLICY["targetWilsonLower"]]
 winner=max(eligible,key=lambda r:(r["accepted"],r["accuracy"])) if eligible else None
 return {"threshold":winner["threshold"] if winner else None,"policy":POLICY,"grid":choices,
  "scope":"Exploratory threshold selection on three held-out policy signers; Wilson bounds are diagnostics, not a simultaneous or signer-independent guarantee"}
def selective(rows,cal,policy):
 threshold=policy["threshold"];accepted=[r for r in rows if quality(r) and threshold is not None and probability(r,cal)>=threshold]
 return {"threshold":threshold,"accepted":len(accepted),"total":len(rows),"coverage":len(accepted)/len(rows) if rows else None,"metrics":summarize(accepted)}
