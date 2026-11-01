"""Freeze the preselected architecture/decoder before opening held-out calibration."""
import hashlib,json,pathlib,shutil
root=pathlib.Path("work/upright-models/motion_gru_v3");out=pathlib.Path("work/upright-selected");out.mkdir(parents=True,exist_ok=True)
r=json.loads((root/"report.json").read_text())
assert not r["sealedRolesRead"] and r["rgbPolicy"]=="display-matrix-v1"
assert hashlib.sha256((root/"model.onnx").read_bytes()).hexdigest()==r["modelSha256"]
selection={"criterion":"fixed architecture/beam8 from prior development selection; orientation-correct RGB; checkpoint by new dev greedy CER",
 "experiment":r["experiment"],"decoder":"beam8","modelSha256":r["modelSha256"],"modelBytes":r["modelBytes"],"spec":r["spec"],"planSha256":r["planSha256"],"rgbPolicy":"display-matrix-v1","devCer":r["dev"]["beam8"]["cer"],"sealedDataRead":False}
for name in ("model.onnx","model.pt","report.json"):shutil.copy2(root/name,out/name)
(out/"selection.json").write_text(json.dumps(selection,indent=2))
print(json.dumps(selection,indent=2))
