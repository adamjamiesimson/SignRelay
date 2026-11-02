/// <reference lib="webworker" />
import {FilesetResolver,GestureRecognizer,HandLandmarker} from "@mediapipe/tasks-vision";
import {VISION_MODELS,LOCAL_WASM_PATH,LOCAL_MODEL_PATH} from "../lib/vision-runtime.mjs";
import {storedZipEntry} from "../lib/task-bundle";
import type {VisionFrame} from "../lib/vision-types";
/** "gesture": GestureRecognizer (hands + unused gesture classifier per hand).
 * "landmarker": HandLandmarker on the identical palm-detector/landmark weights
 * taken from the same verified bundle; fingerspelling never reads gestures. */
export type TrackerEngine="gesture"|"landmarker";
/** One hand: MediaPipe re-runs palm detection on EVERY frame while fewer than
 * numHands hands are tracked, so two hands cost ~72 ms/frame on the CI CPU
 * (13.7% of frames inside the 66.7 ms 15 Hz budget) versus ~35 ms with one
 * (95.4%). On 13 licensed clips in lockstep the tracked hand's landmarks were
 * bit-identical and every decoded output was identical; fingerspelling uses a
 * single dominant hand. Word mode keeps two hands (VisionEngine).
 * Evidence: docs/tracking-sprint/README.md. Previous: {engine:"gesture",numHands:2}. */
export const DEFAULT_TRACKER:{engine:TrackerEngine;numHands:1|2}={engine:"landmarker",numHands:1};
let model:GestureRecognizer|HandLandmarker|null=null;
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
 if(await sha256(bytes)!==pin.sha256)throw new Error("Hand model checksum mismatch");
 return bytes;
}
async function sha256(bytes:Uint8Array<ArrayBuffer>){
 const digest=await crypto.subtle.digest("SHA-256",bytes);
 return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,"0")).join("");
}
/** The landmarker bundle inside the verified gesture bundle, checked again by its own pin. */
async function landmarkerTask(bundle:Uint8Array){
 const pin=VISION_MODELS.gesture.handLandmarker;
 const inner=storedZipEntry(bundle,"hand_landmarker.task").slice();
 if(inner.length!==pin.bytes||await sha256(inner)!==pin.sha256)throw new Error("Hand landmarker checksum mismatch");
 return inner;
}
function handFrame(bitmap:ImageBitmap,timestamp:number):{frame:VisionFrame;handsMs:number;prepMs:number;inferMs:number}{
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
 const prepared=performance.now();
 const value=model instanceof GestureRecognizer?model.recognizeForVideo(pixels,timestamp):model.detectForVideo(pixels,timestamp);
 const finished=performance.now();
 const frame:VisionFrame={timestamp,hands:value.landmarks.map((points,i)=>{
   const label=value.handedness[i]?.[0]?.categoryName;
   return {landmarks:points.map(p=>({x:p.x,y:p.y,z:p.z})),handedness:label==="Left"||label==="Right"?label:"Unknown",
    gesture:"None",gestureScore:0};
  }),face:[],pose:[]};
 return {frame,handsMs:finished-started,prepMs:prepared-started,inferMs:finished-prepared};
}
self.onmessage=async({data}:MessageEvent)=>{
 try{
  if(data.type==="init"){
   self.postMessage({type:"progress",message:"Loading hand tracking"});
   const engine:TrackerEngine=data.engine==="gesture"||data.engine==="landmarker"?data.engine:DEFAULT_TRACKER.engine;
   const numHands=data.numHands===1||data.numHands===2?data.numHands:DEFAULT_TRACKER.numHands;
   const files=await FilesetResolver.forVisionTasks(LOCAL_WASM_PATH);
   const bundle=await reviewedTask();
   const options={canvas:new OffscreenCanvas(1,1),runningMode:"VIDEO" as const,numHands,
    minHandDetectionConfidence:.55,minHandPresenceConfidence:.55,minTrackingConfidence:.55};
   model=engine==="gesture"
    ?await GestureRecognizer.createFromOptions(files,{baseOptions:{modelAssetBuffer:bundle,delegate:"CPU"},...options})
    :await HandLandmarker.createFromOptions(files,{baseOptions:{modelAssetBuffer:await landmarkerTask(bundle),delegate:"CPU"},...options});
   self.postMessage({type:"warming"});const surface=new OffscreenCanvas(256,256);const context=surface.getContext("2d")!;
   context.fillStyle="#20242c";context.fillRect(0,0,256,256);
   const probe=surface.transferToImageBitmap();
   try{if(model instanceof GestureRecognizer)model.recognizeForVideo(probe,1);else model.detectForVideo(probe,1);}finally{probe.close();}
   self.postMessage({type:"ready",assetSource:"self-hosted",delegate:"CPU",engine,numHands});
  }else if(data.type==="frame"&&model){
   const bitmap=data.bitmap as ImageBitmap;
   try{
    const {frame,handsMs,prepMs,inferMs}=handFrame(bitmap,data.timestamp);
    self.postMessage({type:"hands",frame,handsMs});
    self.postMessage({type:"result",frame,timings:{hands:handsMs,auxiliary:0,prep:prepMs,infer:inferMs}});
   }finally{bitmap.close();}
  }
 }catch(error){self.postMessage({type:"error",message:error instanceof Error?error.message:String(error)});}
};
