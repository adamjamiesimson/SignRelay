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
 const result=await browser.evaluate(`new Promise((resolve,reject)=>{const worker=new Worker('/probe.js');const timer=setTimeout(()=>{worker.terminate();reject(new Error('RGB parity timeout'));},600000);worker.onerror=e=>reject(new Error(e.message));worker.onmessage=e=>{clearTimeout(timer);worker.terminate();resolve(e.data);};worker.postMessage({tag:'same PNG bytes and timestamps'});})`);
 assert.equal(result.passed,true,JSON.stringify(result));
 result.userAgent=await browser.evaluate("navigator.userAgent");
 writeFileSync(root+"/browser.json",JSON.stringify(result));
 console.log("RGB-BROWSER-COMPLETE",JSON.stringify({renderer:result.renderer,userAgent:result.userAgent,cases:result.results.map(r=>({id:r.id,delegate:r.delegate,variant:r.variant,frames:r.frames?.length,unsupported:r.unsupported}))}));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
