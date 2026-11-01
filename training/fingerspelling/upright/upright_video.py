"""Authoritative display-oriented RGB, preserving decoded presentation times."""
import json,pathlib,struct,subprocess
from fractions import Fraction
import numpy as np
FILTER="scale=w='min(640,iw)':h='min(640,ih)':force_original_aspect_ratio=decrease,setsar=1"
def inspect(path):
 raw=subprocess.check_output(["ffprobe","-v","error","-select_streams","v:0","-show_streams","-show_frames","-show_entries","stream=width,height,avg_frame_rate,start_time,sample_aspect_ratio:stream_side_data:frame=best_effort_timestamp_time","-of","json",str(path)])
 data=json.loads(raw);stream=data["streams"][0]
 if stream.get("sample_aspect_ratio","1:1") not in ("1:1","0:1","N/A"):raise ValueError("Unsupported non-square source pixels")
 start=float(stream.get("start_time","0"));times=[float(f["best_effort_timestamp_time"])-start for f in data["frames"]]
 if not times or any(b<=a for a,b in zip(times,times[1:])):raise ValueError("Non-monotonic decoded source PTS")
 fps=float(Fraction(stream["avg_frame_rate"]))
 if not 10<=fps<=65:raise ValueError("Unexpected source frame rate")
 prefix=["ffmpeg","-nostdin","-v","error","-threads","1","-filter_threads","1","-i",str(path)]
 png=subprocess.check_output(prefix+["-vf",FILTER,"-frames:v","1","-pix_fmt","rgb24","-c:v","png","-threads","1","-f","image2pipe","pipe:1"])
 if png[:8]!=b"\x89PNG\r\n\x1a\n":raise ValueError("Display-oriented first frame missing")
 width,height=struct.unpack(">II",png[16:24])
 if not 1<=width<=640 or not 1<=height<=640:raise ValueError("Invalid display RGB dimensions")
 return {"stream":stream,"times":times,"fps":fps,"width":width,"height":height,"ffmpegVersion":subprocess.check_output(["ffmpeg","-version"],text=True).splitlines()[0]},prefix
def frames(path):
 info,prefix=inspect(path);size=info["width"]*info["height"]*3
 process=subprocess.Popen(prefix+["-vf",FILTER,"-vsync","0","-pix_fmt","rgb24","-threads","1","-f","rawvideo","pipe:1"],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 try:
  for t in info["times"]:
   blob=process.stdout.read(size)
   if len(blob)!=size:raise ValueError("RGB/PTS frame-count mismatch")
   yield t,np.frombuffer(blob,np.uint8).reshape(info["height"],info["width"],3).copy(),info
  if process.stdout.read(1):raise ValueError("Unexpected extra RGB frame")
  if process.wait(timeout=30):raise RuntimeError(process.stderr.read().decode()[-2000:])
 finally:
  if process.poll() is None:process.kill()
  process.stdout.close();process.stderr.close()
