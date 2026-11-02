"""Frozen licensed ordinary-action windows to actual RGB virtual camera. Regression only."""
import hashlib,json,pathlib,subprocess,struct,sys,urllib.parse,urllib.request
sources=json.loads(pathlib.Path("training/fingerspelling/accuracy/negative-sources.json").read_text())
case=sys.argv[1] if len(sys.argv)>1 else "--catalog"
catalog=[{"id":s["id"]+"-"+str(i),"sourceId":s["id"],"start":a,"end":b} for s in sources for i,(a,b) in enumerate(s["windows"])]
if case=="--catalog":
 root=pathlib.Path("work/fingerspelling-camera");root.mkdir(parents=True,exist_ok=True)
 (root/"negative-cases.json").write_text(json.dumps(catalog,indent=2));(root/"negative-cases.txt").write_text("\n".join(r["id"] for r in catalog)+"\n")
 print("FIXED-NEGATIVE-CATALOG",json.dumps(catalog));sys.exit()
row=next(r for r in catalog if r["id"]==case);source=next(s for s in sources if s["id"]==row["sourceId"])
root=pathlib.Path("work/fingerspelling-camera")/case;root.mkdir(parents=True,exist_ok=True)
cache=pathlib.Path("work/reliability-negative-sources");cache.mkdir(parents=True,exist_ok=True)
query=urllib.parse.urlencode({"action":"query","format":"json","prop":"imageinfo","iiprop":"url|sha1|size","titles":"File:"+source["file"]})
request=urllib.request.Request("https://commons.wikimedia.org/w/api.php?"+query,headers={"User-Agent":"SignRelayResearch/0.1 (https://github.com/adamjamiesimson/SignRelay)"})
with urllib.request.urlopen(request,timeout=60) as response:info=json.load(response)
item=next(iter(info["query"]["pages"].values()))["imageinfo"][0]
assert item["size"]==source["bytes"] and item["sha1"]==source["sha1"],"Publisher source changed"
path=cache/(source["id"]+pathlib.Path(source["file"]).suffix)
if not path.exists():
 request=urllib.request.Request(item["url"],headers={"User-Agent":"SignRelayResearch/0.1 (https://github.com/adamjamiesimson/SignRelay)"})
 with urllib.request.urlopen(request,timeout=60) as response:content=response.read(source["bytes"]+1)
 path.write_bytes(content)
content=path.read_bytes();assert len(content)==source["bytes"] and hashlib.sha1(content,usedforsecurity=False).hexdigest()==source["sha1"]
probe=json.loads(subprocess.check_output(["ffprobe","-v","error","-select_streams","v:0","-show_entries","stream=width,height,avg_frame_rate,r_frame_rate,sample_aspect_ratio:stream_side_data=rotation","-of","json",str(path)]))["streams"][0]
timing=json.loads(subprocess.check_output(["ffprobe","-v","error","-select_streams","v:0","-show_frames","-show_entries","frame=best_effort_timestamp_time","-of","json",str(path)]))
pts=[float(f["best_effort_timestamp_time"]) for f in timing["frames"]]
assert len(pts)>1 and all(b>a for a,b in zip(pts,pts[1:])),"Negative source must have strictly monotonic decoded PTS"
assert probe.get("sample_aspect_ratio","1:1") in ("1:1","0:1","N/A"),"Review non-square negative source separately"
scale="scale=w='min(640,iw)':h='min(640,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1"
png=subprocess.check_output(["ffmpeg","-nostdin","-v","error","-i",str(path),"-vf",scale,"-frames:v","1","-f","image2pipe","-c:v","png","-threads","1","pipe:1"])
assert png[:8]==b"\\x89PNG\\r\\n\\x1a\\n".decode("unicode_escape").encode("latin1")
w,h=struct.unpack(">II",png[16:24])
duration=row["end"]-row["start"]
subprocess.run(["ffmpeg","-nostdin","-hide_banner","-loglevel","error","-y","-f","lavfi","-i",f"color=c=0x20242c:s={w}x{h}:r=30:d=16","-ss",str(row["start"]),"-t",str(duration),"-i",str(path),
 "-f","lavfi","-i",f"color=c=0x20242c:s={w}x{h}:r=30:d=4","-filter_complex",f"[0:v]setsar=1[a];[1:v]scale={w}:{h}:flags=bilinear,fps=30,format=yuv420p,setsar=1,setpts=PTS-STARTPTS[b];[2:v]setsar=1[c];[a][b][c]concat=n=3:v=1:a=0[out]","-map","[out]","-r","30","-pix_fmt","yuv420p",str(root/"known-fsboard.y4m")],check=True)
config={**row,"reference":"","signer":"identity-unverified:"+source["sourceGroup"],"caseRole":"regression-negative","source":source,"dataset":"Wikimedia Commons frozen action windows; evaluation only","license":source.get("license"),"rawSha256":hashlib.sha256(content).hexdigest(),"rawBytes":len(content),"annotationStartSeconds":0,"annotationEndSeconds":duration,"displayDimensions":[w,h],"sourceStream":probe,"sourcePts":{"frames":len(pts),"duration":pts[-1]-pts[0],"minimumStep":min(b-a for a,b in zip(pts,pts[1:]))},"virtualCameraSha256":hashlib.sha256((root/"known-fsboard.y4m").read_bytes()).hexdigest(),"review":"source action metadata/captions + previous five-frame AI review; not independent expert temporal labels"}
(root/"source.json").write_text(json.dumps(config))
print("RECORDED-NEGATIVE-SOURCE",json.dumps(config),flush=True)
