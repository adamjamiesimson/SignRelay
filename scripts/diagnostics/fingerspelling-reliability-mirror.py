"""Horizontal RGB transform of verified exposed recordings; not physical-left evidence."""
import hashlib,json,pathlib,subprocess,sys
root=pathlib.Path("work/fingerspelling-camera")/sys.argv[1]
assert len(sys.argv[1])==24 and all(c in "0123456789abcdef" for c in sys.argv[1])
assert sys.argv[2] in ("original","mirrored")
p=root/"source.json";source=json.loads(p.read_text());video=root/"known-fsboard.y4m"
if sys.argv[2]=="mirrored":
 dest=root/"mirror.y4m"
 subprocess.run(["ffmpeg","-nostdin","-v","error","-y","-i",str(video),"-vf","hflip","-pix_fmt","yuv420p",str(dest)],check=True)
 dest.replace(video)
source["horizontalMirror"]=sys.argv[2]=="mirrored";source["virtualCameraSha256"]=hashlib.sha256(video.read_bytes()).hexdigest()
source["evaluationScope"]="Previously exposed challenge and returned-category regression; mirrored frames are derived from the same real recording, not independent signers"
p.write_text(json.dumps(source));print("MIRROR-CAMERA-SOURCE",json.dumps(source),flush=True)
