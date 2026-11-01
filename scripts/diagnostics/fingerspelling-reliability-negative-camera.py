"""Frozen licensed ordinary-action windows to actual RGB virtual camera. Regression only."""
import hashlib,json,pathlib,subprocess,sys,urllib.parse,urllib.request
sys.path.insert(0,"training/fingerspelling/upright")
from upright_video import inspect
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
info,_=inspect(path);w,h=info["width"],info["height"];w-=w%2;h-=h%2
duration=row["end"]-row["start"]
subprocess.run(["ffmpeg","-nostdin","-hide_banner","-loglevel","error","-y","-f","lavfi","-i",f"color=c=0x20242c:s={w}x{h}:r=30:d=16","-ss",str(row["start"]),"-t",str(duration),"-i",str(path),
 "-f","lavfi","-i",f"color=c=0x20242c:s={w}x{h}:r=30:d=4","-filter_complex",f"[0:v]setsar=1[a];[1:v]scale={w}:{h}:flags=bilinear,fps=30,format=yuv420p,setsar=1,setpts=PTS-STARTPTS[b];[2:v]setsar=1[c];[a][b][c]concat=n=3:v=1:a=0[out]","-map","[out]","-r","30","-pix_fmt","yuv420p",str(root/"known-fsboard.y4m")],check=True)
config={**row,"reference":"","signer":"identity-unverified:"+source["sourceGroup"],"caseRole":"regression-negative","source":source,"dataset":"Wikimedia Commons frozen action windows; evaluation only","license":source.get("license"),"rawSha256":hashlib.sha256(content).hexdigest(),"rawBytes":len(content),"annotationStartSeconds":0,"annotationEndSeconds":duration,"displayDimensions":[w,h],"virtualCameraSha256":hashlib.sha256((root/"known-fsboard.y4m").read_bytes()).hexdigest(),"review":"source action metadata/captions + previous five-frame AI review; not independent expert temporal labels"}
(root/"source.json").write_text(json.dumps(config))
print("RECORDED-NEGATIVE-SOURCE",json.dumps(config),flush=True)
