import sys, json, numpy as np, torch
sys.path.insert(0,'.'); sys.path.insert(0,'../pipeline')
import evaluate as ev
from v3model import prepare_clip, resample_to_15hz
torch.set_num_threads(1)
runs=['/home/user/data/runs/B-main-s0','/home/user/data/runs/B-main-s1']
models=[ev.load_model(r)[0] for r in runs]; cls=json.load(open(runs[0]+'/classes.json')); C=len(cls['classes']); mp=ev.sign_mapping(cls)
z=np.load('/home/user/data/cache2/val.npz'); meta=json.load(open('/home/user/data/cache2/val.json')); o=z['offsets']; P=z['pts']
y,role=ev.labelled(meta,mp,C); K=np.nonzero(role=='known')[0]
pol=json.load(open('../models/v3.0/policy-balanced.json')); protos=np.load('/home/user/data/runs/ens/protos.npy')
rng=np.random.default_rng(0)
def cam(c, hz, pose_every=1):
    if hz is None: return c
    dur=(len(c)-1)*1000/15
    obs=np.cumsum(rng.uniform(0.75,1.25,int(dur/1000*hz)+3)*1000/hz); obs=np.concatenate([[0.0],obs[obs<=dur]])
    src=c[np.clip(np.round(obs*15/1000).astype(int),0,len(c)-1)].copy()
    if pose_every>1:
        for i in range(len(src)):
            if i%pose_every: src[i,42:55]=src[i-1,42:55]
    return resample_to_15hz(obs,src,0.0,obs[-1])
for name,hz,pe in [('15Hz native',None,1),('12 fps',12,1),('10 fps',10,1),('8 fps',8,1),('6 fps',6,1),('10 fps + pose every 2nd',10,2),('12 fps + pose every 2nd',12,2)]:
    preps=[]
    for i in K:
        c=P[o[i]:o[i+1]].astype(np.float32); c[:,55:]=np.nan
        preps.append(prepare_clip(cam(c,hz,pe)))
    ok=np.array([p is not None for p in preps]); idx=np.nonzero(ok)[0]
    L=[]
    with torch.no_grad():
        for s in range(0,len(idx),256):
            b=[preps[j] for j in idx[s:s+256]]
            x,v,f=(torch.from_numpy(np.stack([q[t] for q in b])) for t in range(3))
            L.append(torch.stack([torch.log_softmax(m.head(m.embed(x,v,f)),-1) for m in models]).mean(0).numpy()
                     if False else None)
            ls=[];es=[]
            for m in models:
                e=m.embed(x,v,f); ls.append(torch.log_softmax(m.head(e),-1)); es.append(torch.nn.functional.normalize(e,dim=-1))
            L[-1]=(torch.stack(ls).mean(0).numpy(), torch.nn.functional.normalize(torch.cat(es,-1),dim=-1).numpy())
    LL=np.concatenate([a for a,_ in L]); EE=np.concatenate([b for _,b in L])
    Pr=ev.softmax_T(LL,pol['temperature']); st,i1=ev.decide(Pr,EE,pol,C,protos)
    yt=y[K][idx]; top1=(Pr[:,:C].argmax(1)==yt)
    print(f"{name:26s} top1 {top1.sum()/len(K):.3f}  accepted-correct {((st=='accepted')&top1).sum()/len(K):.3f}  wrong-accepted {((st=='accepted')&~top1).sum()/len(K):.3f}  no-sign {(~ok).sum()}", flush=True)
