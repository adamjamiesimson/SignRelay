"""Bounded, deterministic FSboard v13 cache; no checkpoint or OpenFS dependency."""
import argparse,collections,concurrent.futures,hashlib,json,math,os,pathlib,sys,time,urllib.request
import numpy as np
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
from prepare import metadata,META,TASK_URL,TASK_SHA
HERE=pathlib.Path(__file__).resolve().parent
CONFIG=json.loads((HERE/"config.json").read_text())
def digest(b):return hashlib.sha256(b).hexdigest()
def key(text):return digest((str(CONFIG["seed"])+":"+text).encode())
def eligible(r):
 p=r["phrase"].upper()
 return not r["sensitiveContent"] and r["signingType"]=="fs" and 3<=len(p)<=32 and set(p)<=set(" ABCDEFGHIJKLMNOPQRSTUVWXYZ") and 1<=r["annotationEndTimeS"]-r["annotationStartTimeS"]<=16 and r["clipFileSize"]<=41943040
def balanced(rows,count,tag,weighted=False):
 groups=collections.defaultdict(list)
 for r in rows:
  p=r["phrase"].upper();w=1
  if weighted:w+=3*int("Q" in p or "X" in p)+.5*int("U" in p)+.5*int(any(a==b and a!=" " for a,b in zip(p,p[1:])))
  u=(int(key(tag+":"+r["clipFilename"])[:13],16)+1)/(16**13+1)
  groups[r["signerId"]].append((-math.log(u)/w,r))
 for values in groups.values():values.sort(key=lambda x:x[0],reverse=True)
 result=[]
 while groups and len(result)<count:
  for signer in sorted(list(groups),key=lambda s:key(tag+":signer:"+s)):
   result.append(groups[signer].pop()[1])
   if not groups[signer]:del groups[signer]
   if len(result)==count:break
 return result
def plan():
 all_meta={s:metadata(s) for s in META}
 sets={s:{r["signerId"] for r in rows} for s,rows in all_meta.items()}
 assert not(sets["train"]&sets["validation"] or sets["train"]&sets["test"] or sets["validation"]&sets["test"])
 old=json.loads(pathlib.Path("docs/fingerspelling/evidence/fsboard-v13-provenance.json").read_text())
 inspected={r["source"] for r in old["rows"]}
 val_signers=sorted(sets["validation"]-{"1c15"},key=lambda s:key("roles:"+s))
 assert len(val_signers)==14
 roles={"dev":set(val_signers[:8]),"cal_fit":set(val_signers[8:11]),"cal_policy":set(val_signers[11:]),"left_final":{"1c15"}}
 out={}
 for role,target in [("dev",CONFIG["devTarget"]),("cal_fit",CONFIG["calFitTarget"]),("cal_policy",CONFIG["calPolicyTarget"]),("left_final",CONFIG["leftTarget"])]:
  rows=[r for r in all_meta["validation"] if eligible(r) and r["signerId"] in roles[role] and r["clipFilename"] not in inspected]
  out[role]=balanced(rows,target,role)
  assert len(out[role])==target,(role,len(out[role]))
 pool=[r for r in all_meta["test"] if eligible(r) and r["clipFilename"] not in inspected]
 out["final"]=balanced(pool,CONFIG["finalTarget"],"unseen-final")
 taken={r["clipFilename"] for r in out["final"]}
 # Separately reported rare/double-letter challenge, never pooled with final.
 challenge=[r for r in pool if r["clipFilename"] not in taken and (set(r["phrase"].upper())&set("QUXJZ") or any(a==b and a!=" " for a,b in zip(r["phrase"].upper(),r["phrase"].upper()[1:])))]
 out["challenge"]=balanced(challenge,CONFIG["challengeTarget"],"rare-challenge",True)
 assert len(out["final"])==CONFIG["finalTarget"] and len(out["challenge"])==CONFIG["challengeTarget"]
 held_phrases={r["phrase"].upper() for rows in out.values() for r in rows}
 train=[r for r in all_meta["train"] if eligible(r) and r["phrase"].upper() not in held_phrases]
 out["train"]=balanced(train,CONFIG["trainTarget"],"training",True)
 if len(out["train"])<2048:raise ValueError("Insufficient phrase-disjoint training clips: "+str(len(out["train"])))
 result=[]
 for role,rows in out.items():
  for r in rows:result.append({"role":role,"sourceSplit":"train" if role=="train" else "test" if role in ("final","challenge") else "validation","record":r,"id":digest(r["clipFilename"].encode())[:24]})
 result.sort(key=lambda r:(r["role"],r["id"]))
 role_signers={role:{r["signerId"] for r in rows} for role,rows in out.items()}
 for a in ("train","dev","cal_fit","cal_policy","left_final"):
  for b in role_signers:
   if a!=b:assert not role_signers[a]&role_signers[b],(a,b)
 stats={role:{"clips":len(rows),"signers":len(role_signers[role]),"bytes":sum(r["clipFileSize"] for r in rows)} for role,rows in out.items()}
 stats["train"]["characters"]=dict(collections.Counter("".join(r["phrase"].upper() for r in out["train"])))
 stats["train"]["repeatedSequences"]=sum(any(a==b and a!=" " for a,b in zip(r["phrase"].upper(),r["phrase"].upper()[1:])) for r in out["train"])
 return {"config":CONFIG,"metadataSha256":META,"taskSha256":TASK_SHA,"stats":stats,"roleSigners":{s:sorted(v) for s,v in role_signers.items()},"rows":result}
def extract(job):
 import cv2,mediapipe as mp,kagglehub
 item,output,task=job;record=item["record"];root=pathlib.Path(output)
 clip=pathlib.Path(kagglehub.dataset_download(CONFIG["frozenDataset"],path="daun_v3/video_clips/daun_v3-"+item["sourceSplit"]+"/"+record["clipFilename"]))
 b=clip.read_bytes()
 if len(b)!=record["clipFileSize"] or hashlib.md5(b,usedforsecurity=False).hexdigest()!=record["clipFileMd5"]:raise ValueError("Publisher raw integrity failure")
 source_sha=digest(b);del b
 cap=cv2.VideoCapture(str(clip));fps=cap.get(cv2.CAP_PROP_FPS)
 if not 10<=fps<=65:raise ValueError("Unexpected reported source FPS")
 options=mp.tasks.vision.GestureRecognizerOptions(base_options=mp.tasks.BaseOptions(model_asset_path=task),
  running_mode=mp.tasks.vision.RunningMode.VIDEO,num_hands=2,min_hand_detection_confidence=.55,min_hand_presence_confidence=.55,min_tracking_confidence=.55)
 hands={"Left":[],"Right":[]};times=[];nominal_differences=[];next_at=0;last_pts=-1;index=0;shape=None;started=time.monotonic()
 with mp.tasks.vision.GestureRecognizer.create_from_options(options) as detector:
  while True:
   ok,image=cap.read()
   if not ok:break
   pts=cap.get(cv2.CAP_PROP_POS_MSEC)/1000
   if not np.isfinite(pts) or pts<=last_pts:raise ValueError("Non-monotonic decoded presentation timestamps")
   last_pts=pts
   nominal_differences.append(pts-index/fps);index+=1
   if pts+1e-6<next_at:continue
   next_at=(math.floor(pts*15+1e-6)+1)/15
   height,width=image.shape[:2];shape=width,height
   rgb=cv2.cvtColor(image,cv2.COLOR_BGR2RGB);long=max(height,width)
   if long>640:rgb=cv2.resize(rgb,(round(width*640/long),round(height*640/long)))
   result=detector.recognize_for_video(mp.Image(image_format=mp.ImageFormat.SRGB,data=np.ascontiguousarray(rgb)),round(pts*1000))
   observed={}
   for points,label in zip(result.hand_landmarks,result.handedness):
    side=label[0].category_name
    if side in hands and side not in observed:observed[side]=np.array([[p.x,p.y,p.z] for p in points],np.float32)
   for side in hands:hands[side].append(observed.get(side,np.full((21,3),np.nan,np.float32)))
   times.append(pts)
 cap.release()
 if shape is None:raise ValueError("Undecodable raw clip")
 t=np.asarray(times);arrays={k:np.asarray(v,np.float32) for k,v in hands.items()}
 start=record["annotationStartTimeS"]-record["clipStartTimeS"];end=record["annotationEndTimeS"]-record["clipStartTimeS"]
 keep=(t>=start)&(t<=end)
 if not keep.any():raise ValueError("Empty publisher interval")
 side=max(arrays,key=lambda k:np.isfinite(arrays[k][keep]).all(axis=(1,2)).sum())
 raw=arrays[side];valid=np.isfinite(raw[keep]).all(axis=(1,2))
 dest=root/item["role"]/(item["id"]+".npz");dest.parent.mkdir(parents=True,exist_ok=True)
 np.savez_compressed(dest,raw=raw[keep],times=t[keep],before=raw[t<start-.2],beforeTimes=t[t<start-.2],after=raw[t>end+.2],afterTimes=t[t>end+.2])
 row={"id":item["id"],"role":item["role"],"sourceSplit":item["sourceSplit"],"source":record["clipFilename"],"signer":record["signerId"],"reference":record["phrase"].upper(),
  "file":str(dest),"featureSha256":digest(dest.read_bytes()),"rawSha256":source_sha,"publisherMd5":record["clipFileMd5"],"rawBytes":record["clipFileSize"],"aspect":shape[0]/shape[1],
  "side":side,"frames":int(keep.sum()),"visibleFrames":int(valid.sum()),"nominalFps":fps,"sampleFps":float((keep.sum()-1)/(t[keep][-1]-t[keep][0])) if keep.sum()>1 else 0,
  "maxNominalPtsDifferenceSeconds":float(max(abs(x) for x in nominal_differences)),"extractionSeconds":time.monotonic()-started,"taskSha256":TASK_SHA}
 clip.unlink();return row
def main():
 p=argparse.ArgumentParser();p.add_argument("--shard",type=int);p.add_argument("--shards",type=int,default=8);p.add_argument("--plan-only",action="store_true");args=p.parse_args()
 selection=plan();encoded=json.dumps(selection,sort_keys=True).encode();plan_sha=digest(encoded)
 print("FROZEN-PLAN",json.dumps({"sha256":plan_sha,"stats":selection["stats"],"signerRoles":selection["roleSigners"]}),flush=True)
 root=pathlib.Path("work/accuracy");root.mkdir(parents=True,exist_ok=True)
 if args.plan_only:
  (root/"plan.json").write_bytes(encoded);return
 assert args.shard is not None and 0<=args.shard<args.shards
 task=root/"gesture.task"
 with urllib.request.urlopen(TASK_URL,timeout=45) as response:b=response.read(8373441)
 assert len(b)==8373440 and digest(b)==TASK_SHA
 task.write_bytes(b)
 rows=selection["rows"][args.shard::args.shards];results=[]
 with concurrent.futures.ProcessPoolExecutor(max_workers=2) as pool:
  for i,row in enumerate(pool.map(extract,[(r,str(root),str(task)) for r in rows])):
   results.append(row)
   if i%32==0:print("CACHE-PROGRESS",args.shard,i+1,len(rows),flush=True)
 for kind,roles in [("development",{"train","dev"}),("sealed",{"cal_fit","cal_policy","final","left_final","challenge"})]:
  subset=[r for r in results if r["role"] in roles]
  output=root/kind;output.mkdir(exist_ok=True)
  # Paths remain valid after artifact extraction under the same repository root.
  manifest={"planSha256":plan_sha,"sourceCommit":os.environ.get("GITHUB_SHA","local-reproduction"),"seed":CONFIG["seed"],"dataset":CONFIG["frozenDataset"],"license":"CC BY 4.0","attribution":"Google / Deaf Professional Arts Network, independent MediaPipe extraction",
   "taskSha256":TASK_SHA,"metadataSha256":META,"rows":subset}
  (output/("manifest-"+str(args.shard)+".json")).write_text(json.dumps(manifest,indent=2))
 print("CACHE-DONE",args.shard,len(results),flush=True)
if __name__=="__main__":main()
