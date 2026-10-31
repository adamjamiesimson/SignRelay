"""Independent, small CTC proof of concept over real sequence annotations.
No per-frame labels or OpenFS material. Training/evaluation stays on remote CPU.
"""
import argparse, collections, hashlib, json, os, pathlib, platform, random, time
import numpy as np
import torch
from torch import nn
from torch.nn.utils.rnn import pack_padded_sequence,pad_packed_sequence

CHARS=" ABCDEFGHIJKLMNOPQRSTUVWXYZ"
VOCAB=["<blank>"]+list(CHARS)
class TinyCTC(nn.Module):
 def __init__(self):
  super().__init__();self.project=nn.Sequential(nn.Linear(66,96),nn.LayerNorm(96),nn.ReLU())
  self.gru=nn.GRU(96,96,batch_first=True,bidirectional=True)
  self.head=nn.Linear(192,len(VOCAB))
 def forward(self,x,lengths=None):
  x=self.project(x)
  if lengths is not None:
   x=pack_padded_sequence(x,lengths.cpu(),batch_first=True,enforce_sorted=False)
   x,_=self.gru(x);x,_=pad_packed_sequence(x,batch_first=True)
  else:x,_=self.gru(x)
  return self.head(x)

def decode(logits):
 ids=np.asarray(logits).argmax(-1);last=-1;out=[]
 for value in ids:
  if value!=last and value!=0:out.append(VOCAB[int(value)])
  last=value
 return "".join(out)

def alignment(ref,hyp):
 # Returns edit counts and reference-character outcomes; no string normalisation.
 n,m=len(ref),len(hyp);d=np.zeros((n+1,m+1),np.int32)
 d[:,0]=np.arange(n+1);d[0,:]=np.arange(m+1)
 for i in range(1,n+1):
  for j in range(1,m+1):
   d[i,j]=min(d[i-1,j]+1,d[i,j-1]+1,d[i-1,j-1]+(ref[i-1]!=hyp[j-1]))
 counts=collections.Counter();letters=collections.defaultdict(collections.Counter);i,j=n,m
 while i or j:
  if i and j and d[i,j]==d[i-1,j-1]+(ref[i-1]!=hyp[j-1]):
   op="correct" if ref[i-1]==hyp[j-1] else "substitution";counts[op]+=1;letters[ref[i-1]][op]+=1;i-=1;j-=1
  elif i and d[i,j]==d[i-1,j]+1:counts["deletion"]+=1;letters[ref[i-1]]["deletion"]+=1;i-=1
  else:counts["insertion"]+=1;j-=1
 return counts,letters

def load(root):
 manifest=json.loads((root/"manifest.json").read_text());splits=collections.defaultdict(list)
 for row in manifest["rows"]:
  path=pathlib.Path(row["file"])
  if hashlib.sha256(path.read_bytes()).hexdigest()!=row["featureSha256"]:raise ValueError("Feature digest mismatch")
  z=np.load(path,allow_pickle=False);x=z["features"].astype(np.float32);ref=row["phrase"]
  repeats=sum(a==b for a,b in zip(ref,ref[1:]))
  row=dict(row)
  if len(x)<len(ref)+repeats or row["visibleFrames"]<len(ref):continue
  splits[row["split"]].append((x,ref,row))
  # Only training-side outside-annotation segments become proxy blank examples.
  if row["split"]=="train":
   for name in ("negative_before","negative_after"):
    neg=z[name].astype(np.float32)
    if len(neg)>=4:splits["train"].append((neg,"",{**row,"negative":name}))
 return manifest,splits

def evaluate(model,rows,include_rows=False):
 errors=collections.Counter();letters=collections.defaultdict(collections.Counter);total=exact=0;timings=[];details=[]
 model.eval()
 with torch.no_grad():
  for x,ref,row in rows:
   started=time.perf_counter();lp=model(torch.from_numpy(x)[None])[0].numpy();timings.append((time.perf_counter()-started)*1000)
   hyp=decode(lp);ec,lc=alignment(ref,hyp);errors.update(ec)
   for char,v in lc.items():letters[char].update(v)
   total+=len(ref);exact+=int(ref==hyp)
   if include_rows:details.append({"id":row["id"],"reference":ref,"prediction":hyp,"frames":len(x),"hand":row["side"]})
 e=errors["substitution"]+errors["deletion"]+errors["insertion"]
 return {"sequences":len(rows),"referenceCharacters":total,"edits":e,"cer":e/total if total else None,
  "exactMatches":exact,"sequenceAccuracy":exact/len(rows) if rows else None,"counts":dict(errors),
  "perLetter":{k:dict(v) for k,v in letters.items()},"nativeInferenceMs":{"median":float(np.median(timings)) if timings else None,"p95":float(np.percentile(timings,95)) if timings else None},
  **({"predictions":details} if include_rows else {})}

def main():
 p=argparse.ArgumentParser();p.add_argument("--data",default="work/fingerspelling-data");p.add_argument("--out",default="work/fingerspelling-candidate")
 p.add_argument("--epochs",type=int,default=120);p.add_argument("--batch",type=int,default=16);args=p.parse_args()
 root=pathlib.Path(args.data);out=pathlib.Path(args.out);out.mkdir(parents=True,exist_ok=True)
 torch.set_num_threads(2);random.seed(4826);np.random.seed(4826);torch.manual_seed(4826)
 manifest,splits=load(root)
 if not all(splits[s] for s in ("train","validation","test")):raise ValueError("Empty split")
 train=splits["train"];model=TinyCTC();optimizer=torch.optim.AdamW(model.parameters(),lr=.002,weight_decay=.001)
 criterion=nn.CTCLoss(blank=0,zero_infinity=False);best=float("inf");history=[]
 start=time.monotonic()
 for epoch in range(args.epochs):
  model.train();order=list(range(len(train)));random.shuffle(order);losses=[]
  for at in range(0,len(order),args.batch):
   batch=[train[i] for i in order[at:at+args.batch]]
   lengths=torch.tensor([len(x) for x,_,_ in batch],dtype=torch.long)
   padded=torch.zeros(len(batch),int(lengths.max()),66)
   for j,(x,_,_) in enumerate(batch):padded[j,:len(x)]=torch.from_numpy(x)
   labels=[torch.tensor([VOCAB.index(c) for c in ref],dtype=torch.long) for _,ref,_ in batch]
   targets=torch.cat(labels);target_lengths=torch.tensor([len(x) for x in labels],dtype=torch.long)
   logits=model(padded,lengths);logp=logits.log_softmax(-1).transpose(0,1)
   loss=criterion(logp,targets,lengths,target_lengths)
   if not torch.isfinite(loss):raise ValueError("Non-finite CTC loss")
   optimizer.zero_grad();loss.backward();nn.utils.clip_grad_norm_(model.parameters(),5);optimizer.step();losses.append(float(loss))
  if epoch%10==0 or epoch==args.epochs-1:
   val=evaluate(model,splits["validation"]);value=val["cer"]
   record={"epoch":epoch+1,"loss":float(np.mean(losses)),"validationCer":value,"elapsedSeconds":time.monotonic()-start}
   history.append(record);print("LEARNING",json.dumps(record),flush=True)
   if value<best:
    best=value;torch.save(model.state_dict(),out/"model.pt")
 model.load_state_dict(torch.load(out/"model.pt",weights_only=True));model.eval()
 # Test is touched only once, after validation-selected model selection.
 validation=evaluate(model,splits["validation"],True);test=evaluate(model,splits["test"],True)
 train_eval=evaluate(model,[r for r in train if r[1]],False)
 negatives=[]
 for _,_,row in splits["test"]:
  z=np.load(row["file"],allow_pickle=False)
  for kind in ("negative_before","negative_after"):
   x=z[kind]
   if len(x)>=4:negatives.append((x,"",{**row,"negative":kind}))
 false_accepts=0;negative_characters=0
 with torch.no_grad():
  for x,_,_ in negatives:
   hyp=decode(model(torch.from_numpy(x)[None])[0].numpy())
   false_accepts+=bool(hyp);negative_characters+=len(hyp)
 # Exact native-vs-ONNX logits on real held-out sequences, not synthetic inputs.
 real=splits["test"][:8]
 example=torch.from_numpy(real[0][0])[None]
 torch.onnx.export(model,example,str(out/"model.onnx"),input_names=["features"],output_names=["logits"],
  dynamic_axes={"features":{1:"frames"},"logits":{1:"frames"}},opset_version=17,dynamo=False)
 import onnxruntime as ort
 session=ort.InferenceSession(str(out/"model.onnx"),providers=["CPUExecutionProvider"])
 parity=[]
 for x,ref,row in real:
  native=model(torch.from_numpy(x)[None]).detach().numpy();onnx=session.run(None,{"features":x[None]})[0]
  delta=float(np.max(np.abs(native-onnx)));same=decode(native[0])==decode(onnx[0])
  if delta>1e-4 or not same:raise ValueError("Native/ONNX real-sequence parity failed")
  parity.append({"id":row["id"],"maxAbsLogitError":delta,"sameDecodedText":same})
 # Runner-only real features for browser parity; never part of uploaded artifact.
 real_dir=root/"browser";real_dir.mkdir(exist_ok=True)
 for i,(x,ref,row) in enumerate(real):
  (real_dir/f"{i}.json").write_text(json.dumps({"features":x.tolist(),"native":model(torch.from_numpy(x)[None])[0].detach().tolist(),"reference":ref,"id":row["id"]}))
 report={"kind":"real FSboard raw-video CTC pilot; not a webcam/release claim","dataset":"googleai/fsboard/versions/13",
  "metadataSha256":manifest["metadataSha256"],"taskSha256":manifest["taskSha256"],
  "preprocessing":manifest["features"],"vocabulary":VOCAB,"parameters":sum(p.numel() for p in model.parameters()),
  "modelSha256":hashlib.sha256((out/"model.onnx").read_bytes()).hexdigest(),"modelBytes":(out/"model.onnx").stat().st_size,
  "train":train_eval,"validation":validation,"test":test,
  "negativeProxy":{"source":"real intervals outside publisher annotation; not manually validated non-sign movement","clips":len(negatives),"rawNonemptyPredictions":false_accepts,"rawInsertedCharacters":negative_characters},
  "nativeOnnxParity":parity,"history":history,"trainingSeconds":time.monotonic()-start,
  "environment":{"python":platform.python_version(),"torch":torch.__version__,"platform":platform.platform(),"cpuCount":os.cpu_count(),"torchThreads":torch.get_num_threads()},
  "signerCounts":{s:len({r[2]["signer"] for r in rows}) for s,rows in splits.items()},
  "release":"NO-GO until useful held-out accuracy, calibrated abstention and live preprocessing parity are established"}
 (out/"report.json").write_text(json.dumps(report,indent=2))
 (out/"provenance.json").write_text(json.dumps(manifest,indent=2))
 (out/"vocabulary.json").write_text(json.dumps(VOCAB))
 print("REAL-RESULT",json.dumps({k:report[k] for k in ("parameters","modelBytes","test","negativeProxy","trainingSeconds")}),flush=True)
if __name__=="__main__":main()
