// Executes the actual candidate runtime and actual inference worker in remote Chrome.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync,writeFileSync,existsSync } from "node:fs";
import { basename,resolve } from "node:path";
import { build } from "esbuild";
import { startChrome } from "./chrome-session.mjs";

const executable=process.argv[2];
if(!executable) throw new Error("Pass remote Chrome executable");
const root=resolve("work/fingerspelling-candidate");
const report=JSON.parse(readFileSync(root+"/report.json","utf8"));
await build({entryPoints:["scripts/diagnostics/fingerspelling-parity-probe.ts"],outfile:root+"/probe.js",
  bundle:true,format:"esm",platform:"browser",target:"es2020"});
await build({entryPoints:["workers/fingerspelling.worker.ts"],outfile:root+"/worker.js",
  bundle:true,format:"esm",platform:"browser",target:"es2020"});
const server=createServer((req,res)=>{
  const url=new URL(req.url,"http://localhost");
  let file,type;
  if(url.pathname==="/") {res.setHeader("Content-Type","text/html");res.end("<!doctype html><title>Real CTC inference QA</title>");return;}
  if(url.pathname==="/probe.js"||url.pathname==="/worker.js") {file=root+url.pathname;type="text/javascript";}
  else if(url.pathname==="/models/asl-fingerspelling/model.onnx") {file=root+"/model.onnx";type="application/octet-stream";}
  else if(/^\/real\/[0-7]\.json$/.test(url.pathname)) {file=resolve("work/fingerspelling-data/browser",basename(url.pathname));type="application/json";}
  else if(/^\/workers\/ort-wasm-simd-threaded\.jsep\.(wasm|mjs)$/.test(url.pathname)) {
    file=resolve("public/workers",basename(url.pathname));type=file.endsWith(".wasm")?"application/wasm":"text/javascript";
  }
  if(!file||!existsSync(file)) {res.statusCode=404;res.end();return;}
  res.setHeader("Content-Type",type);res.end(readFileSync(file));
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const origin="http://127.0.0.1:"+server.address().port;
let browser;
const contract={url:"/models/asl-fingerspelling/model.onnx",bytes:report.modelBytes,sha256:report.modelSha256};
try {
  browser=await startChrome(executable,{proxy:null});
  await browser.send("Page.navigate",{url:origin});
  const userAgent=await browser.evaluate("navigator.userAgent");
  const result=await browser.evaluate(`new Promise((resolve,reject)=>{
    const worker=new Worker('/probe.js',{type:'module'});
    const timer=setTimeout(()=>{worker.terminate();reject(new Error('CTC parity timeout'));},120000);
    worker.onerror=e=>{clearTimeout(timer);worker.terminate();reject(new Error(e.message));};
    worker.onmessage=e=>{clearTimeout(timer);worker.terminate();resolve(e.data);};
    worker.postMessage({contract:${JSON.stringify(contract)}});
  })`);
  assert.equal(result.passed,true,JSON.stringify(result));
  for(const row of result.results) {
    const native=report.test.predictions.find(x=>x.id===row.id);
    assert.equal(row.prediction,native.prediction,"Browser changed decoded text on "+row.id);
  }
  assert.equal(result.protocol.acceptedOldResults,0,"A cancelled worker delivered an accepted result");
  const values=result.results.flatMap(r=>r.inferenceMs).sort((a,b)=>a-b);
  const summary={...result,userAgent,modelSha256:report.modelSha256,
    measuredSequences:result.results.length,measuredInferences:values.length,
    medianInferenceMs:values[Math.floor(values.length*.5)],p95InferenceMs:values[Math.floor(values.length*.95)]};
  writeFileSync(root+"/browser-report.json",JSON.stringify(summary,null,2));
  console.log("BROWSER-REAL-INFERENCE",JSON.stringify(summary));
} finally {await browser?.close();await new Promise(r=>server.close(r));}
