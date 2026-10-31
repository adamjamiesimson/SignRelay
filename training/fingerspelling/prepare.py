"""Independent FSboard raw-video preparation. No OpenFS code/assets.
CC BY 4.0 data: Google / Deaf Professional Arts Network, FSboard v13.
Metadata SHA-256 is frozen; raw clips must match publisher size AND MD5.
Computed raw SHA-256 is recorded provenance, not a pre-existing frozen hash.
"""
import argparse, collections, concurrent.futures, hashlib, json, os, pathlib, time, urllib.request
import numpy as np
import kagglehub

META = {
 "train": "f85cbf264a4bab08924f5c19c565d3e9b32d4161fabe3004adeb40dd1ba56cdc",
 "validation": "d306aac4c80e7052492ebffdd01f2e8242d09755ff7243824e866360fb609648",
 "test": "94f53f6c9d9199cbc50c5207a31a96d400734e49eac60d4a157fc515a587423b",
}
TASK_SHA = "97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482"
TASK_URL = "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task"
CHARS = " ABCDEFGHIJKLMNOPQRSTUVWXYZ"
def sha(b): return hashlib.sha256(b).hexdigest()

def metadata(split):
 p = pathlib.Path(kagglehub.dataset_download("googleai/fsboard/versions/13", path=f"daun_v3/metadata/daun_v3-{split}.json"))
 b = p.read_bytes()
 if sha(b) != META[split]: raise ValueError("Frozen metadata hash mismatch")
 return json.loads(b)

def features(raw, side, aspect):
 # raw: T x 21 x 3, MediaPipe landmark order 0..20; no rotation normalization.
 # x/z have width scale; y has height scale. Use width units before palm scale.
 out = np.zeros((len(raw), 66), np.float32)
 valid = np.isfinite(raw).all(axis=(1,2))
 if not valid.any(): return out
 hand = raw[valid].copy()
 wrist = hand[:,0].copy()
 rel = hand - wrist[:,None,:]
 rel[:,:,1] /= aspect
 scale = np.linalg.norm(rel[:,9,:2],axis=-1)
 scale = np.maximum(scale,1e-4)
 rel /= scale[:,None,None]
 trajectory = wrist[:,:2] - wrist[0,:2]
 trajectory[:,1] /= aspect
 if side == "Left": rel[:,:,0] *= -1; trajectory[:,0] *= -1
 out[valid,:63] = np.clip(rel.reshape(-1,63),-8,8)
 out[valid,63:65] = np.clip(trajectory*4,-8,8)
 out[valid,65] = 1
 return out

def extract(job):
 import cv2, mediapipe as mp
 split, record, root, task = job
 filename = record["clipFilename"]
 clip = pathlib.Path(kagglehub.dataset_download("googleai/fsboard/versions/13",path=f"daun_v3/video_clips/daun_v3-{split}/{filename}"))
 b = clip.read_bytes()
 if len(b) != record["clipFileSize"] or hashlib.md5(b,usedforsecurity=False).hexdigest() != record["clipFileMd5"]:
  raise ValueError("Publisher video integrity mismatch: "+filename)
 fingerprint = sha(b); del b
 cap = cv2.VideoCapture(str(clip))
 fps = cap.get(cv2.CAP_PROP_FPS)
 if not 10 <= fps <= 65: raise ValueError("Unexpected source frame rate")
 # OpenCV applies orientation metadata by default. Do not rotate twice.
 first_ok, first = cap.read()
 if not first_ok: raise ValueError("Undecodable clip")
 height,width = first.shape[:2]
 aspect = width/height
 options=mp.tasks.vision.GestureRecognizerOptions(
  base_options=mp.tasks.BaseOptions(model_asset_path=task),
  running_mode=mp.tasks.vision.RunningMode.VIDEO, num_hands=2,
  min_hand_detection_confidence=.55,min_hand_presence_confidence=.55,min_tracking_confidence=.55)
 hands={"Left":[],"Right":[]}; timestamps=[]
 started=time.monotonic()
 step = max(1,round(fps/15))
 frame_index=0; image=first
 with mp.tasks.vision.GestureRecognizer.create_from_options(options) as detector:
  while True:
   if frame_index % step == 0:
    at=frame_index/fps
    rgb=cv2.cvtColor(image,cv2.COLOR_BGR2RGB)
    size=max(rgb.shape[:2])
    if size>640: rgb=cv2.resize(rgb,(round(width*640/size),round(height*640/size)))
    result=detector.recognize_for_video(mp.Image(image_format=mp.ImageFormat.SRGB,data=np.ascontiguousarray(rgb)),round(at*1000))
    observed={}
    for points,label in zip(result.hand_landmarks,result.handedness):
     side=label[0].category_name
     if side not in ("Left","Right") or side in observed: continue
     observed[side]=np.array([[p.x,p.y,p.z] for p in points],np.float32)
    for side in hands: hands[side].append(observed.get(side,np.full((21,3),np.nan,np.float32)))
    timestamps.append(at)
   frame_index+=1
   ok,image=cap.read()
   if not ok: break
 cap.release()
 arrays={k:np.asarray(v) for k,v in hands.items()}
 side=max(arrays,key=lambda k:np.isfinite(arrays[k]).all(axis=(1,2)).sum())
 raw=arrays[side]; t=np.asarray(timestamps)
 start=record["annotationStartTimeS"]-record["clipStartTimeS"]
 end=record["annotationEndTimeS"]-record["clipStartTimeS"]
 keep=(t>=start)&(t<=end)
 x=features(raw,side,aspect)
 name=sha(filename.encode())[:24]
 dest=pathlib.Path(root)/split/(name+".npz");dest.parent.mkdir(parents=True,exist_ok=True)
 # Outside publisher annotation is a proxy negative, not manually reviewed no-sign data.
 pre=x[t < start-.2]; post=x[t > end+.2]
 np.savez_compressed(dest,features=x[keep],negative_before=pre,negative_after=post)
 row={"id":name,"file":str(dest),"source":filename,"split":split,"signer":record["signerId"],
  "phrase":record["phrase"].upper(),"rawSha256":fingerprint,"rawBytes":record["clipFileSize"],
  "frames":int(keep.sum()),"visibleFrames":int((x[keep,65]>0).sum()),"side":side,
  "fps":fps,"sampleFps":fps/step,"aspect":aspect,"extractionSeconds":time.monotonic()-started,
  "taskSha256":TASK_SHA,"featureSha256":sha(dest.read_bytes())}
 # Raw licensed videos stay on the runner only, and are released after extraction.
 clip.unlink()
 return row

def main():
 p=argparse.ArgumentParser();p.add_argument("--out",default="work/fingerspelling-data");p.add_argument("--train",type=int,default=512)
 p.add_argument("--validation",type=int,default=64);p.add_argument("--test",type=int,default=96);p.add_argument("--workers",type=int,default=2)
 args=p.parse_args();root=pathlib.Path(args.out);root.mkdir(parents=True,exist_ok=True)
 all_meta={s:metadata(s) for s in META}
 signer_sets={s:{x["signerId"] for x in rows} for s,rows in all_meta.items()}
 for a,b in [("train","validation"),("train","test"),("validation","test")]:
  if signer_sets[a]&signer_sets[b]: raise ValueError(f"Publisher split signer overlap: {a}/{b}")
 task=root/"gesture.task"
 with urllib.request.urlopen(TASK_URL,timeout=45) as r: task_bytes=r.read(8373441)
 if len(task_bytes)!=8373440 or sha(task_bytes)!=TASK_SHA: raise ValueError("MediaPipe task integrity mismatch")
 task.write_bytes(task_bytes)
 selections={}
 held_phrases={x["phrase"].upper() for s in ("validation","test") for x in all_meta[s]}
 for s,rows in all_meta.items():
  rows=[x for x in rows if not x["sensitiveContent"] and x["signingType"]=="fs"
   and 3<=len(x["phrase"])<=18 and set(x["phrase"].upper())<=set(CHARS)
   and 1<=x["annotationEndTimeS"]-x["annotationStartTimeS"]<=16
   and x["clipFileSize"]<=40*1024*1024
   and (s!="train" or x["phrase"].upper() not in held_phrases)]
  # Deterministic per-signer interleaving; no label-dependent test selection.
  groups=collections.defaultdict(list)
  for r in sorted(rows,key=lambda x:sha(("signrelay-v1:"+x["clipFilename"]).encode())): groups[r["signerId"]].append(r)
  balanced=[]
  while groups:
   for signer in sorted(list(groups)):
    balanced.append(groups[signer].pop())
    if not groups[signer]: del groups[signer]
  selections[s]=balanced[:getattr(args,s)]
  if len(selections[s])<getattr(args,s): raise ValueError("Insufficient eligible raw clips")
 print("SELECTION",json.dumps({s:{"clips":len(rows),"signers":len({r["signerId"] for r in rows})} for s,rows in selections.items()}),flush=True)
 jobs=[(s,r,str(root),str(task)) for s,rows in selections.items() for r in rows]
 results=[]
 with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
  for i,row in enumerate(pool.map(extract,jobs)):
   results.append(row)
   if i%16==0: print("EXTRACTED",i+1,"/",len(jobs),flush=True)
 results.sort(key=lambda x:(x["split"],x["id"]))
 manifest={"dataset":"googleai/fsboard","version":13,"license":"CC BY 4.0","metadataSha256":META,
  "mediapipeVersion":"0.10.35","taskSha256":TASK_SHA,"features":"dominant-hand-wrist-palm-width-v1","rows":results}
 (root/"manifest.json").write_text(json.dumps(manifest,indent=2))
 print("PREPARED",len(results),flush=True)
if __name__=="__main__":main()
