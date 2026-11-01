"""Read frozen publisher metadata before selecting or training any new experiment."""
import collections,hashlib,json,pathlib,sys
sys.path.insert(0,"training/fingerspelling")
from prepare import metadata,CHARS,META
old=json.loads(pathlib.Path("docs/fingerspelling/evidence/fsboard-v13-provenance.json").read_text())
old_signers={r["signer"] for r in old["rows"]}
def eligible(r):
 text=r["phrase"].upper()
 return (not r["sensitiveContent"] and r["signingType"]=="fs" and 3<=len(text)<=32 and set(text)<=set(CHARS)
  and 1<=r["annotationEndTimeS"]-r["annotationStartTimeS"]<=16 and r["clipFileSize"]<=40*1024*1024)
out={}
for split in META:
 rows=metadata(split);good=[r for r in rows if eligible(r)]
 counts=collections.Counter(r["signerId"] for r in good)
 out[split]={"allRecords":len(rows),"allSigners":len({r["signerId"] for r in rows}),"eligible":len(good),
  "eligibleSignerCounts":dict(sorted(counts.items())),"neverPreviouslySelectedSigners":sorted(set(counts)-old_signers),
  "characters":dict(collections.Counter("".join(r["phrase"].upper() for r in good))),
  "lengths":dict(sorted(collections.Counter(len(r["phrase"].upper()) for r in good).items())),
  "signingTypes":dict(collections.Counter(r["signingType"] for r in rows)),
  "repeatedLetterSequences":sum(any(a==b and a!=" " for a,b in zip(r["phrase"].upper(),r["phrase"].upper()[1:])) for r in good),
  "multiword":sum(" " in r["phrase"].strip() for r in good),
  "totalEligibleBytes":sum(r["clipFileSize"] for r in good)}
print("ACCURACY-CENSUS",json.dumps(out),flush=True)
