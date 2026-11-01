"""Identical lossless RGB inputs for Python/browser Tasks comparison."""
import base64,hashlib,json,math,pathlib,sys,urllib.request
import cv2,mediapipe as mp,numpy as np,kagglehub
sys.path.insert(0,"training/fingerspelling")
from prepare import metadata,TASK_URL,TASK_SHA
sys.path.insert(0,"training/fingerspelling/upright")
from upright_video import frames as display_frames
root=pathlib.Path("work/rgb");root.mkdir(parents=True,exist_ok=True)
with urllib.request.urlopen(TASK_URL,timeout=45) as response:task=response.read(8373441)
assert len(task)==8373440 and hashlib.sha256(task).hexdigest()==TASK_SHA
(root/"gesture.task").write_bytes(task)
old=json.loads(pathlib.Path("docs/fingerspelling/evidence/fsboard-v13-provenance.json").read_text())
rows=old["rows"]
chosen=[next(r for r in rows if r["id"]=="6befb92aee4dcad7bf6ed904")]
for side in ("Left","Right"):
 chosen.append(next(r for r in rows if r["split"]=="train" and r["side"]==side and ("J" in r["phrase"] or "Z" in r["phrase"]) and r not in chosen))
meta={s:{r["clipFilename"]:r for r in metadata(s)} for s in {r["split"] for r in chosen}}
def detector():
 return mp.tasks.vision.GestureRecognizer.create_from_options(mp.tasks.vision.GestureRecognizerOptions(
  base_options=mp.tasks.BaseOptions(model_asset_path=str(root/"gesture.task")),running_mode=mp.tasks.vision.RunningMode.VIDEO,
  num_hands=2,min_hand_detection_confidence=.55,min_hand_presence_confidence=.55,min_tracking_confidence=.55))
def observe(frames,timestamps,mirror):
 result=[]
 with detector() as model:
  for rgb,stamp in zip(frames,timestamps):
   pixels=np.ascontiguousarray(rgb[:,::-1] if mirror else rgb)
   value=model.recognize_for_video(mp.Image(image_format=mp.ImageFormat.SRGB,data=pixels),stamp)
   result.append([{"side":labels[0].category_name,"score":labels[0].score,"points":[[p.x,p.y,p.z] for p in hand]} for hand,labels in zip(value.hand_landmarks,value.handedness)])
 return result
samples=[]
for source in chosen:
 record=meta[source["split"]][source["source"]]
 path=pathlib.Path(kagglehub.dataset_download("googleai/fsboard/versions/13",path="daun_v3/video_clips/daun_v3-"+source["split"]+"/"+source["source"]))
 data=path.read_bytes()
 assert len(data)==record["clipFileSize"] and hashlib.md5(data,usedforsecurity=False).hexdigest()==record["clipFileMd5"]
 assert hashlib.sha256(data).hexdigest()==source["rawSha256"]
 images=[];timestamps=[];urls=[];next_at=0;previous=-1
 output=root/"images"/source["id"];output.mkdir(parents=True,exist_ok=True)
 for t,rgb,info in display_frames(path):
  assert t>previous;previous=t
  if t+1e-6<next_at:continue
  next_at=(math.floor(t*15+1e-6)+1)/15
  images.append(rgb);timestamps.append(round(t*1000))
  filename=str(len(images)-1)+".png";assert cv2.imwrite(str(output/filename),cv2.cvtColor(rgb,cv2.COLOR_RGB2BGR))
  urls.append("/rgb/images/"+source["id"]+"/"+filename)
 path.unlink()
 samples.append({"id":source["id"],"reference":record["phrase"].upper(),"rawSha256":source["rawSha256"],"rgbPolicy":"display-matrix-v1","returnedCategoryInPilot":source["side"],
  "width":images[0].shape[1],"height":images[0].shape[0],"aspect":images[0].shape[1]/images[0].shape[0],
  "annotationStartMs":1000*(record["annotationStartTimeS"]-record["clipStartTimeS"]),"annotationEndMs":1000*(record["annotationEndTimeS"]-record["clipStartTimeS"]),
  "timestamps":timestamps,"urls":urls,"pixelSha256":{variant:[hashlib.sha256(np.ascontiguousarray(rgb[:,::-1] if variant=="mirrored" else rgb).tobytes()).hexdigest() for rgb in images] for variant in ("original","mirrored")},"native":{"original":observe(images,timestamps,False),"mirrored":observe(images,timestamps,True)}})
(root/"samples.json").write_text(json.dumps(samples))
print("RGB-SOURCES",json.dumps([{k:s[k] for k in ("id","reference","rawSha256","returnedCategoryInPilot","width","height")} for s in samples]),flush=True)
