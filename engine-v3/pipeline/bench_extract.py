import sys, time, subprocess, numpy as np, mediapipe as mp
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision
M='/home/user/data/models/'
def decode(path, w, h, fps):
    vf=f"scale={w}:{h}" + (f",fps={fps}" if fps else "")
    t=time.time()
    out=subprocess.run(['ffmpeg','-v','error','-threads','1','-i',path,'-vf',vf,'-f','rawvideo','-pix_fmt','rgb24','-'],capture_output=True,check=True).stdout
    fr=np.frombuffer(out,np.uint8).reshape(-1,h,w,3); return fr, time.time()-t
base=lambda f: mpt.BaseOptions(model_asset_path=M+f, delegate=mpt.BaseOptions.Delegate.CPU)
for path in sys.argv[1:]:
    for (w,h,fps) in [(360,480,None),(360,480,15),(480,640,None)]:
        fr,td=decode(path,w,h,fps)
        hand=vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(base_options=base('hand_landmarker.task'),running_mode=vision.RunningMode.VIDEO,num_hands=2))
        pose=vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(base_options=base('pose_landmarker_lite.task'),running_mode=vision.RunningMode.VIDEO))
        face=vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(base_options=base('face_landmarker.task'),running_mode=vision.RunningMode.VIDEO))
        th=tp=tf=0; nh=0
        for i,f in enumerate(fr):
            im=mp.Image(image_format=mp.ImageFormat.SRGB,data=np.ascontiguousarray(f)); ts=int(i*1000/(fps or 30))
            a=time.time(); r=hand.detect_for_video(im,ts); th+=time.time()-a; nh+=len(r.hand_landmarks)
            a=time.time(); pose.detect_for_video(im,ts); tp+=time.time()-a
            a=time.time(); face.detect_for_video(im,ts); tf+=time.time()-a
        n=len(fr); print(f"{path[-30:]} {w}x{h} fps={fps} n={n} decode={td:.2f}s hand={th/n*1000:.1f}ms pose={tp/n*1000:.1f}ms face={tf/n*1000:.1f}ms hands/frame={nh/n:.2f}")
