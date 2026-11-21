import sys, json, numpy as np, torch
sys.path.insert(0,'.'); sys.path.insert(0,'../pipeline')
import evaluate as ev
from v3model import prepare_clip, resample_index
from points import MIRROR
torch.set_num_threads(2)
runs=['/home/user/data/runs/B-main-s0','/home/user/data/runs/B-main-s1']
models=[ev.load_model(r)[0] for r in runs]; cls=json.load(open(runs[0]+'/classes.json')); C=len(cls['classes']); mp=ev.sign_mapping(cls)
z=np.load('/home/user/data/cache2/val.npz'); meta=json.load(open('/home/user/data/cache2/val.json')); o=z['offsets']; PT=z['pts']
y,role=ev.labelled(meta,mp,C); K=np.nonzero(role=='known')[0]
def mirror(c): c=c[:,MIRROR].copy(); c[...,0]=-c[...,0]; return c
def speed(c,f):
    n=len(c); m=max(4,int(round(n/f))); return c[np.clip(np.floor(np.arange(m)*(n-1)/max(m-1,1)+0.5).astype(int),0,n-1)]
views={'orig':lambda c:c,'mirror':mirror,'slow':lambda c:speed(c,0.85),'fast':lambda c:speed(c,1.15)}
LP={}
for vn,fn in views.items():
    preps=[]
    for i in K:
        c=PT[o[i]:o[i+1]].astype(np.float32); c[:,55:]=np.nan; preps.append(prepare_clip(fn(c)))
    out=np.full((len(K),C+1),np.nan,np.float32)
    idx=[j for j,p in enumerate(preps) if p is not None]
    with torch.no_grad():
        for s in range(0,len(idx),256):
            b=idx[s:s+256]; x,v,f=(torch.from_numpy(np.stack([preps[j][t] for j in b])) for t in range(3))
            out[b]=torch.stack([torch.log_softmax(m.head(m.embed(x,v,f)),-1) for m in models]).mean(0).numpy()
    LP[vn]=out
yk=y[K]
def acc(L): 
    ok=~np.isnan(L).any(1); return ((L[:,:C].argmax(1)==yk)&ok).mean()
for combo in [['orig'],['orig','mirror'],['orig','slow','fast'],['orig','mirror','slow','fast']]:
    L=np.mean([LP[v] for v in combo],0); print(combo, 'top1 %.4f'%acc(L), 'top5 %.4f'%(((np.argsort(-L[:,:C],1)[:,:5]==yk[:,None]).any(1)).mean()))
