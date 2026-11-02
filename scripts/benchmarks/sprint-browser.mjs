// Real browser workers and model loading; synthetic landmarks/generated RGB.
// No source recording, webcam or signer-accuracy claim.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import path from "node:path";
import { startChrome } from "../diagnostics/chrome-session.mjs";

const base = "116fe686f7b31ecd00ac57ee4724287affafda0f",root=process.cwd();
const temp=await mkdtemp(path.join(tmpdir(),"signrelay-browser-sprint-"));
const source=file=>execFileSync("git",["show",`${base}:${file}`],{encoding:"utf8"});
const baselinePlugin={name:"frozen-baseline",setup(b){
  b.onResolve({filter:/^baseline:/},args=>({path:args.path.slice(9),namespace:"baseline"}));
  b.onLoad({filter:/.*/,namespace:"baseline"},args=>({contents:source(args.path),loader:"ts",resolveDir:path.dirname(path.join(root,args.path))}));
}};
let browser,server;
try{
  const common={bundle:true,format:"esm",platform:"browser",target:"es2020",logLevel:"silent",absWorkingDir:root};
  const page=String.raw`
    import {FingerspellingCtcSession as Before} from 'baseline:lib/fingerspelling-ctc-session.ts';
    import {LiveVision as TrackingBefore} from 'baseline:lib/live-vision.ts';
    import {FingerspellingCtcSession as After} from './lib/fingerspelling-ctc-session';
    import {LiveVision as TrackingAfter} from './lib/live-vision';
    import {FingerspellingCapture} from './lib/fingerspelling-capture';
    import {FINGERSPELLING_CTC_MODEL as contract} from './lib/fingerspelling-model';
    import {prepareCalibrationSequence} from './lib/personalized-recognition';
    import {packTemplates} from './lib/template-transport';
    import {makeSign} from './tests/fixtures/asl-motion';
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const summary=v=>{const s=[...v].sort((a,b)=>a-b);return {median:s[Math.ceil(s.length*.5)-1],p95:s[Math.ceil(s.length*.95)-1],samples:v};};
    window.runSprint=async()=>{
      const result={kind:'Actual Chrome worker/model execution; synthetic landmarks and generated no-hand RGB. Not webcam or recognition accuracy.',model:contract.sha256,ctc:[],matching:[],tracking:[]};
      for(const [name,Session] of [['baseline',Before],['candidate',After]]){
        let ready,answer,workers=0;
        const status=[];const firstReady=new Promise(r=>ready=r),start=performance.now();
        const s=new Session(()=>{workers++;return new Worker('/workers/fingerspelling.worker.js',{type:'module'});},contract,
          data=>answer?.(data),state=>{status.push(state);if(state==='failed')throw new Error('CTC worker failed');if(state==='ready')ready?.();});
        try{
          await firstReady;const coldReadyMs=performance.now()-start,reset=[];
          for(let i=0;i<20;i++){
            const task=new Promise(r=>ready=r),at=performance.now();s.reset();await task;reset.push(performance.now()-at);
          }
          const capture=new FingerspellingCapture(4/3,'v3');
          for(const f of makeSign('SORRY',{duration:1200,count:19}))capture.push(f);
          const {features,frames}=capture.finish();capture.dispose();
          const roundTrip=[],inference=[],texts=[];
          for(let i=0;i<23;i++){
            const task=new Promise(r=>answer=r),at=performance.now();s.submit(features.slice(),frames);const data=await task;
            if(i>=3){roundTrip.push(performance.now()-at);inference.push(data.inferenceMs);texts.push(data.text);}
          }
          result.ctc.push({name,coldReadyMs,idleReset:summary(reset),workersCreated:workers,roundTrip:summary(roundTrip),inference:summary(inference),syntheticOutputs:texts,status});
        }finally{s.close();}
      }
      const query=makeSign('HELLO',{duration:3000,count:61});
      const reference=prepareCalibrationSequence(makeSign('HELLO',{duration:1800,count:37}));
      for(const count of [5,10,25,50,100]){
        const templates=Array.from({length:count},(_,i)=>({id:'t'+i,gloss:'WORD'+i,text:'Word '+i,createdAt:i+1,language:'asl',
          frames:reference.map(r=>r.map((v,k)=>[0,66,132,173].includes(k)?v:v+(i===0?0:.01+i%5*.018)))}));
        const lanes=['baseline','candidate'].map(name=>{
          const w=new Worker('/'+name+'-matcher.mjs',{type:'module'}),lane={name,w,answer:null,times:[],compute:[],transport:[],decisions:[]};
          w.onerror=e=>{throw new Error(e.message);};w.onmessage=({data})=>{if(!data.phase)lane.answer?.(data);};
            const packed=packTemplates(templates),at=performance.now();
            w.postMessage({type:'configure',kind:'personal',templates:packed},[packed.values.buffer]);
          lane.configurePostMs=performance.now()-at;return lane;
        });
        try{
          for(let i=0;i<25;i++)for(const lane of i%2?[...lanes].reverse():lanes){
              const task=new Promise(r=>lane.answer=r),at=performance.now();lane.w.postMessage({type:'match',id:i,generation:1,frames:query});
              const data=await task;if(data.error)throw new Error(data.error);
              if(i>=5){const full=performance.now()-at;lane.times.push(full);lane.compute.push(data.matchingMs);lane.transport.push(Math.max(0,full-data.matchingMs));lane.decisions.push(data.prediction);}
          }
          for(const lane of lanes)result.matching.push({name:lane.name,examples:count,configurePostMs:lane.configurePostMs,roundTrip:summary(lane.times),matching:summary(lane.compute),transportResidual:summary(lane.transport),decisions:lane.decisions});
        }finally{for(const lane of lanes)lane.w.terminate();}
      }
      for(const [name,Tracking] of [['baseline',TrackingBefore],['candidate',TrackingAfter]]){
        const cold=performance.now(),engine=await Tracking.create(undefined,false);
        const coldReadyMs=performance.now()-cold,canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
        const ctx=canvas.getContext('2d'),stages=Object.fromEntries(['capture','hands','auxiliary','transport','age','full','rafGap'].map(k=>[k,[]]));
        let run=true,previous=performance.now(),measuring=false;
        const tick=at=>{if(measuring)stages.rafGap.push(at-previous);previous=at;if(run)requestAnimationFrame(tick);};requestAnimationFrame(tick);
        try{
          for(let i=0;i<25;i++){
            measuring=i>=5;ctx.fillStyle='#20242c';ctx.fillRect(0,0,640,480);
            const at=performance.now();await engine.process(canvas,at,frame=>{if(frame.hands.length)throw new Error('Generated no-hand control unexpectedly has hands');});
            if(measuring){for(const k of ['capture','hands','auxiliary','transport','age'])stages[k].push(engine.timings[k]);stages.full.push(performance.now()-at);}
            await wait(33);
          }
          result.tracking.push({name,coldReadyMs,delegate:engine.delegate,mode:engine.mode,stats:engine.stats,stages:Object.fromEntries(Object.entries(stages).map(([k,v])=>[k,summary(v)]))});
        }finally{run=false;engine.close();}
      }
      result.pageHeap=performance.memory?{used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize}:null;
      return result;
    };
  `;
  await build({...common,stdin:{contents:page,resolveDir:root,loader:"js"},plugins:[baselinePlugin],outfile:path.join(temp,"page.mjs")});
  await build({...common,entryPoints:["workers/template-matching.worker.ts"],outfile:path.join(temp,"candidate-matcher.mjs")});
  await build({...common,entryPoints:["workers/template-matching.worker.ts"],outfile:path.join(temp,"baseline-matcher.mjs"),plugins:[{name:"baseline-matcher",setup(b){
    b.onLoad({filter:/[\\/]lib[\\/]personalized-recognition\.ts$/},()=>({contents:source("lib/personalized-recognition.ts"),loader:"ts",resolveDir:path.join(root,"lib")}));
  }}]});
  const special=new Map(["page.mjs","baseline-matcher.mjs","candidate-matcher.mjs"].map(f=>['/'+f,path.join(temp,f)]));
  server=createServer(async(req,res)=>{
    const pathname=new URL(req.url,"http://localhost").pathname;
    if(pathname==="/"){res.setHeader("Content-Type","text/html");res.end('<script type="module" src="/page.mjs"></script>');return;}
    const file=special.get(pathname)??path.resolve("public","."+pathname);
    if(!special.has(pathname)&&!file.startsWith(path.resolve("public")+path.sep)){res.writeHead(403).end();return;}
    try{res.setHeader("Content-Type",({'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json'})[path.extname(file)]??'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
  });
  await new Promise(r=>server.listen(0,"127.0.0.1",r));
  browser=await startChrome(process.argv[2],{proxy:null,extraArgs:['--enable-precise-memory-info']});
  await browser.send("Page.navigate",{url:`http://127.0.0.1:${server.address().port}/`});
  for(let i=0;i<100&&!await browser.evaluate('typeof window.runSprint==="function"');i++)await new Promise(r=>setTimeout(r,100));
  const report=await browser.evaluate("window.runSprint()");
  for(const count of [5,10,25,50,100]){
    const rows=report.matching.filter(r=>r.examples===count);
    if(JSON.stringify(rows[0].decisions)!==JSON.stringify(rows[1].decisions))throw new Error('Browser matcher decisions changed');
  }
  if(JSON.stringify(report.ctc[0].syntheticOutputs)!==JSON.stringify(report.ctc[1].syntheticOutputs))throw new Error('CTC output changed');
  const out=process.argv[3]??"work/sprint-browser.json";
  await writeFile(out,JSON.stringify({baseline:base,cpu:cpus()[0].model,browser:await browser.send('Browser.getVersion'),report,errors:browser.errors},null,2)+"\n");
  console.log(`Browser benchmark complete: ${out}`);
}finally{await browser?.close();await new Promise(r=>server?server.close(r):r());await rm(temp,{recursive:true,force:true});}
