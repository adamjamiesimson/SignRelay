import {FilesetResolver,GestureRecognizer} from "@mediapipe/tasks-vision";
self.onmessage=async({data}:MessageEvent)=>{
 try{
  const samples=await(await fetch("/rgb/samples.json")).json();
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
       const started=performance.now();const value=model.recognizeForVideo(bitmap,sample.timestamps[i]);timings.push(performance.now()-started);bitmap.close();
       frames.push(value.landmarks.map((points,j)=>({side:value.handedness[j]?.[0]?.categoryName??"Unknown",score:value.handedness[j]?.[0]?.score??0,
        points:points.map(p=>[p.x,p.y,p.z])})));
      }
      results.push({id:sample.id,delegate,variant,frames,timings});
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
