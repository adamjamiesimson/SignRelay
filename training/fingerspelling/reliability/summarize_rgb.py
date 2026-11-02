"""Recompute descriptive matched RGB results from committed case reports.
Replications of the same clips are correlated; no independent-signer CI is claimed.
"""
import argparse,json,pathlib,statistics
def distance(a,b):
 prev=list(range(len(b)+1))
 for i,x in enumerate(a):
  row=[i+1]
  for j,y in enumerate(b):row.append(min(row[-1]+1,prev[j+1]+1,prev[j]+(x!=y)))
  prev=row
 return prev[-1]
def metric(rows):
 chars=sum(len(r["source"]["reference"]) for r in rows);edits=sum(distance(r["source"]["reference"],r.get("prediction","")) for r in rows)
 return {"attempts":len(rows),"characters":chars,"edits":edits,"cer":edits/chars if chars else None,"exact":sum(r.get("prediction","")==r["source"]["reference"] for r in rows),"candidates":sum(bool(r.get("prediction")) for r in rows),"qualityAbstentions":sum(r["status"]=="abstained-quality" for r in rows)}
def summarize(reports):
 result={"scope":"Exposed convenience regression clips; repeats are not independent observations","perRun":[],"byVariant":{}}
 for r in reports:
  held=[c for c in r["cases"] if c["source"]["caseRole"] in ("final","left_final")]
  result["perRun"].append({"variant":r["variant"],"repeat":r.get("repeat"),"completed":r["completed"],"planned":r["caseCount"],"held":metric(held),"all":metric(r["cases"])})
 for variant in sorted({r["variant"] for r in reports}):
  runs=[r for r in reports if r["variant"]==variant];cases=[c for r in runs for c in r["cases"]]
  ids={c["source"]["id"] for c in cases}
  outputs={id:[c.get("prediction","") for c in cases if c["source"]["id"]==id] for id in sorted(ids)}
  latency=sorted(c["finishToDomCandidateMs"] for c in cases if "finishToDomCandidateMs" in c)
  result["byVariant"][variant]={"all":metric(cases),"held":metric([c for c in cases if c["source"]["caseRole"] in ("final","left_final")]),"stableOutputsAcrossRepeats":sum(len(set(v))==1 for v in outputs.values()),"distinctClips":len(ids),"outputs":outputs,"finishToDomMs":{"median":statistics.median(latency) if latency else None,"maximum":max(latency) if latency else None},"positiveDataScope":"Native primary 384-clip evidence remains separate and unchanged"}
 return result
if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument("files",nargs="+");p.add_argument("--output");a=p.parse_args()
 result=summarize([json.loads(pathlib.Path(f).read_text()) for f in a.files]);s=json.dumps(result,indent=2)
 if a.output:
  pathlib.Path(a.output).parent.mkdir(parents=True,exist_ok=True);pathlib.Path(a.output).write_text(s)
 print(s)
