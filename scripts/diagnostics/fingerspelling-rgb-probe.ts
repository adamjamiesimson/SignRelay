import {FilesetResolver,GestureRecognizer} from "@mediapipe/tasks-vision";
import type {VisionFrame} from "../../lib/vision-types";
async function verifyPixels(bitmap:ImageBitmap,expected:string){
 const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),context=canvas.getContext("2d")!;context.drawImage(bitmap,0,0);
 const rgba=context.getImageData(0,0,bitmap.width,bitmap.height).data,rgb=new Uint8Array(bitmap.width*bitmap.height*3);
 for(let i=0;i<rgb.length/3;i++){rgb[i*3]=rgba[i*4];rgb[i*3+1]=rgba[i*4+1];rgb[i*3+2]=rgba[i*4+2];}
 const hash=[...new Uint8Array(await crypto.subtle.digest("SHA-256",rgb))].map(v=>v.toString(16).padStart(2,"0")).join("");
 if(hash!==expected)throw new Error("Native/browser decoded RGB bytes differ");
}
type ProductionReply={type:string;message?:string;delegate?:string;frame?:VisionFrame;timings?:{hands:number}};
async function productionCase(sample:Record<string,unknown>,variant:string){
 const source=sample as {id:string;urls:string[];timestamps:number[];pixelSha256:Record<string,string[]>};
 const worker=new Worker("/workers/fingerspelling-vision.worker.js");
 const communicate=(message:unknown,transfer:Transferable[],kind:string)=>new Promise<ProductionReply>((resolve,reject)=>{
  worker.onerror=e=>reject(new Error(e.message));worker.onmessage=({data}:MessageEvent<ProductionReply>)=>{
   if(data.type==="error")reject(new Error(data.message));else if(data.type===kind)resolve(data);
  };worker.postMessage(message,transfer);
 });
 try{
  const ready=await communicate({type:"init"},[],"ready");if(ready.delegate!=="CPU")throw new Error("Unexpected production delegate");
  const frames=[],timings=[];
  for(let i=0;i<source.urls.length;i++){
   let bitmap=await createImageBitmap(await(await fetch(source.urls[i])).blob());
   if(variant==="mirrored"){const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext("2d")!;ctx.translate(bitmap.width,0);ctx.scale(-1,1);ctx.drawImage(bitmap,0,0);bitmap.close();bitmap=canvas.transferToImageBitmap();}
   await verifyPixels(bitmap,source.pixelSha256[variant][i]);
   const reply=await communicate({type:"frame",bitmap,timestamp:source.timestamps[i]+2},[bitmap],"result");
   if(!reply.frame||!reply.timings)throw new Error("Missing production frame");
   frames.push(reply.frame.hands.map(hand=>({side:hand.handedness,points:hand.landmarks.map(p=>[p.x,p.y,p.z])})));timings.push(reply.timings.hands);
   if(i%30===0)self.postMessage({progress:{id:source.id,delegate:"CPU-production",variant,at:i,total:source.urls.length}});
  }
  return {id:source.id,delegate:"CPU-production",variant,frames,timings,pixelVerifiedFrames:frames.length,timestampOffsetMs:2};
 }finally{worker.terminate();}
}
self.onmessage=async({data}:MessageEvent)=>{
 try{
  const samples=await(await fetch("/rgb/samples.json")).json();
  if(data.delegate==="CPU-production"){
   const sample=samples.find((s:{id:string})=>s.id===data.id);if(!sample)throw new Error("Missing source");
   const result=await productionCase(sample,data.variant);
   self.postMessage({passed:true,renderer:"production CPU worker; no GPU requested",results:[result],tag:data.tag});return;
  }
  const files=await FilesetResolver.forVisionTasks("/vision/wasm");
  const results=[];
  for(const delegate of [data.delegate] as ("CPU"|"GPU")[]){
   for(const sample of samples.filter((s:{id:string})=>s.id===data.id)){
    for(const variant of [data.variant]){
     let model:GestureRecognizer|undefined;
     try{
      self.postMessage({progress:{id:sample.id,delegate,variant,stage:"creating-task"}});
      model=await GestureRecognizer.createFromOptions(files,{baseOptions:{modelAssetPath:"/vision/models/gesture_recognizer.task",delegate},
       canvas:new OffscreenCanvas(1,1),runningMode:"VIDEO",numHands:2,minHandDetectionConfidence:.55,minHandPresenceConfidence:.55,minTrackingConfidence:.55,
       cannedGesturesClassifierOptions:{scoreThreshold:.55}});
      self.postMessage({progress:{id:sample.id,delegate,variant,stage:"task-ready",total:sample.urls.length}});
      const frames=[];const timings=[];
      for(let i=0;i<sample.urls.length;i++){
       if(i%30===0)self.postMessage({progress:{id:sample.id,delegate,variant,stage:"frames",at:i,total:sample.urls.length}});
       const response=await fetch(sample.urls[i]);if(!response.ok)throw new Error("Missing real RGB PNG");
       let bitmap=await createImageBitmap(await response.blob());
       if(variant==="mirrored"){
        const canvas=new OffscreenCanvas(bitmap.width,bitmap.height);const context=canvas.getContext("2d")!;
        context.translate(bitmap.width,0);context.scale(-1,1);context.drawImage(bitmap,0,0);bitmap.close();bitmap=canvas.transferToImageBitmap();
       }
       await verifyPixels(bitmap,sample.pixelSha256[variant][i]);
       const started=performance.now();const value=model.recognizeForVideo(bitmap,sample.timestamps[i]);timings.push(performance.now()-started);bitmap.close();
       frames.push(value.landmarks.map((points,j)=>({side:value.handedness[j]?.[0]?.categoryName??"Unknown",score:value.handedness[j]?.[0]?.score??0,
        points:points.map(p=>[p.x,p.y,p.z])})));
      }
      results.push({id:sample.id,delegate,variant,frames,timings,pixelVerifiedFrames:frames.length});
     }catch(error){
      if(delegate==="CPU")throw error;
      results.push({id:sample.id,delegate,variant,unsupported:String(error)});
     }finally{model?.close();}
    }
   }
  }
  const canvas=new OffscreenCanvas(1,1),gl=canvas.getContext("webgl2");
  const extension=gl?.getExtension("WEBGL_debug_renderer_info");
  self.postMessage({passed:true,renderer:extension?gl?.getParameter(extension.UNMASKED_RENDERER_WEBGL):"unavailable",results,tag:data.tag});
 }catch(error){self.postMessage({passed:false,error:String(error)});}
};
