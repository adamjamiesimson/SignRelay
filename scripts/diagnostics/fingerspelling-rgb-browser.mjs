import {createServer} from "node:http";
import {readFileSync,existsSync,writeFileSync} from "node:fs";
import {resolve,extname} from "node:path";
import {build} from "esbuild";
import assert from "node:assert/strict";
import {startChrome} from "./chrome-session.mjs";
const root=resolve("work/rgb");
await build({entryPoints:["scripts/diagnostics/fingerspelling-rgb-probe.ts"],bundle:true,format:"iife",platform:"browser",target:"es2020",outfile:root+"/probe.js"});
const server=createServer((req,res)=>{
 const url=new URL(req.url,"http://localhost");let file;
 if(url.pathname==="/"){res.setHeader("Content-Type","text/html");res.end("<!doctype html><title>Real RGB extraction parity</title>");return;}
 if(url.pathname.startsWith("/rgb/"))file=resolve(root,"."+url.pathname.slice(4));
 else if(url.pathname==="/probe.js")file=root+"/probe.js";
 else if(url.pathname==="/vision/models/gesture_recognizer.task")file=root+"/gesture.task";
 else if(url.pathname.startsWith("/vision/wasm/"))file=resolve("public/vision/wasm",url.pathname.split("/").at(-1));
 if(!file||!existsSync(file)){res.statusCode=404;res.end();return;}
 const types={".png":"image/png",".js":"text/javascript",".wasm":"application/wasm",".json":"application/json"};
 res.setHeader("Content-Type",types[extname(file)]||"application/octet-stream");res.end(readFileSync(file));
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));let browser;
try{
 browser=await startChrome(process.argv[2],{proxy:null});
 await browser.send("Page.navigate",{url:"http://127.0.0.1:"+server.address().port});
 const samples=JSON.parse(readFileSync(root+"/samples.json","utf8"));
 const collected=[];let renderer="unavailable";
 for(const delegate of ["CPU","GPU"]){
  for(const sample of samples){
   for(const variant of ["original","mirrored"]){
    await browser.evaluate(`(()=>{window.__rgbResult=null;window.__rgbProgress=null;window.__rgbWorker=new Worker('/probe.js');window.__rgbWorker.onerror=e=>{window.__rgbResult={passed:false,error:e.message};};window.__rgbWorker.onmessage=e=>{if(e.data.progress)window.__rgbProgress=e.data.progress;else window.__rgbResult=e.data;};window.__rgbWorker.postMessage(${JSON.stringify({id:sample.id,delegate,variant,tag:"same PNG bytes and timestamps"})});})()`);
    let value,last="",state;const deadline=Date.now()+(delegate==="CPU"?120000:60000);
    while(Date.now()<deadline){
     state=await browser.evaluate("JSON.stringify({result:window.__rgbResult,progress:window.__rgbProgress})");
     const parsed=JSON.parse(state);
     if(parsed.progress&&JSON.stringify(parsed.progress)!==last){last=JSON.stringify(parsed.progress);console.log("RGB-CASE-PROGRESS",last);}
     if(parsed.result){value=parsed.result;break;}
     await new Promise(r=>setTimeout(r,250));
    }
    await browser.evaluate("window.__rgbWorker.terminate(); true");
    if(!value){
     if(delegate==="CPU")throw new Error("CPU RGB case timed out "+last);
     collected.push({id:sample.id,delegate,variant,unsupported:"GPU case exceeded 60-second diagnostic limit; last stage "+last});continue;
    }
    assert.equal(value.passed,true,JSON.stringify(value));
    renderer=value.renderer;collected.push(...value.results);
   }
  }
 }
 const result={passed:true,renderer,results:collected};

 result.userAgent=await browser.evaluate("navigator.userAgent");
 writeFileSync(root+"/browser.json",JSON.stringify(result));
 console.log("RGB-BROWSER-COMPLETE",JSON.stringify({renderer:result.renderer,userAgent:result.userAgent,cases:result.results.map(r=>({id:r.id,delegate:r.delegate,variant:r.variant,frames:r.frames?.length,unsupported:r.unsupported}))}));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
