import sys,json,numpy as np
sys.path.insert(0,'.'); sys.path.insert(0,'../pipeline')
import evaluate as ev
from sklearn.linear_model import LogisticRegression
runs=['/home/user/data/runs/B-main-s0','/home/user/data/runs/B-main-s1']
models=[ev.load_model(r)[0] for r in runs]; cls=json.load(open(runs[0]+'/classes.json')); C=len(cls['classes']); mp=ev.sign_mapping(cls)
protos=np.load('/home/user/data/runs/ens/protos.npy'); pol=json.load(open('../models/v3.0/policy-balanced.json')); T=pol['temperature']
meta,L,E,ok=ev.infer(models,'/home/user/data/cache2','val',no_face=True); y,role=ev.labelled(meta,mp,C)
mt,Lt,Et,okt=ev.infer(models,'/home/user/data/cache2','train',no_face=True); _,rt=ev.labelled(mt,mp,C)
def feats(L,E):
    P=ev.softmax_T(L,T); k=P[:,:C]; s=np.sort(k,1); i1=k.argmax(1)
    cos=(E*protos[i1]).sum(1); lse=np.log(np.exp(L[:,:C]/T).sum(1)); ent=-(k*np.log(k+1e-12)).sum(1)
    return np.stack([s[:,-1],s[:,-1]-s[:,-2],P[:,C],cos,lse,ent,np.log(s[:,-1]+1e-9)],1), i1
kn=(role=='known')&ok
Fk,ik=feats(L[kn],E[kn]); yk=y[kn]; sg=np.array([m['signer'] for m in meta])[kn]
um=(role=='unknown_cal')&ok; umt=(rt=='unknown_cal')&okt
Fu=np.concatenate([feats(L[um],E[um])[0],feats(Lt[umt],Et[umt])[0]])
sgu=np.concatenate([np.array([m['signer'] for m in meta])[um], np.array(['train-'+m['signer'] for m in mt])[umt]])
corr=(ik==yk)
# target: accept iff known & correct ; negatives: known-wrong and unknown
X=np.concatenate([Fk,Fu]); Y=np.concatenate([corr,np.zeros(len(Fu),bool)]); isu=np.concatenate([np.zeros(len(Fk),bool),np.ones(len(Fu),bool)])
G=np.concatenate([sg,sgu]); groups=sorted(set(G)); rng=np.random.default_rng(0); rng.shuffle(groups); folds=[groups[i::5] for i in range(5)]
score=np.zeros(len(X))
for f in folds:
    te=np.isin(G,f); m=LogisticRegression(C=1.0,max_iter=2000,class_weight='balanced').fit(X[~te],Y[~te]); score[te]=m.decision_function(X[te])
def at_far(sc, far):
    th=np.quantile(sc[isu],1-far); acc=sc>=th
    return float((acc&Y&~isu).sum()/(~isu).sum()), float((acc&~Y&~isu).sum()/(~isu).sum()), float(acc[isu].mean())
base_sc=np.minimum.reduce([(X[:,0]-pol['min_top1']), (X[:,3]-pol['min_proto']), (pol['max_unknown']-X[:,2])])  # current rule as one score
for far in [0.05,0.10,0.15,0.20,0.25]:
    print(f"FAR {far:.2f} | learned: correct {at_far(score,far)[0]:.3f} wrong {at_far(score,far)[1]:.3f} | current-rule-family: correct {at_far(base_sc,far)[0]:.3f} wrong {at_far(base_sc,far)[1]:.3f} | msp only: correct {at_far(X[:,0],far)[0]:.3f}")
full=LogisticRegression(C=1.0,max_iter=2000,class_weight='balanced').fit(X,Y)
print('coef',dict(zip(['p1','margin','p_unk','proto_cos','logsumexp','entropy','log_p1'],np.round(full.coef_[0],3))),'b',round(float(full.intercept_[0]),3))
json.dump({'features':['p1','margin','p_unk','proto_cos','logsumexp','entropy','log_p1'],'coef':full.coef_[0].tolist(),'intercept':float(full.intercept_[0]),'temperature':T},open('/home/user/data/runs/ens/accept-lr.json','w'))
