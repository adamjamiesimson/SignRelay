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
pathlib.Path("outputs").mkdir(exist_ok=True);(pathlib.Path("outputs")/("camera-native-"+example+".json")).write_text(json.dumps(report,indent=2))
print("ACTUAL-CAMERA-NATIVE-INPUT",json.dumps({k:v for k,v in report.items() if k not in ("perFrame","rgbSha256")}),flush=True)
