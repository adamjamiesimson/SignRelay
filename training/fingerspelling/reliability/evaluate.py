"""Descriptive, text-free participant metrics and fail-closed future-data validation.
No classifier is trained here; anonymous exports cannot establish signer-disjoint accuracy.
"""
import argparse,json,pathlib,sys
ROLES={"train","dev","calibration","final"}
def validate_manifest(document):
 errors=[];rows=document.get("rows",[]);groups={};ids=set();hashes=set()
 if not rows:return ["BLOCKED: no independently reviewed, licensed/consented positive and negative recordings"]
 for r in rows:
  name=r.get("id","<missing>")
  if not name or name in ids:errors.append(f"{name}: duplicate/missing recording id")
  ids.add(name);sha=r.get("sha256","")
  if len(sha)!=64 or any(c not in "0123456789abcdef" for c in sha) or sha in hashes:errors.append(f"{name}: missing/duplicate SHA-256")
  hashes.add(sha)
  if r.get("role") not in ROLES:errors.append(f"{name}: invalid role")
  if r.get("kind") not in {"positive","negative"}:errors.append(f"{name}: invalid sequence/action label")
  if r.get("reviewStatus")!="independently-human-reviewed" or not r.get("reviewerId"):errors.append(f"{name}: independent temporal annotation review required")
  if not r.get("permissionsReviewed") or not r.get("licenceOrConsent") or r.get("exportScope")!="approved-for-declared-use":errors.append(f"{name}: explicit permissions/consent review required")
  if not r.get("identityGroupingVerified"):errors.append(f"{name}: verified person grouping required for signer-disjoint claims")
  for key in ("sourceGroup","personGroup"):
   group=r.get(key)
   if not group:errors.append(f"{name}: {key} missing");continue
   token=(key,group)
   if token in groups and groups[token]!=r.get("role"):errors.append(f"{name}: {key} leaks across roles")
   groups[token]=r.get("role")
  if r.get("protocol")!="display-matrix-v1/mediapipe-0.10.35/v3":errors.append(f"{name}: preprocessing contract mismatch")
  if r.get("previouslyExposed") and r.get("role")=="final":errors.append(f"{name}: an exposed regression cannot be an untouched final example")
  if r.get("kind")=="positive" and not r.get("reference"):errors.append(f"{name}: sequence transcript required; never invent frame labels")
 for role in sorted(ROLES):
  for kind in ("positive","negative"):
   if not any(r.get("role")==role and r.get("kind")==kind for r in rows):errors.append(f"{role}: no {kind} recordings")
 return errors
def summarize_exports(documents):
 report={"scope":"Participant-corrected descriptive metrics; text omitted so labels cannot be independently re-audited from these files; signer independence unknown","files":len(documents),"positiveAttempts":0,"positiveCandidates":0,"positiveExact":0,"positiveCharacters":0,"positiveEdits":0,"negativeAttempts":0,"negativeCandidates":0,"qualityAbstentions":0,"technicalFailures":0,"cancellations":0}
 for doc in documents:
  if doc.get("schema")!="signrelay-fingerspelling-metrics-v1" or doc.get("textIncluded") is not False:raise ValueError("Unsupported or non-text-free export")
  for t in doc["trials"]:
   status=t["outcome"]
   if status in ("technical-failure","cancelled"):report["technicalFailures" if status=="technical-failure" else "cancellations"]+=1;continue
   if t["kind"]=="positive":
    report["positiveAttempts"]+=1;report["positiveCandidates"]+=bool(t["candidateShown"]);report["positiveExact"]+=t["exact"] is True
    report["positiveCharacters"]+=t["referenceCharacters"];report["positiveEdits"]+=t["edits"] or 0
   elif t["kind"]=="negative":report["negativeAttempts"]+=1;report["negativeCandidates"]+=bool(t["candidateShown"])
   else:raise ValueError("Invalid trial kind")
   report["qualityAbstentions"]+=status=="quality-rejected"
 report["cerAllCompletedPositives"]=report["positiveEdits"]/report["positiveCharacters"] if report["positiveCharacters"] else None
 report["positiveCandidateCoverage"]=report["positiveCandidates"]/report["positiveAttempts"] if report["positiveAttempts"] else None
 report["negativeFalseCandidateFraction"]=report["negativeCandidates"]/report["negativeAttempts"] if report["negativeAttempts"] else None
 return report
if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument("--check-manifest");p.add_argument("--exports",nargs="*");p.add_argument("--output");a=p.parse_args()
 if a.check_manifest:
  errors=validate_manifest(json.loads(pathlib.Path(a.check_manifest).read_text()))
  print(json.dumps({"ok":not errors,"errors":errors},indent=2));sys.exit(bool(errors))
 if not a.exports:p.error("Provide --exports or --check-manifest")
 result=summarize_exports([json.loads(pathlib.Path(x).read_text()) for x in a.exports]);text=json.dumps(result,indent=2)
 if a.output:
  pathlib.Path(a.output).parent.mkdir(parents=True,exist_ok=True);pathlib.Path(a.output).write_text(text)
 print(text)
