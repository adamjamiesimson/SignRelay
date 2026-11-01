"""Two pre-existing regressions plus fixed held-out export cases, independent of predictions."""
import json,pathlib
rows=[{"id":"6befb92aee4dcad7bf6ed904","role":"known-regression"},{"id":"6cd1239964a94fcc9b8eaff0","role":"known-regression"}]
path=pathlib.Path("docs/fingerspelling/evidence/upright-browser-fixture-index.json")
if path.exists():
 selected=json.loads(path.read_text());assert len(selected)==8
 assert len({r["id"] for r in selected})==8
 rows.extend(selected)
root=pathlib.Path("work/fingerspelling-camera");root.mkdir(parents=True,exist_ok=True)
(root/"cases.json").write_text(json.dumps(rows,indent=2))
(root/"cases.txt").write_text("\n".join(r["id"] for r in rows)+"\n")
print("FIXED-RECORDED-CAMERA-CASES",json.dumps(rows),flush=True)
