// Real held-out FSboard features are served only by the remote local QA server.
import { normalizeFingerspellingHand } from "../../lib/fingerspelling-features";
import { FingerspellingCtcSession } from "../../lib/fingerspelling-ctc-session";
import { FingerspellingCtcRuntime } from "../../lib/fingerspelling-ctc-runtime";
self.onmessage = async ({data}) => {
  try {
    const started=performance.now();
    const model=await FingerspellingCtcRuntime.create(data.contract);
    const loadMs=performance.now()-started;
    const results=[];
    try {
      for(let i=0;i<8;i++) {
        const response=await fetch("/real/"+i+".json");
        if(!response.ok) throw new Error("Missing real held-out sample");
        const sample=await response.json();
        const nativeFeatures=new Float32Array(sample.features.flat());
        const raw=new Float32Array(sample.raw.flat(2).map((v:number|null)=>v===null?NaN:v));
        const features=normalizeFingerspellingHand(raw,sample.features.length,sample.side,sample.aspect);
        let featureError=0;
        for(let j=0;j<features.length;j++)featureError=Math.max(featureError,Math.abs(features[j]-nativeFeatures[j]));
        if(featureError>1e-4)throw new Error("Real preprocessing parity failed: "+featureError);
        let maxError=0;
        const native=sample.native.flat() as number[];
        const value=await model.predict(features,sample.features.length,logits=>{
          if(logits.length!==native.length) throw new Error("Parity shape mismatch");
          for(let j=0;j<logits.length;j++) maxError=Math.max(maxError,Math.abs(logits[j]-native[j]));
        });
        const timings=[];
        for(let run=0;run<5;run++) timings.push((await model.predict(features,sample.features.length)).inferenceMs);
        if(maxError>1e-3) throw new Error("Browser/native logit parity mismatch: "+maxError);
        results.push({id:sample.id,reference:sample.reference,prediction:value.text,frames:sample.features.length,
          maxAbsLogitError:maxError,maxAbsFeatureError:featureError,inferenceMs:timings});
      }
    } finally { await model.close(); }
    const sample=await (await fetch("/real/0.json")).json();
    const features=new Float32Array(sample.features.flat());
    const protocol=await new Promise<{acceptedOldResults:number;latestText:string}>((resolve,reject)=>{
      let session:FingerspellingCtcSession,reset=false,oldResults=0;
      const timer=setTimeout(()=>{session.close();reject(new Error("Worker cancellation timeout"));},120000);
      session=new FingerspellingCtcSession(()=>new Worker("/worker.js",{type:"module"}),data.contract,result=>{
        if(!reset)oldResults++;
        if(result.requestId===4){clearTimeout(timer);session.close();resolve({acceptedOldResults:oldResults,latestText:result.text});}
      },state=>{
        if(state==="failed"){clearTimeout(timer);session.close();reject(new Error("Worker protocol failed"));return;}
        if(state==="ready"&&!reset){
          session.submit(features,sample.features.length);
          // The run is in a separate worker. Terminating it cancels WASM even
          // when its own event loop cannot process a reset message.
          reset=true;session.reset();session.submit(features,sample.features.length);session.submit(features,sample.features.length);session.submit(features,sample.features.length);
        }
      });
    });
    self.postMessage({passed:true,protocol,kind:"real held-out features, not webcam performance",loadMs,results});
  } catch(error) { self.postMessage({passed:false,error:String(error)}); }
};
