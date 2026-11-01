import {FingerspellingCtcRuntime,decodeCtc} from "../../lib/fingerspelling-ctc-runtime";
import {normalizeFingerspellingHand,normalizeFingerspellingMotion} from "../../lib/fingerspelling-features";
import {FingerspellingCtcSession} from "../../lib/fingerspelling-ctc-session";
import {visualBeam} from "../../lib/fingerspelling-decoding";
let model:FingerspellingCtcRuntime|null=null;
self.onmessage=async({data}:MessageEvent)=>{
 try{
  if(data.type==="protocol"){
   const sample=await(await fetch("/real/"+(data.fixtureIndex??0)+".json")).json(),features=new Float32Array(sample.features.flat());
   const protocol=await new Promise<{acceptedOldResults:number;latestText:string}>((resolve,reject)=>{
    let reset=false,oldResults=0;
    const timer=setTimeout(()=>{session.close();reject(new Error("Actual worker reset timeout"));},120000);
    const session=new FingerspellingCtcSession(()=>new Worker("/worker.js",{type:"module"}),data.contract,result=>{
     if(!reset)oldResults++;
     if(result.requestId===4){clearTimeout(timer);session.close();resolve({acceptedOldResults:oldResults,latestText:result.text});}
    },state=>{
     if(state==="failed"){clearTimeout(timer);reject(new Error("Actual worker protocol failed"));return;}
     if(state==="ready"&&!reset){session.submit(features,sample.features.length);reset=true;session.reset();session.submit(features,sample.features.length);session.submit(features,sample.features.length);session.submit(features,sample.features.length);}
    });
   });
   self.postMessage({ok:true,protocol});return;
  }
  if(data.type==="close"){await model?.close();model=null;self.postMessage({ok:true});return;}
  if(data.type==="load"){
   const started=performance.now();model=await FingerspellingCtcRuntime.create(data.contract);
   self.postMessage({ok:true,loadMs:performance.now()-started});return;
  }
  if(!["run","runBaseline"].includes(data.type)||!model)throw new Error("Benchmark model not ready");
  const results=[];
  for(let i=0;i<8;i++){
   const sample=await(await fetch("/real/"+i+".json")).json();
   const frames=sample.raw.length,raw=new Float32Array(sample.raw.flat(2).map((v:number|null)=>v===null?NaN:v));
   const features=data.contract.featureVersion==="v3"?normalizeFingerspellingMotion(raw,new Float64Array(sample.times),frames,sample.side,sample.aspect):normalizeFingerspellingHand(raw,frames,sample.side,sample.aspect);
   const baseline=data.type==="runBaseline";
   const native=new Float32Array(sample.features.flat());let featureError=0;
   if(!baseline)for(let j=0;j<features.length;j++)featureError=Math.max(featureError,Math.abs(features[j]-native[j]));
   if(featureError>2e-4)throw new Error("Real v3 preprocessing mismatch "+featureError);
   let visible=false;for(let t=0;t<frames;t++)if(features[t*model.inputFeatures+model.presenceIndex]===1)visible=true;
   if(!visible){
    const guarded=await model.predict(features,frames);
    if(guarded.status!=="no-hand"||guarded.text||guarded.inferenceMs!==0)throw new Error("Empty-input guard failed");
    results.push({id:sample.id,reference:sample.reference,frames,guardOnly:true,status:guarded.status,displayPrediction:"",inferenceMs:[],processingMs:[]});
    continue;
   }
   const reference=sample.logits.flat() as number[];let logitError=0,rawText="",observed=false;
   const result=await model.predict(features,frames,logits=>{
    observed=true;
    if(logits.length!==reference.length)throw new Error("Native tensor shape mismatch");
    if(!baseline)for(let j=0;j<logits.length;j++)logitError=Math.max(logitError,Math.abs(logits[j]-reference[j]));
    rawText=data.contract.decoder==="beam8"?visualBeam(logits,frames):decodeCtc(logits,frames).text;
   });
   if(!observed)throw new Error("No genuine inference observed");
   if(logitError>3e-4||rawText!==(baseline?data.baselineExpected[sample.id]:sample.prediction))throw new Error("Real native/browser decode mismatch: "+rawText+" / "+sample.prediction+" / "+logitError);
   const probabilityError=Math.abs((result.estimatedExactProbability??0)-sample.estimatedExactProbability);
   if(!baseline&&probabilityError>1e-4)throw new Error("Calibration implementation mismatch "+probabilityError);
   const inferenceMs=[],processingMs=[];
   for(let j=0;j<5;j++){const value=await model.predict(features,frames);inferenceMs.push(value.inferenceMs);processingMs.push(value.processingMs??value.inferenceMs);}
   results.push({id:sample.id,reference:sample.reference,rawPrediction:rawText,displayPrediction:result.text,status:result.status,frames,
    maxAbsFeatureError:baseline?undefined:featureError,maxAbsLogitError:baseline?undefined:logitError,probabilityError:baseline?undefined:probabilityError,inferenceMs,processingMs});
  }
  self.postMessage({ok:true,results});
 }catch(error){self.postMessage({ok:false,error:String(error)});}
};
