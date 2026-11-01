"""Same actual camera RGB bytes in native CPU Tasks, including pre-capture history."""
import base64,collections,hashlib,json,pathlib,sys
import cv2,mediapipe as mp,numpy as np
example=sys.argv[1];root=pathlib.Path("work/fingerspelling-camera")/example
value=json.loads((root/"actual-camera-pixels.json").read_text())
options=mp.tasks.vision.GestureRecognizerOptions(base_options=mp.tasks.BaseOptions(model_asset_path="work/fingerspelling-app/gesture.task"),
 running_mode=mp.tasks.vision.RunningMode.VIDEO,num_hands=2,min_hand_detection_confidence=.55,min_hand_presence_confidence=.55,min_tracking_confidence=.55,
 canned_gesture_classifier_options=mp.tasks.components.processors.ClassifierOptions(score_threshold=.55))
observed={};all_hashes=[]
with mp.tasks.vision.GestureRecognizer.create_from_options(options) as model:
 model.recognize_for_video(mp.Image(image_format=mp.ImageFormat.SRGB,data=np.full((256,256,3),[32,36,44],np.uint8)),1)
 for row in value["rows"]:
  if "flat" in row:rgb=np.full((row["height"],row["width"],3),row["flat"][:3],np.uint8)
  else:
   bgr=cv2.imdecode(np.frombuffer(base64.b64decode(row["png"]),np.uint8),cv2.IMREAD_COLOR);rgb=cv2.cvtColor(bgr,cv2.COLOR_BGR2RGB)
  all_hashes.append(hashlib.sha256(rgb.tobytes()).hexdigest())
  result=model.recognize_for_video(mp.Image(image_format=mp.ImageFormat.SRGB,data=np.ascontiguousarray(rgb)),round(row["timestamp"]))
  observed[row["timestamp"]]=[{"side":h[0].category_name,"score":h[0].score} for h in result.handedness]
visual=[]
capture_times={r["timestamp"] for r in value["captureFrames"]}
complex_rows=[r for r in value["rows"] if r["timestamp"] in capture_times and "png" in r]
for index in sorted({len(complex_rows)//3,2*len(complex_rows)//3}):
 if complex_rows:
  row=complex_rows[index];bgr=cv2.imdecode(np.frombuffer(base64.b64decode(row["png"]),np.uint8),cv2.IMREAD_COLOR)
  ok,jpeg=cv2.imencode(".jpg",cv2.resize(bgr,(320,180)),[cv2.IMWRITE_JPEG_QUALITY,65]);assert ok
  visual.append(base64.b64encode(jpeg).decode())
print("ACTUAL-WORKER-RGB-VISUAL",json.dumps({"id":example,"jpeg":visual}),flush=True)
native=[];browser=[]
for frame in value["captureFrames"]:
 native.extend(h["side"] for h in observed[frame["timestamp"]]);browser.extend(h["side"] for h in frame["quality"])
report={"kind":"actual worker-input RGB replay in Python; native VIDEO uses rounded integer milliseconds, browser fractional milliseconds; includes full captured prehistory",
 "source":value["source"],"inputFrames":len(value["rows"]),"captureFrames":len(value["captureFrames"]),"nativeCategories":dict(collections.Counter(native)),"browserCategories":dict(collections.Counter(browser)),
 "perFrame":[{"timestamp":r["timestamp"],"browser":r["quality"],"native":observed[r["timestamp"]]} for r in value["captureFrames"]],"rgbSha256":all_hashes}
# Separate RGB conversion from task-history effects; never change deployed thresholds.
def rgb_row(row):
 if "flat" in row:return np.full((row["height"],row["width"],3),row["flat"][:3],np.uint8)
 bgr=cv2.imdecode(np.frombuffer(base64.b64decode(row["png"]),np.uint8),cv2.IMREAD_COLOR)
 return cv2.cvtColor(bgr,cv2.COLOR_BGR2RGB)
first_complex=next(i for i,r in enumerate(value["rows"]) if "png" in r)
capture_times={r["timestamp"] for r in value["captureFrames"]}
variants={}
for name,history,warm in [("fresh-at-recording-no-warmup",value["rows"][first_complex:],False),("fresh-at-recording-square-warmup",value["rows"][first_complex:],True),("full-history-no-square-warmup",value["rows"],False)]:
 categories=[];visible=0
 with mp.tasks.vision.GestureRecognizer.create_from_options(options) as task:
  if warm:task.recognize_for_video(mp.Image(image_format=mp.ImageFormat.SRGB,data=np.full((256,256,3),[32,36,44],np.uint8)),1)
  for row in history:
   rgb=rgb_row(row)
   result=task.recognize_for_video(mp.Image(image_format=mp.ImageFormat.SRGB,data=np.ascontiguousarray(rgb)),round(row["timestamp"]-history[0]["timestamp"]+2))
   if row["timestamp"] in capture_times:
    visible+=bool(result.hand_landmarks);categories.extend(h[0].category_name for h in result.handedness)
 variants[name]={"visibleFrames":visible,"categories":dict(collections.Counter(categories))}
cap=cv2.VideoCapture(str(root/"verified-source.mp4"));reference_frames=[];next_at=0
with mp.tasks.vision.GestureRecognizer.create_from_options(options) as task:
 reference_categories=[];reference_visible=0;reference_total=0
 while True:
  ok,bgr=cap.read()
  if not ok:break
  seconds=cap.get(cv2.CAP_PROP_POS_MSEC)/1000
  if seconds+1e-6<next_at:continue
  next_at=(int(seconds*15+1e-6)+1)/15
  h,w=bgr.shape[:2]
  if max(h,w)>640:bgr=cv2.resize(bgr,(round(w*640/max(h,w)),round(h*640/max(h,w))))
  rgb=cv2.cvtColor(bgr,cv2.COLOR_BGR2RGB)
  result=task.recognize_for_video(mp.Image(image_format=mp.ImageFormat.SRGB,data=np.ascontiguousarray(rgb)),round(seconds*1000))
  reference_frames.append(rgb)
  if value["source"]["annotationStartSeconds"]<=seconds<=value["source"]["annotationEndSeconds"]:
   reference_total+=1;reference_visible+=bool(result.hand_landmarks);reference_categories.extend(h[0].category_name for h in result.handedness)
cap.release()
variants["original-source-native-reset"]={"frames":reference_total,"visibleFrames":reference_visible,"categories":dict(collections.Counter(reference_categories))}
reference_thumbs=[cv2.resize(rgb,(32,18)).astype(np.float32) for rgb in reference_frames]
diffs=[]
for row in value["rows"][first_complex:]:
 if row["timestamp"] not in capture_times:continue
 actual=cv2.resize(rgb_row(row),(32,18)).astype(np.float32)
 diffs.append(min(float(np.abs(actual-ref).mean()) for ref in reference_thumbs))
variants["actual-vs-original-pixels"]={"metric":"minimum thumbnail RGB MAE over all original source frames; pose timing is matched by image similarity, not assumed","median":float(np.median(diffs)),"max":max(diffs)}
reference_visual=[]
for i in (len(reference_frames)//3,2*len(reference_frames)//3):
 ok,jpeg=cv2.imencode(".jpg",cv2.cvtColor(cv2.resize(reference_frames[i],(320,180)),cv2.COLOR_RGB2BGR),[cv2.IMWRITE_JPEG_QUALITY,65]);assert ok
 reference_visual.append(base64.b64encode(jpeg).decode())
print("ORIGINAL-SOURCE-RGB-VISUAL",json.dumps({"id":example,"jpeg":reference_visual}),flush=True)
print("CAMERA-INPUT-ABLATION",json.dumps({"id":example,"variants":variants}),flush=True)
report["inputAblation"]=variants

pathlib.Path("outputs").mkdir(exist_ok=True);(pathlib.Path("outputs")/("camera-native-"+example+".json")).write_text(json.dumps(report,indent=2))
print("ACTUAL-CAMERA-NATIVE-INPUT",json.dumps({k:v for k,v in report.items() if k not in ("perFrame","rgbSha256")}),flush=True)
