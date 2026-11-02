// Recompute every exposed RGB regression result. No selection or training.
// node scripts/diagnostics/summarize-sprint-evidence.mjs [evidence-dir] [output.json]
import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import path from "node:path";
const directory=process.argv[2]??"docs/engineering-sprint-2026-11-02/evidence";
const model="34c823aef5eaa3e4b74c564138a1a224f8c9a8426e0f69a331d5c01fbf53008b";
const known=new Set(["6befb92aee4dcad7bf6ed904","6cd1239964a94fcc9b8eaff0"]);
const sources=[];
async function ledger(name,count){
  const bytes=await readFile(path.join(directory,name)),r=JSON.parse(bytes);
  assert.equal(r.planned,count);assert.equal(r.completed,count);assert.equal(r.complete,true);
  assert.equal(r.cases.length,count);assert.equal(new Set(r.cases.map(c=>c.id)).size,count);
  assert.equal(r.modelSha256,model);assert.ok(r.cases.every(c=>!c.technicalFailure));
  sources.push({file:name,sha256:createHash("sha256").update(bytes).digest("hex")});return r;
}
function distance(a,b){
  let p=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){const n=[i];for(let j=1;j<=b.length;j++)n.push(Math.min(n[j-1]+1,p[j]+1,p[j-1]+(a[i-1]===b[j-1]?0:1)));p=n;}
  return p[b.length];
}
const quantile=(v,q)=>{if(!v.length)return null;return [...v].sort((a,b)=>a-b)[Math.ceil(v.length*q)-1];};
const timing=values=>({samples:values.length,medianMs:quantile(values,.5),p95Ms:quantile(values,.95)});
const output={kind:"Exposed regression recordings only; correlated repetitions, not independent signer or physical camera evidence",modelSha256:model,sources,variants:{}};
let positiveIds,negativeIds;
for(const variant of ["baseline","candidate"]){
  const positive=[];
  for(const repeat of [1,2,3]){
    const r=await ledger(`ci-positive-${variant}-${repeat}.json`,10),ids=r.cases.map(c=>c.id).sort();
    if(positiveIds)assert.deepEqual(ids,positiveIds);else positiveIds=ids;
    positive.push(...r.cases.map(c=>({...c.result,caseId:c.id,repeat})));
  }
  const r=await ledger(`ci-negative-${variant}.json`,29),ids=r.cases.map(c=>c.id).sort();
  if(negativeIds)assert.deepEqual(ids,negativeIds);else negativeIds=ids;
  const negative=r.cases.map(c=>({...c.result,caseId:c.id}));
  const prediction=r=>(r.prediction??"").trim(),reference=r=>r.reference??r.source.reference;
  const metrics=rows=>{const errors=rows.reduce((n,r)=>n+distance(reference(r),prediction(r)),0),characters=rows.reduce((n,r)=>n+reference(r).length,0);
    return {captures:rows.length,exact:rows.filter(r=>prediction(r)===reference(r)).length,characterErrors:errors,referenceCharacters:characters,CER:errors/characters,
      candidates:rows.filter(r=>prediction(r)).length,abstentions:rows.filter(r=>!prediction(r)).length,nativeParity:rows.filter(r=>r.nativeCapturedTextParity).length};};
  output.variants[variant]={positive:metrics(positive),exposedEightClipSubset:metrics(positive.filter(r=>!known.has(r.caseId))),
    sameOutputAllThree:positiveIds.filter(id=>new Set(positive.filter(r=>r.caseId===id).map(prediction)).size===1).length,
    perClip:positiveIds.map(id=>({id,reference:reference(positive.find(r=>r.caseId===id)),predictions:positive.filter(r=>r.caseId===id).map(prediction)})),
    negative:{windows:29,falseCandidates:negative.filter(r=>prediction(r)).length,abstentions:negative.filter(r=>!prediction(r)).length,
      outputs:negative.map(r=>({id:r.caseId,status:r.status,prediction:prediction(r)}))},
    finishToDom:timing(positive.map(r=>r.finishToDomCandidateMs).filter(Number.isFinite)),
    inference:timing(positive.map(r=>r.inferenceMs).filter(Number.isFinite)),
    observedFps:timing(positive.map(r=>r.observedCaptureFps).filter(Number.isFinite))};
}
if(process.argv[3])await writeFile(process.argv[3],JSON.stringify(output,null,2)+"\n");
console.log(JSON.stringify(output,null,2));
