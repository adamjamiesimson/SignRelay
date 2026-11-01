/// <reference lib="webworker" />
import {FilesetResolver,GestureRecognizer} from "@mediapipe/tasks-vision";
import {VISION_MODELS,LOCAL_WASM_PATH,LOCAL_MODEL_PATH} from "../lib/vision-runtime.mjs";
import type {VisionFrame} from "../lib/vision-types";
let model:GestureRecognizer|null=null;
let resize:OffscreenCanvas|null=null;
let lastTimestamp=1;
async function reviewedTask(){
 const pin=VISION_MODELS.gesture;
 const response=await fetch(LOCAL_MODEL_PATH+"/"+pin.file,{redirect:"error"});
 if(!response.ok||!response.body)throw new Error("Hand tracking model unavailable");
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let total=0;
 try{
  while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>pin.bytes)throw new Error("Hand model exceeds pinned size");chunks.push(value);}
 }finally{await reader.cancel().catch(()=>{});}
 if(total!==pin.bytes)throw new Error("Hand model size mismatch");
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const digest=await crypto.subtle.digest("SHA-256",bytes);
 const hex=[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,"0")).join("");
 if(hex!==pin.sha256)throw new Error("Hand model checksum mismatch");
 return bytes;
}
function handFrame(bitmap:ImageBitmap,timestamp:number):{frame:VisionFrame;handsMs:number}{
 if(!model||!Number.isFinite(timestamp)||timestamp<=lastTimestamp)throw new Error("Invalid hand tracking frame");
 lastTimestamp=timestamp;
 const started=performance.now();
 const longest=Math.max(bitmap.width,bitmap.height),factor=Math.min(1,640/longest);
 const width=Math.round(bitmap.width*factor),height=Math.round(bitmap.height*factor);
 if(!resize||resize.width!==width||resize.height!==height)resize=new OffscreenCanvas(width,height);
 const context=resize.getContext("2d",{willReadFrequently:true});if(!context)throw new Error("Hand RGB surface unavailable");
 // Canonical RGBA pixels for video-backed ImageBitmaps as well as PNG bitmaps.
 // Training consumes decoded RGB arrays; do not rely on opaque video texture layout.
 context.drawImage(bitmap,0,0,width,height);
 const pixels=context.getImageData(0,0,width,height);
 const value=model.recognizeForVideo(pixels,timestamp);const handsMs=performance.now()-started;
  const frame:VisionFrame={timestamp,hands:value.landmarks.map((points,i)=>{
   const label=value.handedness[i]?.[0]?.categoryName;
   return {landmarks:points.map(p=>({x:p.x,y:p.y,z:p.z})),handedness:label==="Left"||label==="Right"?label:"Unknown",
    gesture:"None",gestureScore:0};
  }),face:[],pose:[]};
  return {frame,handsMs};

}
self.onmessage=async({data}:MessageEvent)=>{
 try{
  if(data.type==="init"){
   self.postMessage({type:"progress",message:"Loading hand tracking"});
   const files=await FilesetResolver.forVisionTasks(LOCAL_WASM_PATH);
   model=await GestureRecognizer.createFromOptions(files,{baseOptions:{modelAssetBuffer:await reviewedTask(),delegate:"CPU"},
    canvas:new OffscreenCanvas(1,1),runningMode:"VIDEO",numHands:2,minHandDetectionConfidence:.55,minHandPresenceConfidence:.55,minTrackingConfidence:.55});
   self.postMessage({type:"warming"});const surface=new OffscreenCanvas(256,256);const context=surface.getContext("2d")!;
   context.fillStyle="#20242c";context.fillRect(0,0,256,256);
   const probe=surface.transferToImageBitmap();try{model.recognizeForVideo(probe,1);}finally{probe.close();}
   self.postMessage({type:"ready",assetSource:"self-hosted",delegate:"CPU"});
  }else if(data.type==="frame"&&model){
   const bitmap=data.bitmap as ImageBitmap;
   try{
    const {frame,handsMs}=handFrame(bitmap,data.timestamp);
    self.postMessage({type:"hands",frame,handsMs});
    self.postMessage({type:"result",frame,timings:{hands:handsMs,auxiliary:0}});
   }finally{bitmap.close();}
  }
 }catch(error){self.postMessage({type:"error",message:error instanceof Error?error.message:String(error)});}
};
