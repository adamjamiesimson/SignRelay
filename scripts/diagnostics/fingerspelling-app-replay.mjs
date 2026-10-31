// Real FSboard hand-landmark replay through the actual capture UI and ONNX worker.
// The camera is fake; this verifies wiring, not RGB tracker or webcam accuracy.
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {openRehearsal,until,pause} from "../../tests/rehearsal-harness.mjs";
const samples=JSON.parse(readFileSync("work/fingerspelling-app/samples.json","utf8"));
const h=await openRehearsal(process.argv[2],{extraInit:`
  const NativeWorker=window.Worker;
  window.__qa.ctcInputs=[];window.__qa.ctcResults=[];
  window.Worker=class extends NativeWorker{
    constructor(url,options){super(url,options);this.ctc=String(url).includes('fingerspelling.worker');if(this.ctc)this.addEventListener('message',e=>{if(e.data.type==='result')window.__qa.ctcResults.push(e.data);});}
    postMessage(data,...rest){if(this.ctc&&data.type==='predict')window.__qa.ctcInputs.push({features:Array.from(data.features),frames:data.frames});return super.postMessage(data,...rest);}
  };
`});
const results=[],inputs=[];
const ready=()=>until(()=>h.evaluate("[...document.querySelectorAll('button')].some(b=>b.textContent==='Capture name'&&!b.disabled)"),"Actual model did not become ready");
try{
 await h.open();await h.start();await h.click("Fingerspelling");await ready();
 const words=await h.words(),spoken=await h.evaluate("window.__qa.spoken.length");
 for(const sample of samples){
  // Match the real recording aspect for landmark replay; pixels remain fake.
  await h.evaluate(`Object.defineProperty(document.querySelector("video"),"videoWidth",{configurable:true,value:${sample.aspect*1000}});Object.defineProperty(document.querySelector("video"),"videoHeight",{configurable:true,value:1000}); true`);
  await h.click("Capture name");await h.play(sample.frames);
  await until(async()=>!(await h.playing()),"Real source replay did not finish");
  await h.click("Finish capture");
  await until(()=>h.evaluate("document.querySelector('.spelling-candidate strong')?.textContent!=='—'"),"No real-model candidate");
  const prediction=await h.evaluate("document.querySelector('.spelling-candidate strong').textContent");
  assert.match(prediction,/^[ A-Z]+$/);
  assert.equal(await h.evaluate("document.querySelector('#spelling-text').value"),"","Text inserted without confirmation");
  assert.equal(await h.evaluate("window.__qa.spoken.length"),spoken,"Candidate spoke automatically");
  const input=await h.evaluate("window.__qa.ctcInputs.at(-1)");
  const worker=await h.evaluate("window.__qa.ctcResults.at(-1)");
  assert.equal(worker.text,prediction);
  inputs.push({...input,prediction,id:sample.id});
  await h.click("Confirm text");
  assert.equal(await h.evaluate("document.querySelector('#spelling-text').value"),prediction);
  assert.equal(await h.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Confirm text').disabled"),true);
  results.push({id:sample.id,reference:sample.reference,prediction,exact:prediction===sample.reference,
    frames:input.frames,rawSha256:sample.rawSha256});
  await h.click("Clear");await ready();
 }
 await h.click("Capture name");await h.play(samples[0].frames);await pause(600);await h.click("Cancel capture");await ready();await pause(300);
 assert.equal(await h.evaluate("document.querySelector('.spelling-candidate strong').textContent"),"—");
 assert.equal(await h.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Confirm text').disabled"),true);
 assert.deepEqual(await h.words(),words);
 assert.deepEqual(h.nonLoopback(),[]);
 mkdirSync("outputs",{recursive:true});
 writeFileSync("work/fingerspelling-app/captured-inputs.json",JSON.stringify(inputs));
 writeFileSync("outputs/fingerspelling-app-real.json",JSON.stringify({kind:"two selected real held-out landmark replays; fake camera; not a new accuracy estimate",
  modelSha256:"fbf35592acd849bf3b6b5621a23465ed134ffbc6ab049fbbf8db75916177c29a",
  passed:true,results,checks:["actual captured sequence -> actual worker -> candidate -> deliberate text confirmation",
  "no automatic composition or speech","confirmation consumes candidate","cancel removes candidate","word transcript preserved","same-origin requests only"]},null,2));
 console.log("REAL-APP-INTEGRATION",JSON.stringify(results));
}catch(error){
 console.error("REAL-APP-FAIL",await h.evaluate("JSON.stringify({candidate:document.querySelector('.spelling-candidate')?.textContent,messages:[...document.querySelectorAll('.fingerspelling-panel p')].map(p=>p.textContent),buttons:[...document.querySelectorAll('.spelling-actions button')].map(b=>({text:b.textContent,disabled:b.disabled}))})"));
 throw error;
}finally{await h.close();}
