"""Run a tiny deterministic interruption/recovery check using synthetic data.

Does not train or replace the installed Spanish recognizer.
"""
from pathlib import Path
from types import SimpleNamespace
import csv, json, pickle, subprocess, torch
root=Path('work/lse-resume-check'); media=root/'media'; annotations=root/'annotations'
media.mkdir(parents=True,exist_ok=True);annotations.mkdir(exist_ok=True)
pose=SimpleNamespace(landmark=[SimpleNamespace(x=.3+j*.01,y=.4,z=.001*j) for j in range(33)])
sample=[{'holistic_legacy': {'pose_landmarks':pose}}]
for split, count in [('train',300),('val',12),('test',12)]:
 rows=[]
 for i in range(count):
  name=f'{split}-{i}'
  (media/f'{name}.pkl').write_bytes(pickle.dumps(sample))
  rows.append([name,i])
 with (annotations/f'{split}_labels.csv').open('w') as f:
  csv.writer(f).writerows([['FILENAME','CLASS_ID'],*rows])
with (root/'labels.csv').open('w') as f:
 csv.writer(f).writerows([['CLASS_ID','LABEL'],*[[i,f'CONTROL_{i}'] for i in range(300)]])
def run(name, epochs, resume=False):
 cmd=['work/model-env/bin/python','training/train_swl_lse_onnx.py',str(media),str(annotations),str(root/'labels.csv'),'--epochs',str(epochs),'--checkpoint',str(root/f'{name}.pt'),'--report',str(root/f'{name}.json'),'--output',str(root/name),'--min-validation-accuracy','1']+(['--resume'] if resume else [])
 result=subprocess.run(cmd,capture_output=True,text=True)
 assert result.returncode==1 and 'below the research install gate' in result.stderr,result.stdout+result.stderr
 return torch.load(root/f'{name}.pt',map_location='cpu',weights_only=True)
run('resumed',1)
resumed=run('resumed',2,True)
full=run('full',2)
assert resumed['history']==full['history']
assert all(torch.equal(v,full['model'][k]) for k,v in resumed['model'].items())
assert not (root/'resumed/model.onnx').exists()
report={'purpose':'Synthetic control data tests interruption recovery, not recognition accuracy','device':'cpu','resumedEpochs':2,'checkpointMatchesUninterruptedRun':True,'failedValidationGatePreservesCheckpoint':True,'failedValidationGateProducesNoModel':True}
Path('docs/verification/lse300-training-resume.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
