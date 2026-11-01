// Actual recorded RGB -> getUserMedia -> production CPU tracker -> capture -> CTC -> confirm.
// No landmark substitution. This is one selected integration case, not physical webcam accuracy.
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {resolve} from "node:path";
import {openRehearsal,until} from "../../tests/rehearsal-harness.mjs";
const example=process.argv[3]||"6befb92aee4dcad7bf6ed904",root="work/fingerspelling-camera/"+example;
const source=JSON.parse(readFileSync(root+"/source.json","utf8"));
const h=await openRehearsal(process.argv[2],{extraArgs:["--use-file-for-fake-video-capture="+resolve(root+"/known-fsboard.y4m")],extraInit:`
 const NativeWorker=window.Worker;window.__recorded={frames:[],results:[],inputs:[],delegates:[],capture:false,contact:[]};
 document.addEventListener('click',event=>{const text=event.target.closest('button')?.textContent?.trim();
  if(text==='Capture name'){window.__recorded.capture=true;window.__recorded.started=performance.now();}
  if(text==='Finish capture'){window.__recorded.capture=false;window.__recorded.finished=performance.now();}
 },true);
 window.Worker=class extends NativeWorker{
  constructor(url,options){super(url,options);this.ctc=String(url).includes('fingerspelling.worker');this.tracker=String(url).includes('fingerspelling-vision.worker');
   this.addEventListener('message',e=>{
    if(this.tracker&&e.data.type==='ready')window.__recorded.delegates.push(e.data.delegate);
    if(this.tracker&&e.data.type==='hands'&&window.__recorded.capture){
     window.__recorded.frames.push({timestamp:e.data.frame.timestamp,received:performance.now(),handsMs:e.data.handsMs,hasHand:e.data.frame.hands.length>0,quality:e.data.frame.hands.map(h=>({side:h.handedness,points:h.landmarks.length,finite:h.landmarks.every(p=>[p.x,p.y,p.z].every(Number.isFinite))}))});
     if(window.__recorded.frames.length%12===0){const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;canvas.getContext('2d').drawImage(document.querySelector('video'),0,0,320,180);window.__recorded.contact.push(canvas.toDataURL('image/jpeg',.6));}
    }
    if(this.ctc&&e.data.type==='result')window.__recorded.results.push({...e.data,received:performance.now()});
   });
  }
  postMessage(data,...rest){if(this.ctc&&data.type==='predict')window.__recorded.inputs.push({at:performance.now(),frames:data.frames,featureCount:data.features.length});return super.postMessage(data,...rest);}
 };
`});
try{
 await h.open("/?perf");await h.start();await h.click("Fingerspelling");
 await until(()=>h.evaluate("[...document.querySelectorAll('button')].some(b=>b.textContent==='Capture name'&&!b.disabled)"),"Research model failed to load");
 assert.equal(await h.evaluate("window.__signrelayRehearsal.playing"),false,"Landmark substitution must remain inactive");
 // Observe the actual video transition from the flat preamble to the known recording.
 const onset=await h.evaluate(`new Promise((resolve,reject)=>{
  const video=document.querySelector('video'),canvas=document.createElement('canvas');canvas.width=32;canvas.height=18;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});let flat=false;const end=performance.now()+45000;
  function tick(){
   if(performance.now()>end){reject(new Error('No recorded RGB onset'));return;}
   ctx.drawImage(video,0,0,32,18);const pixels=ctx.getImageData(0,0,32,18).data;let sum=0,square=0,n=0;
   for(let i=0;i<pixels.length;i+=4){const v=(pixels[i]+pixels[i+1]+pixels[i+2])/3;sum+=v;square+=v*v;n++;}
   const variance=square/n-(sum/n)**2;
   if(variance<3)flat=true;
   if(flat&&variance>50){resolve({time:video.currentTime,variance});return;}
   requestAnimationFrame(tick);
  }tick();
 })`);
 const clickAt=async(time,label)=>h.evaluate(`new Promise((resolve,reject)=>{
  const end=performance.now()+15000;function tick(){
   if(performance.now()>end){reject(new Error('Recorded capture timing timeout'));return;}
   const video=document.querySelector('video');
   if(video.currentTime>=${time}){const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});
    if(!b||b.disabled){reject(new Error('Capture control unavailable'));return;}b.click();resolve({time:video.currentTime,perf:performance.now()});return;}
   requestAnimationFrame(tick);
  }tick();
 })`);
 const started=await clickAt(onset.time+source.annotationStartSeconds,"Capture name");
 const finished=await clickAt(onset.time+source.annotationEndSeconds,"Finish capture");
 await until(()=>h.evaluate("window.__recorded.results.length>0 || [...document.querySelectorAll('.fingerspelling-panel p')].some(p=>/too slow|interrupted|Keep one hand|1–16 seconds/.test(p.textContent))"),"No inference or quality rejection");
 const snapshot=await h.evaluate("window.__recorded");
 console.log("ACTUAL-RGB-CAMERA-CONTACT",JSON.stringify({images:snapshot.contact,settings:await h.evaluate("document.querySelector('video').srcObject.getVideoTracks()[0].getSettings()")}));
 const messages=await h.evaluate("[...document.querySelectorAll('.fingerspelling-panel p')].map(p=>p.textContent)");
 if(!snapshot.results.length){
  assert.equal(await h.evaluate("document.querySelector('#spelling-text').value"),"");
  assert.equal(await h.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Confirm text').disabled"),true);
  assert.equal(await h.evaluate("window.__qa.spoken.length"),0);
  const frames=snapshot.frames;
  const report={kind:"selected genuine RGB virtual-camera positive; no landmark injection; quality abstention, not recognition success",
   source,sourceOnset:onset,captureStart:started,captureEnd:finished,status:"abstained-quality",actualInference:false,
   observedFrames:frames.length,visibleFrames:frames.filter(f=>f.hasHand).length,categoryQuality:frames.map(f=>f.quality),
   observedCaptureFps:(frames.length-1)*1000/(frames.at(-1).timestamp-frames[0].timestamp),messages,
   checks:["no model prediction claimed","quality rejection retained","empty draft and confirmation disabled"]};
  mkdirSync("outputs",{recursive:true});writeFileSync("outputs/fingerspelling-recorded-camera-"+example+".json",JSON.stringify(report,null,2));
  console.log("ACTUAL-RGB-CAMERA-ABSTENTION",JSON.stringify(report));
 }else{
 await until(()=>h.evaluate("document.querySelector('.spelling-candidate strong')?.textContent!=='—'"),"No candidate was displayed");
 const displayed=await h.evaluate("({text:document.querySelector('.spelling-candidate strong').textContent,at:performance.now()})");
 const result=snapshot.results.at(-1),input=snapshot.inputs.at(-1);
 assert.equal(displayed.text,result.text);assert.equal(result.status,"uncertain");
 assert.ok(snapshot.delegates.length&&snapshot.delegates.every(d=>d==="CPU"));
 assert.equal(input.featureCount,input.frames*132);assert.equal(snapshot.frames.length,input.frames);
 assert.equal(await h.evaluate("document.querySelector('#spelling-text').value"),"","Text was inserted automatically");
 assert.equal(await h.evaluate("window.__qa.spoken.length"),0,"Text spoke automatically");
 await h.click("Confirm text");
 assert.equal(await h.evaluate("document.querySelector('#spelling-text').value"),displayed.text);
 assert.equal(await h.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Confirm text').disabled"),true);
 assert.deepEqual(await h.words(),[]);assert.equal(await h.evaluate("window.__signrelayRehearsal.playing"),false);
 const frames=snapshot.frames,dt=frames.slice(1).map((f,i)=>f.timestamp-frames[i].timestamp),times=frames.map(f=>f.handsMs).sort((a,b)=>a-b),ages=frames.map(f=>f.received-f.timestamp).sort((a,b)=>a-b);
 const report={kind:"one selected genuine RGB recording via Chrome virtual getUserMedia camera; no landmark injection; NOT physical webcam accuracy",
 source,sourceOnset:onset,captureStart:started,captureEnd:finished,modelSha256:"26e640751c91f3cfba5aa7e3af43abb1e322c58f7a0c9fc7ae04fefe9ad74c41",
 reference:source.reference,prediction:displayed.text,exact:displayed.text===source.reference,status:result.status,
 frames:input.frames,observedCaptureFps:(frames.length-1)*1000/(frames.at(-1).timestamp-frames[0].timestamp),maxFrameGapMs:Math.max(...dt),
 captureWallMs:snapshot.finished-snapshot.started,finishToWorkerResultMs:result.received-snapshot.finished,finishToDisplayedResultMs:displayed.at-snapshot.finished,
 inferenceMs:result.inferenceMs,processingMs:result.processingMs,trackingMs:{median:times[Math.floor(times.length*.5)],p95:times[Math.floor(times.length*.95)]},
 frameAgeMs:{median:ages[Math.floor(ages.length*.5)],p95:ages[Math.floor(ages.length*.95)]},
 userAgent:await h.evaluate("navigator.userAgent"),trackSettings:await h.evaluate("document.querySelector('video').srcObject.getVideoTracks()[0].getSettings()"),
 checks:["actual RGB tracking, no landmark substitution","actual 132-feature inference","uncertain warning and explicit confirmation","no automatic composition or speech","word transcript preserved"]};
 mkdirSync("outputs",{recursive:true});writeFileSync("outputs/fingerspelling-recorded-camera-"+example+".json",JSON.stringify(report,null,2));
 console.log("ACTUAL-RGB-CAMERA-RESULT",JSON.stringify(report));
 }
}catch(error){console.error("ACTUAL-RGB-CAMERA-FAIL",await h.evaluate("JSON.stringify({tracking:{...window.__recorded,contact:undefined},candidate:document.querySelector('.spelling-candidate')?.textContent,messages:[...document.querySelectorAll('.fingerspelling-panel p')].map(p=>p.textContent)})"));throw error;
}finally{await h.close();}
