// Retention diagnostic in actual matching worker threads. Forced GC separates
// retained JS objects from RSS/high-water allocation; it is NOT app latency.
// node --expose-gc scripts/benchmarks/matcher-memory.mjs [output.json]
import {Worker,isMainThread,parentPort,workerData} from "node:worker_threads";
import {getHeapStatistics} from "node:v8";
import {build} from "esbuild";
import {execFileSync} from "node:child_process";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir,cpus} from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
if(!isMainThread){
  globalThis.self={postMessage:data=>parentPort.postMessage(data),onmessage:null};
  await import(pathToFileURL(workerData.script));
  parentPort.on("message",async data=>{
    if(data.type==="retention-probe"){
      // Benchmark-only control; never bundled into a production worker.
      if(globalThis.gc){globalThis.gc();await new Promise(r=>setImmediate(r));globalThis.gc();}
      parentPort.postMessage({type:"retention-probe",gcAvailable:!!globalThis.gc,heap:getHeapStatistics(),memory:process.memoryUsage()});
    }else await self.onmessage({data});
  });
  parentPort.postMessage({type:"host-ready"});
}else{
  const root=process.cwd(),base="116fe686f7b31ecd00ac57ee4724287affafda0f",temp=await mkdtemp(path.join(tmpdir(),"signrelay-retention-"));
  try{
    const common={bundle:true,format:"esm",platform:"node",logLevel:"silent",absWorkingDir:root};
    await build({...common,entryPoints:["scripts/benchmarks/matching-workload.ts"],outfile:path.join(temp,"workload.mjs")});
    const {makeSign,examples,packTemplates}=await import(pathToFileURL(path.join(temp,"workload.mjs")));
    const source=execFileSync("git",["show",`${base}:lib/personalized-recognition.ts`],{encoding:"utf8"});
    for(const name of ["baseline","candidate"])await build({...common,entryPoints:["workers/template-matching.worker.ts"],outfile:path.join(temp,name+".mjs"),
      plugins:name==="baseline"?[{name:"baseline",setup(b){b.onLoad({filter:/[\\/]lib[\\/]personalized-recognition\.ts$/},()=>({contents:source,loader:"ts",resolveDir:path.join(root,"lib")}));}}]:[]});
    const results=[];
    for(const count of [100,300])for(const name of ["baseline","candidate"]){
      const worker=new Worker(new URL(import.meta.url),{workerData:{script:path.join(temp,name+".mjs")}});
      let resolve,reject;
      worker.on("message",data=>{if(!data.phase)resolve?.(data);});worker.on("error",error=>reject?.(error));
      const receive=()=>new Promise((r,j)=>{resolve=r;reject=j;});
      await receive();
      const probe=async()=>{const task=receive();worker.postMessage({type:"retention-probe"});return task;};
      const initial=await probe(),samples=[];
      if(!initial.gcAvailable)throw new Error("Run with --expose-gc; worker GC is unavailable");
      try{
        for(let i=0;i<40;i++){
          const templates=packTemplates(examples(count));
          worker.postMessage({type:"configure",kind:"personal",templates},[templates.values.buffer]);
          const task=receive();worker.postMessage({type:"match",id:i,generation:1,frames:makeSign("HELLO",{duration:3000,count:61})});
          const result=await task;if(result.error)throw new Error(result.error);
          if(i%5===0||i===39)samples.push({update:i+1,...await probe()});
        }
        // Drop the last vocabulary too, checking weak caches release its rows.
        const templates=packTemplates([]);worker.postMessage({type:"configure",kind:"personal",templates},[templates.values.buffer]);
        const cleared=await probe();
        results.push({version:name,examples:count,updates:40,initial,samples,cleared});
      }finally{await worker.terminate();}
    }
    const report={kind:"Actual template-worker retention with synthetic examples and explicit GC; not runtime latency, browser or physical-device memory",baseline:base,cpu:cpus()[0].model,node:process.version,results};
    const output=process.argv[2]??"work/matcher-memory.json";await writeFile(output,JSON.stringify(report,null,2)+"\n");console.log(output);
  }finally{await rm(temp,{recursive:true,force:true});}
}
