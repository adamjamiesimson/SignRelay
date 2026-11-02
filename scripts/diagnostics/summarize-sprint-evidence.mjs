// Verify additive counts in the public, aggregate-only RGB evidence.
// Pooled timing and repeated-output consistency require local case ledgers.
import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {existsSync} from "node:fs";
import path from "node:path";
const directory=process.argv[2]??"docs/engineering-sprint-2026-11-02/evidence";
const result=JSON.parse(await readFile(path.join(directory,"rgb-summary.json"),"utf8"));
const files=[];
async function aggregate(name,planned){
  const bytes=await readFile(path.join(directory,name)),row=JSON.parse(bytes);
  assert.equal(row.aggregateOnly,true);assert.equal(row.complete,true);
  assert.equal(row.planned,planned);assert.equal(row.completed,planned);
  assert.equal(row.modelSha256,result.modelSha256);
  assert.equal(row.summary.captures,planned);
  for(const v of Object.values(row.summary))assert.ok(Number.isInteger(v)&&v>=0);
  assert.equal(row.summary.candidates+row.summary.abstentions,planned);
  files.push({file:name,sha256:createHash("sha256").update(bytes).digest("hex")});return row.summary;
}
for(const variant of ["baseline","candidate"]){
  const counts={captures:0,exact:0,characterErrors:0,referenceCharacters:0,candidates:0,abstentions:0,nativeParity:0};
  for(const repeat of [1,2,3]){
    const row=await aggregate(`ci-positive-${variant}-${repeat}.json`,10);
    for(const k of Object.keys(counts))counts[k]+=row[k];
  }
  for(const [k,v] of Object.entries(counts))assert.equal(result.variants[variant].positive[k],v);
  assert.equal(result.variants[variant].positive.CER,counts.characterErrors/counts.referenceCharacters);
  const row=await aggregate(`ci-negative-${variant}.json`,29);
  assert.equal(result.variants[variant].negative.falseCandidates,row.candidates);
  assert.equal(result.variants[variant].negative.abstentions,row.abstentions);
}
if(existsSync(path.join(directory,"rare-rgb"))){
  for(const view of ["original","mirrored"])for(const variant of ["baseline","candidate"]){
    const row=await aggregate(`rare-rgb/ci-rare-${view}-${variant}.json`,5);
    const reported=result.rareRgb.find(r=>r.view===view&&r.variant===variant);
    for(const [k,v] of Object.entries(row))assert.equal(reported[k],v);
  }
}
result.sources=files;
result.recomputation="Additive counts verified from public aggregates; pooled timings and repeated-output consistency require locally retained full ledgers.";
if(process.argv[3])await writeFile(process.argv[3],JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify(result,null,2));
