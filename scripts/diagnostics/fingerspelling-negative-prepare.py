"""Pinned, separately licensed real-action negatives; evaluation only."""
import base64,hashlib,json,math,pathlib,sys,urllib.parse,urllib.request
import cv2,mediapipe as mp,numpy as np
sys.path.insert(0,"training/fingerspelling")
from prepare import TASK_URL,TASK_SHA
root=pathlib.Path("work/negatives");root.mkdir(parents=True,exist_ok=True)
sources=json.loads(pathlib.Path("training/fingerspelling/accuracy/negative-sources.json").read_text())
with urllib.request.urlopen(TASK_URL,timeout=45) as response:task=response.read(8373441)
assert len(task)==8373440 and hashlib.sha256(task).hexdigest()==TASK_SHA
(root/"gesture.task").write_bytes(task);rows=[];provenance=[]
for source in sources:
 query=urllib.parse.urlencode({"action":"query","format":"json","prop":"imageinfo","iiprop":"url|sha1|size","titles":"File:"+source["file"]})
 request=urllib.request.Request("https://commons.wikimedia.org/w/api.php?"+query,headers={"User-Agent":"SignRelayResearch/0.1 (https://github.com/adamjamiesimson/SignRelay)"})
 with urllib.request.urlopen(request,timeout=60) as response:info=json.load(response)
 item=next(iter(info["query"]["pages"].values()))["imageinfo"][0]
 if item["size"]!=source["bytes"] or item["sha1"]!=source["sha1"]:raise ValueError("Publisher snapshot mismatch")
 request=urllib.request.Request(item["url"],headers={"User-Agent":"SignRelayResearch/0.1 (https://github.com/adamjamiesimson/SignRelay)"})
 with urllib.request.urlopen(request,timeout=60) as response:content=response.read(source["bytes"]+1)
 if len(content)!=source["bytes"] or hashlib.sha1(content,usedforsecurity=False).hexdigest()!=source["sha1"]:raise ValueError("Frozen video integrity mismatch")
 path=root/(source["id"]+pathlib.Path(source["file"]).suffix);path.write_bytes(content)
 source={**source,"url":item["url"],"sha256":hashlib.sha256(content).hexdigest()};provenance.append(source)
 cap=cv2.VideoCapture(str(path));frames=[];times=[];next_at=0;last=-1
 while True:
  ok,bgr=cap.read()
  if not ok:break
  t=cap.get(cv2.CAP_PROP_POS_MSEC)/1000
  if t<=last:raise ValueError("Non-monotonic negative timestamps")
  last=t
  if t+1e-6<next_at:continue
  next_at=(math.floor(t*15+1e-6)+1)/15
  h,w=bgr.shape[:2]
  if max(h,w)>640:bgr=cv2.resize(bgr,(round(w*640/max(h,w)),round(h*640/max(h,w))))
  frames.append(bgr);times.append(t)
 cap.release();path.unlink();times=np.asarray(times)
 sheet=np.full((len(source["windows"])*112,800,3),255,np.uint8)
 for wi,(start,end) in enumerate(source["windows"]):
  keep=np.flatnonzero((times>=start)&(times<end));assert len(keep)>10
  hands={"Left":[],"Right":[]}
  options=mp.tasks.vision.GestureRecognizerOptions(base_options=mp.tasks.BaseOptions(model_asset_path=str(root/"gesture.task")),running_mode=mp.tasks.vision.RunningMode.VIDEO,
   num_hands=2,min_hand_detection_confidence=.55,min_hand_presence_confidence=.55,min_tracking_confidence=.55)
  with mp.tasks.vision.GestureRecognizer.create_from_options(options) as model:
   for index in keep:
    rgb=np.ascontiguousarray(cv2.cvtColor(frames[index],cv2.COLOR_BGR2RGB))
    value=model.recognize_for_video(mp.Image(image_format=mp.ImageFormat.SRGB,data=rgb),round(times[index]*1000))
    observed={labels[0].category_name:np.asarray([[p.x,p.y,p.z] for p in hand],np.float32) for hand,labels in zip(value.hand_landmarks,value.handedness)}
    for side in hands:hands[side].append(observed.get(side,np.full((21,3),np.nan,np.float32)))
  arrays={k:np.asarray(v) for k,v in hands.items()};side=max(arrays,key=lambda k:np.isfinite(arrays[k]).all(axis=(1,2)).sum())
  id=source["id"]+"-"+str(wi);dest=root/(id+".npz");np.savez_compressed(dest,raw=arrays[side],times=times[keep])
  row={"id":id,"sourceGroup":source["sourceGroup"],"sourceId":source["id"],"signer":"identity-unverified:"+source["sourceGroup"],"reference":"","category":source["category"],"start":start,"end":end,
   "side":side,"frames":len(keep),"visibleFrames":int(np.isfinite(arrays[side]).all(axis=(1,2)).sum()),"aspect":frames[keep[0]].shape[1]/frames[keep[0]].shape[0],"file":str(dest),
   "featureSha256":hashlib.sha256(dest.read_bytes()).hexdigest(),"sourceSha256":source["sha256"],"reviewStatus":"pending visual review; source action metadata + ASL captions"}
  rows.append(row)
  cv2.putText(sheet,id+" "+str(start)+"-"+str(end)+"s",(4,wi*112+15),cv2.FONT_HERSHEY_SIMPLEX,.45,(0,0,0),1)
  for j,index in enumerate(np.linspace(keep[0],keep[-1],5).astype(int)):
   thumb=cv2.resize(frames[index],(160,90));sheet[wi*112+21:wi*112+111,j*160:(j+1)*160]=thumb
 ok,jpeg=cv2.imencode(".jpg",sheet,[cv2.IMWRITE_JPEG_QUALITY,70]);assert ok
 print("NEGATIVE-VISUAL-REVIEW",json.dumps({"source":source["id"],"sha256":hashlib.sha256(jpeg).hexdigest(),"base64":base64.b64encode(jpeg).decode()}),flush=True)
(root/"manifest.json").write_text(json.dumps({"kind":"real licensed action intervals; source-level groups, physical identities unverified; evaluation only","sources":provenance,"rows":rows},indent=2))
print("REAL-NEGATIVE-CACHE",json.dumps({"clips":len(rows),"sources":len(sources),"sourceGroups":2,"categories":sorted({r["category"] for r in rows})}),flush=True)
