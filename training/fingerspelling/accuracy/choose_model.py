"""Select using development data only, before sealed artifacts are downloaded."""
import hashlib,json,pathlib,shutil
root=pathlib.Path("work/candidates");reports=sorted(root.glob("*/report.json"))
assert len(reports)==3,"Require every predeclared configuration"
choices=[];summaries=[];plans=set()
for path in reports:
 report=json.loads(path.read_text());plans.add(report["planSha256"]);model=path.parent/"model.onnx"
 assert hashlib.sha256(model.read_bytes()).hexdigest()==report["modelSha256"]
 for decoder,key in [("greedy","greedy"),("beam8","beam8")]:
  choices.append((report["dev"][key]["cer"],report["modelBytes"],decoder!="greedy",report["experiment"],decoder,path))
 summaries.append({"experiment":report["experiment"],"spec":report["spec"],"bestEpoch":report["bestEpoch"],"quality":report["quality"],"modelBytes":report["modelBytes"],"parameters":report["parameters"],"devGreedy":report["dev"]["greedy"],"devBeam8":report["dev"]["beam8"],"baselineDev":report["baselineDev"]["metrics"],"trainingSeconds":report["trainingSeconds"]})
assert len(plans)==1
cer,size,_,experiment,decoder,path=min(choices)
selected=json.loads(path.read_text());out=pathlib.Path("work/accuracy-selected");out.mkdir(parents=True,exist_ok=True)
for filename in ("model.onnx","model.pt","report.json"):shutil.copy2(path.parent/filename,out/filename)
selection={"criterion":"minimum development CER; ties prefer smaller ONNX then greedy; no dictionary or language model",
 "experiment":experiment,"decoder":decoder,"modelSha256":selected["modelSha256"],"modelBytes":size,"spec":selected["spec"],"planSha256":selected["planSha256"],"devCer":cer,"experiments":summaries,"sealedDataRead":False}
(out/"selection.json").write_text(json.dumps(selection,indent=2))
print("LOCKED-SELECTION",json.dumps(selection),flush=True)
