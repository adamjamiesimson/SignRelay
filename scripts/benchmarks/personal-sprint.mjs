// Paired, same-process CPU benchmark. Kinematic fixtures, NOT recognition accuracy.
// node --expose-gc scripts/benchmarks/personal-sprint.mjs [--out report.json]
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const baseline = process.env.BENCHMARK_BASELINE_REF ?? "116fe686f7b31ecd00ac57ee4724287affafda0f";
const root = process.cwd(), temp = await mkdtemp(path.join(tmpdir(), "signrelay-sprint-"));
const quantile = (values, q) => [...values].sort((a,b) => a-b)[Math.ceil(values.length*q)-1];
const summary = values => ({ medianMs: quantile(values,.5), p95Ms: quantile(values,.95), samples: values });
const repeats = Number(process.env.BENCHMARK_REPEATS ?? 20);
assert.ok(Number.isInteger(repeats) && repeats >= 2);
try {
  const common = { bundle:true, platform:"node", format:"esm", logLevel:"silent", absWorkingDir:root };
  await build({ ...common, stdin:{contents:execFileSync("git",["show",`${baseline}:lib/personalized-recognition.ts`],{encoding:"utf8"}),
    resolveDir:path.join(root,"lib"), sourcefile:"baseline.ts", loader:"ts"}, outfile:path.join(temp,"baseline.mjs") });
  await build({ ...common, entryPoints:["lib/personalized-recognition.ts"], outfile:path.join(temp,"candidate.mjs") });
  await build({ ...common, entryPoints:["tests/fixtures/asl-motion.ts"], outfile:path.join(temp,"fixtures.mjs") });
  const old = await import(pathToFileURL(path.join(temp,"baseline.mjs")));
  const current = await import(pathToFileURL(path.join(temp,"candidate.mjs")));
  const {makeSign} = await import(pathToFileURL(path.join(temp,"fixtures.mjs")));
  const query = makeSign("HELLO",{duration:3000,count:61});
  const base = old.prepareCalibrationSequence(makeSign("HELLO",{duration:1800,count:37}));
  const rows=[];
  for (const mode of ["easy","near-rivals","spread","matching-last"]) for (const count of [5,10,25,50,100]) {
    const templates=Array.from({length:count},(_,position)=>{
      const i=mode==="matching-last"?(position+1)%count:position;
      const offset=i===0?0:mode==="easy"?1.25+i%3*.15:mode==="near-rivals"?.01+i%5*.018:.12+i%23*.017;
      return {id:`t${i}`,gloss:`WORD${i}`,text:`Word ${i}`,createdAt:i+1,language:"asl",
        frames:base.map(row=>row.map((v,k)=>[0,66,132,173].includes(k)?v:v+offset))};
    });
    const times={baseline:[],candidate:[]},cold={};
    const run=(version,module)=>{
      const start=performance.now(),result=module.recognizePersonalTemplate(query,templates);
      return {ms:performance.now()-start,result};
    };
    const before=run("baseline",old),after=run("candidate",current);
    assert.deepEqual(after.result,before.result);
    cold.baselineMs=before.ms;cold.candidateMs=after.ms;
    for(let i=0;i<3;i++){run("baseline",old);run("candidate",current);}
    for(let i=0;i<repeats;i++) for(const [version,module] of i%2?[["candidate",current],["baseline",old]]:[["baseline",old],["candidate",current]]){
      const result=run(version,module);assert.deepEqual(result.result,before.result);times[version].push(result.ms);
    }
    rows.push({mode,examples:count,cold,baseline:summary(times.baseline),candidate:summary(times.candidate),decision:before.result});
  }
  globalThis.gc?.();const memory=process.memoryUsage();
  const report={kind:"Synthetic personal-sign matching CPU; no camera, signer-accuracy or browser latency claim",baseline,
    candidate:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),workingTreeDiff:execFileSync("git",["diff","--stat"],{encoding:"utf8"}),
    node:process.version,platform:process.platform,cpu:cpus()[0].model,repeats,rows,memoryAfterGc:memory,gcAvailable:!!globalThis.gc,
    script:await readFile(new URL(import.meta.url),"utf8")};
  const output=process.argv.indexOf("--out");
  if(output>=0)await writeFile(process.argv[output+1],JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({...report,script:undefined,rows:rows.map(r=>({...r,baseline:{...r.baseline,samples:undefined},candidate:{...r.candidate,samples:undefined}}))},null,2));
} finally { await rm(temp,{recursive:true,force:true}); }
