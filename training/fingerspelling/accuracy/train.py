"""Controlled small-model experiments; this process cannot read sealed artifacts."""
import argparse,collections,hashlib,io,json,os,pathlib,platform,random,time
import numpy as np
import torch
from torch import nn
from features import encode,augment
from models import SequenceModel,SPECS
from metrics import VOCAB,greedy,beam,align,summarize,confidence_features
def sha(b):return hashlib.sha256(b).hexdigest()
def load_development(root):
 paths=sorted((root/"development").glob("manifest-*.json"))
 if len(paths)!=8:raise ValueError("Require all eight successful development shards")
 manifests=[json.loads(p.read_text()) for p in paths]
 if len({m["planSha256"] for m in manifests})!=1:raise ValueError("Mixed frozen plans")
 if os.environ.get("ACCURACY_PLAN_SHA256",manifests[0]["planSha256"])!=manifests[0]["planSha256"]:raise ValueError("Wrong frozen data plan")
 rows=[r for m in manifests for r in m["rows"]]
 if any(r["role"] not in ("train","dev") for r in rows):raise ValueError("Sealed role in training input")
 if len({r["id"] for r in rows})!=len(rows):raise ValueError("Duplicate cache rows")
 result=collections.defaultdict(list)
 for r in rows:
  path=root/r["role"]/(r["id"]+".npz");b=path.read_bytes()
  if sha(b)!=r["featureSha256"]:raise ValueError("Feature-cache integrity mismatch")
  with np.load(io.BytesIO(b),allow_pickle=False) as z:raw=z["raw"].copy();times=z["times"].copy()
  result[r["role"]].append((raw,times,r))
 if {r[2]["signer"] for r in result["train"]}&{r[2]["signer"] for r in result["dev"]}:raise ValueError("Signer leakage")
 return manifests,result
def predict_rows(predict,rows,version,decoder="greedy"):
 predictions=[];timings=[]
 for raw,times,row in rows:
  x=encode(raw,times,row["side"],row["aspect"],version);started=time.perf_counter();logits=predict(x);timings.append((time.perf_counter()-started)*1000)
  hyp=(greedy if decoder=="greedy" else beam)(logits)
  presence=65 if version=="v2" else 130
  if not np.any(x[:,presence]):hyp=""
  predictions.append({"id":row["id"],"signer":row["signer"],"category":row["side"],"reference":row["reference"],"prediction":hyp,
   "edits":sum(op!="correct" for op,_,_ in align(row["reference"],hyp)),"frames":len(x),"visibleFraction":row["visibleFrames"]/len(x),
   "confidenceFeatures":confidence_features(logits,x,hyp,presence)})
 metrics=summarize(predictions);metrics["nativeInferenceMs"]={"median":float(np.median(timings)),"p95":float(np.percentile(timings,95))}
 return metrics,predictions
def main():
 p=argparse.ArgumentParser();p.add_argument("--experiment",choices=SPECS,required=True);p.add_argument("--epochs",type=int,default=80);p.add_argument("--batch",type=int,default=32);p.add_argument("--resume",action="store_true");args=p.parse_args()
 seed=20261101;torch.set_num_threads(2);torch.manual_seed(seed);random.seed(seed);np.random.seed(seed)
 root=pathlib.Path("work/accuracy");out=pathlib.Path("work/accuracy-models")/args.experiment;out.mkdir(parents=True,exist_ok=True)
 manifests,splits=load_development(root);spec=SPECS[args.experiment]
 selected=len(splits["train"]);train=[]
 for raw,times,row in splits["train"]:
  ref=row["reference"];repeats=sum(a==b for a,b in zip(ref,ref[1:]))
  if len(raw)>=len(ref)+repeats and row["visibleFrames"]>=len(ref):train.append((raw,times,row))
 quality={"selected":selected,"trained":len(train),"signers":len({r[2]["signer"] for r in train}),
  "characters":dict(collections.Counter("".join(r[2]["reference"] for r in train))),
  "returnedHandCategories":dict(collections.Counter(r[2]["side"] for r in train)),
  "frameCountPercentiles":list(map(float,np.percentile([len(r[0]) for r in train],[0,25,50,75,100]))),
  "visibleFractionPercentiles":list(map(float,np.percentile([r[2]["visibleFrames"]/len(r[0]) for r in train],[0,25,50,75,100]))),
  "maxSourceNominalPtsDifferenceSeconds":max(r[2]["maxNominalPtsDifferenceSeconds"] for r in train)}
 print("TRAIN-QUALITY",json.dumps(quality),flush=True)
 model=SequenceModel(spec);optimizer=torch.optim.AdamW(model.parameters(),lr=.001,weight_decay=.003)
 scheduler=torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer,mode="min",factor=.6,patience=2)
 criterion=nn.CTCLoss(blank=0,zero_infinity=False);best=float("inf");stale=0;history=[];first=0;started=time.monotonic()
 if args.resume and (out/"last.pt").exists():
  saved=torch.load(out/"last.pt",weights_only=True)
  if saved["planSha256"]!=manifests[0]["planSha256"] or saved["spec"]!=spec:raise ValueError("Resume source mismatch")
  model.load_state_dict(saved["state"]);optimizer.load_state_dict(saved["optimizer"]);scheduler.load_state_dict(saved["scheduler"])
  torch.set_rng_state(saved["torchRng"]);first=saved["epoch"]+1;best=saved["best"];stale=saved["stale"];history=saved["history"]
 def native(x):
  with torch.no_grad():return model(torch.from_numpy(x)[None])[0].numpy()
 for epoch in range(first,args.epochs):
  model.train();order=list(range(len(train)));random.Random(seed+epoch).shuffle(order);losses=[]
  for offset in range(0,len(order),args.batch):
   batch=[];refs=[]
   for index in order[offset:offset+args.batch]:
    raw,times,row=train[index];rng=np.random.default_rng(seed+epoch*100000+index)
    changed,changed_times=augment(raw,times,rng);ref=row["reference"];required=len(ref)+sum(a==b for a,b in zip(ref,ref[1:]))
    if len(changed)<required:changed,changed_times=raw,times
    x=encode(changed,changed_times,row["side"],row["aspect"],spec["features"])
    batch.append(x);refs.append(ref)
   lengths=torch.tensor([len(x) for x in batch],dtype=torch.long);padded=torch.zeros(len(batch),int(lengths.max()),spec["inputs"])
   for i,x in enumerate(batch):padded[i,:len(x)]=torch.from_numpy(x)
   targets=[torch.tensor([VOCAB.index(c) for c in ref],dtype=torch.long) for ref in refs]
   logits=model(padded,lengths);loss=criterion(logits.log_softmax(-1).transpose(0,1),torch.cat(targets),lengths,torch.tensor([len(t) for t in targets]))
   if not torch.isfinite(loss):raise ValueError("Non-finite CTC loss")
   optimizer.zero_grad();loss.backward();nn.utils.clip_grad_norm_(model.parameters(),5);optimizer.step();losses.append(float(loss))
  if epoch%2==0 or epoch==args.epochs-1:
   model.eval();validation,_=predict_rows(native,splits["dev"],spec["features"]);cer=validation["cer"];scheduler.step(cer)
   improved=cer<best-1e-5
   if improved:
    best=cer;stale=0;torch.save({"spec":spec,"state":model.state_dict(),"epoch":epoch,"planSha256":manifests[0]["planSha256"]},out/"model.pt")
   else:stale+=1
   entry={"epoch":epoch+1,"trainLoss":float(np.mean(losses)),"devCer":cer,"devExact":validation["exactAccuracy"],"learningRate":optimizer.param_groups[0]["lr"],"seconds":time.monotonic()-started}
   history.append(entry);print("CONTROLLED-LEARNING",args.experiment,json.dumps(entry),flush=True)
   torch.save({"spec":spec,"state":model.state_dict(),"optimizer":optimizer.state_dict(),"scheduler":scheduler.state_dict(),"epoch":epoch,"planSha256":manifests[0]["planSha256"],
    "torchRng":torch.get_rng_state(),"best":best,"stale":stale,"history":history},out/"last.pt")
   if epoch>=15 and stale>=8:print("EARLY-STOP",epoch+1,flush=True);break
 saved=torch.load(out/"model.pt",weights_only=True);model.load_state_dict(saved["state"]);model.eval()
 dev_greedy,greedy_rows=predict_rows(native,splits["dev"],spec["features"])
 dev_beam,beam_rows=predict_rows(native,splits["dev"],spec["features"],"beam")
 train_metrics,_=predict_rows(native,train,spec["features"])
 import onnxruntime as ort
 baseline=ort.InferenceSession("public/models/asl-fingerspelling/fsboard-pilot-v1.onnx",providers=["CPUExecutionProvider"])
 baseline_metrics,baseline_rows=predict_rows(lambda x:baseline.run(None,{"features":x[None]})[0][0],splits["dev"],"v2")
 example=encode(splits["dev"][0][0],splits["dev"][0][1],splits["dev"][0][2]["side"],splits["dev"][0][2]["aspect"],spec["features"])
 torch.onnx.export(model,torch.from_numpy(example)[None],str(out/"model.onnx"),input_names=["features"],output_names=["logits"],dynamic_axes={"features":{1:"frames"},"logits":{1:"frames"}},opset_version=17,dynamo=False)
 exported=ort.InferenceSession(str(out/"model.onnx"),providers=["CPUExecutionProvider"]);parity=[]
 for raw,times,row in splits["dev"][:8]:
  x=encode(raw,times,row["side"],row["aspect"],spec["features"]);a=native(x);b=exported.run(None,{"features":x[None]})[0][0];error=float(np.max(np.abs(a-b)))
  if error>2e-4 or greedy(a)!=greedy(b):raise ValueError("Native ONNX real-development parity failure")
  parity.append({"id":row["id"],"maxAbsLogitError":error,"sameText":True})
 report={"experiment":args.experiment,"spec":spec,"seed":seed,"planSha256":manifests[0]["planSha256"],"trainingSource":os.environ.get("GITHUB_SHA","local"),
  "quality":quality,"history":history,"bestEpoch":saved["epoch"]+1,"trainingSeconds":time.monotonic()-started,"training":train_metrics,
  "dev":{"greedy":dev_greedy,"beam8":dev_beam,"greedyPredictions":greedy_rows,"beamPredictions":beam_rows},
  "baselineDev":{"metrics":baseline_metrics,"predictions":baseline_rows},"nativeOnnxParity":parity,
  "parameters":sum(p.numel() for p in model.parameters()),"modelBytes":(out/"model.onnx").stat().st_size,"modelSha256":sha((out/"model.onnx").read_bytes()),
  "environment":{"python":platform.python_version(),"torch":torch.__version__,"threads":torch.get_num_threads(),"platform":platform.platform()},
  "sealedRolesRead":False}
 (out/"report.json").write_text(json.dumps(report,indent=2))
 print("EXPERIMENT-RESULT",json.dumps({k:report[k] for k in ("experiment","spec","bestEpoch","modelBytes","parameters","trainingSeconds")}|{"devGreedyCer":dev_greedy["cer"],"devBeamCer":dev_beam["cer"],"baselineDevCer":baseline_metrics["cer"]}),flush=True)
if __name__=="__main__":main()
