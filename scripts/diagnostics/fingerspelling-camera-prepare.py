"""One known published clip -> real RGB virtual camera, not a new accuracy set."""
import hashlib,json,pathlib,subprocess,sys
import kagglehub
sys.path.insert(0,"training/fingerspelling")
from prepare import metadata
example=sys.argv[1] if len(sys.argv)>1 else "6befb92aee4dcad7bf6ed904"
assert example in ("6befb92aee4dcad7bf6ed904","6cd1239964a94fcc9b8eaff0")
root=pathlib.Path("work/fingerspelling-camera")/example;root.mkdir(parents=True,exist_ok=True)
old=json.loads(pathlib.Path("docs/fingerspelling/evidence/fsboard-v13-provenance.json").read_text())
source=next(r for r in old["rows"] if r["id"]==example)
record=next(r for r in metadata("test") if r["clipFilename"]==source["source"])
path=pathlib.Path(kagglehub.dataset_download("googleai/fsboard/versions/13",path="daun_v3/video_clips/daun_v3-test/"+source["source"]))
blob=path.read_bytes()
assert len(blob)==record["clipFileSize"] and hashlib.md5(blob,usedforsecurity=False).hexdigest()==record["clipFileMd5"]
assert hashlib.sha256(blob).hexdigest()==source["rawSha256"]
lead=16
subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-y","-f","lavfi","-i","color=c=0x20242c:s=640x360:r=30:d="+str(lead),
 "-i",str(path),"-f","lavfi","-i","color=c=0x20242c:s=640x360:r=30:d=4",
 "-filter_complex","[0:v]setsar=1[a];[1:v]scale=640:360:flags=bilinear,fps=30,format=yuv420p,setsar=1[b];[2:v]setsar=1[c];[a][b][c]concat=n=3:v=1:a=0[out]",
 "-map","[out]","-r","30","-pix_fmt","yuv420p",str(root/"known-fsboard.y4m")],check=True)
with (root/"known-fsboard.y4m").open("rb") as stream:header=stream.readline(4096).decode("ascii")
assert " F30:1 " in header,header
config={"y4mHeader":header.strip(),"id":source["id"],"reference":source["phrase"],"rawSha256":source["rawSha256"],"rawBytes":len(blob),"dataset":"googleai/fsboard/versions/13","license":"CC BY 4.0",
 "conversion":"original decoded recording; bilinear 640x360, 30 fps, YUV420p, 16-second flat preamble and 4-second tail; no synthetic signing or injected landmarks",
 "annotationStartSeconds":record["annotationStartTimeS"]-record["clipStartTimeS"],"annotationEndSeconds":record["annotationEndTimeS"]-record["clipStartTimeS"],
 "virtualCameraSha256":hashlib.sha256((root/"known-fsboard.y4m").read_bytes()).hexdigest()}
(root/"source.json").write_text(json.dumps(config));path.unlink()
print("RECORDED-CAMERA-SOURCE",json.dumps(config),flush=True)
