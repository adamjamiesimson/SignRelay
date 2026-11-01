"""Transparent sequence metrics, alignment confusion and language-free CTC decoding."""
import collections,math
import numpy as np
VOCAB=["<blank>"]+list(" ABCDEFGHIJKLMNOPQRSTUVWXYZ")
def greedy(logits):
 last=-1;out=[]
 for c in np.asarray(logits).argmax(-1):
  if c!=last and c:out.append(VOCAB[int(c)])
  last=c
 return "".join(out)
def logadd(a,b):
 if a==-math.inf:return b
 if b==-math.inf:return a
 m=max(a,b);return m+math.log1p(math.exp(-abs(a-b)))
def beam(logits,width=8):
 x=np.asarray(logits,np.float64);x=x-np.max(x,axis=1,keepdims=True);x-=np.log(np.exp(x).sum(axis=1,keepdims=True))
 beams={(): (0.,-math.inf)}
 for lp in x:
  next_beams={}
  def update(prefix,b=-math.inf,nb=-math.inf):
   ob,on=next_beams.get(prefix,(-math.inf,-math.inf));next_beams[prefix]=(logadd(ob,b),logadd(on,nb))
  choices=np.argsort(lp[1:])[-4:]+1
  for prefix,(pb,pnb) in beams.items():
   total=logadd(pb,pnb);update(prefix,b=total+lp[0])
   for c in choices:
    c=int(c)
    if prefix and c==prefix[-1]:update(prefix,nb=pnb+lp[c]);update(prefix+(c,),nb=pb+lp[c])
    else:update(prefix+(c,),nb=total+lp[c])
  beams=dict(sorted(next_beams.items(),key=lambda r:logadd(*r[1]),reverse=True)[:width])
 prefix=max(beams,key=lambda p:logadd(*beams[p]))
 return "".join(VOCAB[c] for c in prefix)
def align(ref,hyp):
 n,m=len(ref),len(hyp);dp=np.zeros((n+1,m+1),np.int32);dp[:,0]=np.arange(n+1);dp[0,:]=np.arange(m+1)
 for i in range(1,n+1):
  for j in range(1,m+1):dp[i,j]=min(dp[i-1,j]+1,dp[i,j-1]+1,dp[i-1,j-1]+(ref[i-1]!=hyp[j-1]))
 path=[];i,j=n,m
 while i or j:
  if i and j and dp[i,j]==dp[i-1,j-1]+(ref[i-1]!=hyp[j-1]):
   path.append(("correct" if ref[i-1]==hyp[j-1] else "substitution",i-1,j-1));i-=1;j-=1
  elif i and dp[i,j]==dp[i-1,j]+1:path.append(("deletion",i-1,None));i-=1
  else:path.append(("insertion",None,j-1));j-=1
 return path[::-1]
def wilson(k,n,z=1.96):
 if not n:return None
 p=k/n;den=1+z*z/n;center=(p+z*z/(2*n))/den;half=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den
 return [max(0,center-half),min(1,center+half)]
def summarize(rows):
 counts=collections.Counter();letters=collections.defaultdict(collections.Counter);confusion=collections.Counter()
 chars=exact=words=word_edits=repeated=repeat_correct=0
 for row in rows:
  ref,hyp=row["reference"],row["prediction"];path=align(ref,hyp);good={}
  for op,i,j in path:
   counts[op]+=1
   if i is not None:letters[ref[i]][op]+=1
   if op=="correct":good[i]=j
   elif op=="substitution":confusion[(ref[i],hyp[j])]+=1
   elif op=="deletion":confusion[(ref[i],"<delete>")]+=1
   else:confusion[("<insert>",hyp[j])]+=1
  for i in range(len(ref)-1):
   if ref[i]==ref[i+1] and ref[i]!=" ":
    repeated+=1;repeat_correct+=int(i in good and i+1 in good and good[i+1]==good[i]+1)
  chars+=len(ref);exact+=int(ref==hyp);wr=ref.split();wh=hyp.split();words+=len(wr);word_edits+=sum(op!="correct" for op,_,_ in align(wr,wh))
 edits=counts["substitution"]+counts["deletion"]+counts["insertion"]
 return {"sequences":len(rows),"characters":chars,"edits":edits,"cer":edits/chars if chars else None,"exact":exact,"exactAccuracy":exact/len(rows) if rows else None,
  "exactAccuracyWilson95":wilson(exact,len(rows)),"wordEdits":word_edits,"words":words,"wer":word_edits/words if words else None,"counts":dict(counts),
  "perLetter":{c:{**dict(v),"total":sum(v.values()),"recall":v["correct"]/sum(v.values()),"wilson95":wilson(v["correct"],sum(v.values()))} for c,v in sorted(letters.items())},
  "confusion":[{"reference":a,"prediction":b,"count":n} for (a,b),n in confusion.most_common()],
  "repeatedPairs":{"correct":repeat_correct,"total":repeated,"recall":repeat_correct/repeated if repeated else None}}
def confidence_features(logits,x,prediction,presence):
 lp=np.asarray(logits,np.float64);lp-=np.max(lp,axis=1,keepdims=True);lp-=np.log(np.exp(lp).sum(axis=1,keepdims=True));p=np.exp(lp);ids=lp.argmax(-1)
 emit=[];last=-1
 for i,c in enumerate(ids):
  if c and c!=last:emit.append(lp[i,c])
  last=c
 visible=x[:,presence]>0;longest=run=0
 for v in visible:run=0 if v else run+1;longest=max(longest,run)
 # Visual-only summary; never interpreted as calibrated probability by itself.
 return [float(np.mean(emit)) if emit else -20.,float(min(emit)) if emit else -20.,
  float(-(p*lp).sum(axis=1).mean()/math.log(28)),float((ids==0).mean()),len(prediction)/len(lp),float(visible.mean()),longest/len(lp)]
def clustered_interval(rows,field="cer",resamples=1000):
 groups=collections.defaultdict(list)
 for row in rows:groups[row["signer"]].append(row)
 keys=sorted(groups)
 if len(keys)<2:return None
 rng=np.random.default_rng(20261101);values=[]
 for _ in range(resamples):
  sample=[r for i in rng.integers(0,len(keys),len(keys)) for r in groups[keys[int(i)]]]
  if field=="cer":
   edits=sum(r["edits"] for r in sample);chars=sum(len(r["reference"]) for r in sample);values.append(edits/chars)
  else:values.append(np.mean([r["prediction"]==r["reference"] for r in sample]))
 return list(map(float,np.percentile(values,[2.5,97.5])))
