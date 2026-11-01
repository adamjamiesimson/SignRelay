// Actual real-sequence WASM inference with Linux process-memory snapshots.
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFileSync,writeFileSync,existsSync,readdirSync} from "node:fs";
import {resolve,extname} from "node:path";
import {build} from "esbuild";
import {startChrome} from "./chrome-session.mjs";
const root=resolve("work/upright-evaluation"),contract=JSON.parse(readFileSync(root+"/runtime.json","utf8"));
const baselineContract=JSON.parse(readFileSync("docs/fingerspelling/evidence/accuracy-v2-runtime.json","utf8"));baselineContract.policy.reviewOnly=true;
const nativeReport=JSON.parse(readFileSync(root+"/report.json","utf8"));
const baselineExpected=Object.fromEntries(Object.values(nativeReport.predictions).flatMap(r=>r.previousModel).map(r=>[r.id,r.prediction]));
contract.policy.reviewOnly=true;
await build({entryPoints:["scripts/diagnostics/fingerspelling-upright-probe.ts"],bundle:true,format:"esm",platform:"browser",target:"es2020",outfile:root+"/probe.js"});
await build({entryPoints:["workers/fingerspelling.worker.ts"],bundle:true,format:"esm",platform:"browser",target:"es2020",outfile:root+"/worker.js"});
const server=createServer((req,res)=>{
 const url=new URL(req.url,"http://localhost");let file;
 if(url.pathname==="/"){res.setHeader("Content-Type","text/html");res.end("<!doctype html><title>Actual CTC benchmark</title>");return;}
 if(url.pathname==="/probe.js")file=root+"/probe.js";
 else if(url.pathname==="/worker.js")file=root+"/worker.js";
 else if(url.pathname===contract.url)file=root+"/model.onnx";
 else if(url.pathname===baselineContract.url)file=resolve("public"+baselineContract.url);
 else if(/^\/real\/[0-7]\.json$/.test(url.pathname))file=root+"/browser/"+url.pathname.split("/").at(-1);
 else if(/^\/workers\/ort-wasm-simd-threaded\.jsep\.(wasm|mjs)$/.test(url.pathname))file=resolve("public/workers",url.pathname.split("/").at(-1));
 if(!file||!existsSync(file)){res.statusCode=404;res.end();return;}
 res.setHeader("Content-Type",({".js":"text/javascript",".mjs":"text/javascript",".wasm":"application/wasm",".json":"application/json"})[extname(file)]||"application/octet-stream");
 res.end(readFileSync(file));
});
function memory(){
 try{
  const records=[];
  for(const name of readdirSync("/proc").filter(s=>/^\d+$/.test(s))){
   try{const status=readFileSync("/proc/"+name+"/status","utf8");const cmd=readFileSync("/proc/"+name+"/cmdline","utf8");records.push({pid:Number(name),parent:Number(status.match(/^PPid:\s+(\d+)/m)?.[1]),cmd});}catch{}
  }
  const roots=records.filter(r=>r.cmd.includes("--user-data-dir=")&&r.cmd.includes("signrelay-diagnostic-")&&!r.cmd.includes("--type=")).map(r=>r.pid);
  const included=new Set(roots);let changed=true;
  while(changed){changed=false;for(const row of records)if(included.has(row.parent)&&!included.has(row.pid)){included.add(row.pid);changed=true;}}
  let pss=0,rss=0;for(const pid of included){try{const data=readFileSync("/proc/"+pid+"/smaps_rollup","utf8");pss+=Number(data.match(/^Pss:\s+(\d+)/m)?.[1]||0);rss+=Number(data.match(/^Rss:\s+(\d+)/m)?.[1]||0);}catch{}}
  return {processes:included.size,pssKiB:pss,rssKiB:rss,scope:"Linux Chrome process tree; PSS apportions shared pages; not a physical-device or WASM-only allocation measurement"};
 }catch(error){return {unavailable:String(error)};}
}
await new Promise(r=>server.listen(0,"127.0.0.1",r));let browser;
try{
 const measured={};
 for(const [label,current] of [["baseline",baselineContract],["improved",contract]]){
  browser=await startChrome(process.argv[2],{proxy:null});await browser.send("Page.navigate",{url:"http://127.0.0.1:"+server.address().port});
  await browser.evaluate("window.__worker=new Worker('/probe.js',{type:'module'}); true");
  const before=memory();
  const request=data=>browser.evaluate(`new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Actual inference timeout')),120000);window.__worker.onerror=e=>{clearTimeout(timer);reject(new Error(e.message));};window.__worker.onmessage=e=>{clearTimeout(timer);resolve(e.data);};window.__worker.postMessage(${JSON.stringify(data)});})`);
  const loaded=await request({type:"load",contract:current});assert.equal(loaded.ok,true,JSON.stringify(loaded));const afterLoad=memory();
  const result=await request({type:label==="baseline"?"runBaseline":"run",contract:current,baselineExpected});assert.equal(result.ok,true,JSON.stringify(result));const afterInference=memory();
  const inference=result.results.flatMap(r=>r.inferenceMs).sort((a,b)=>a-b),processing=result.results.flatMap(r=>r.processingMs).sort((a,b)=>a-b);
  const fixtureIndex=result.results.findIndex(r=>!r.guardOnly);assert.ok(fixtureIndex>=0,"No genuine inference cases");
  const protocol=await request({type:"protocol",contract:current,fixtureIndex});assert.equal(protocol.ok,true,JSON.stringify(protocol));assert.equal(protocol.protocol.acceptedOldResults,0);assert.equal(protocol.protocol.latestText,result.results[fixtureIndex].displayPrediction);
  measured[label]={protocol:protocol.protocol,modelSha256:current.sha256,featureVersion:current.featureVersion,decoder:current.decoder,measuredInferences:inference.length,
   loadMs:loaded.loadMs,medianInferenceMs:inference[Math.floor(inference.length*.5)],p95InferenceMs:inference[Math.floor(inference.length*.95)],
   medianProcessingMs:processing[Math.floor(processing.length*.5)],p95ProcessingMs:processing[Math.floor(processing.length*.95)],
   memory:{before,afterLoad,afterInference},results:result.results,userAgent:await browser.evaluate("navigator.userAgent")};
  await request({type:"close"});await browser.evaluate("window.__worker.terminate(); true");await browser.close();browser=null;
  await new Promise(r=>setTimeout(r,300));
 }
 const report={kind:"paired actual WASM inference, same eight real sequences, fresh Chrome profiles per model; not webcam latency",
  models:measured,acceptanceMode:"research review-only; the fixed calibration admission rule accepts nothing"};
 writeFileSync(root+"/browser-report.json",JSON.stringify(report,null,2));
 console.log("UPRIGHT-BROWSER-RESULT",JSON.stringify(report));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
