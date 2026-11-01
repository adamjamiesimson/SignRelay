import type { VisionFrame, HandObservation } from "./vision-types";
import { normalizeFingerspellingHand, normalizeFingerspellingMotion } from "./fingerspelling-features";

type Sample = { time:number; capturedAt:number; hands:HandObservation[] };
/** Explicit bounded sequence capture. These are input-quality gates, not
 * calibrated rejection of non-sign movement or a recognition confidence. */
export class FingerspellingCapture {
  private samples:Sample[]=[];
  private endAt=Infinity;
  constructor(private aspect:number, private featureVersion:"v2"|"v3"="v2",private startAt=-Infinity) {
    if(!Number.isFinite(aspect)||aspect<=0)throw new Error("Camera dimensions unavailable");
  }
  push(frame:VisionFrame, aspect=this.aspect) {
    if(!Number.isFinite(aspect)||Math.abs(aspect-this.aspect)>1e-6)throw new Error("Camera orientation changed; record again");
    const capturedAt=(frame as VisionFrame&{capturedAt?:number}).capturedAt??frame.timestamp;
    if(capturedAt<this.startAt||capturedAt>this.endAt)return;
    const last=this.samples.at(-1);
    if(!Number.isFinite(frame.timestamp)||(last&&frame.timestamp<=last.time))return;
    if(this.samples.length>=512)throw new Error("Capture is too long; record again");
    this.samples.push({time:frame.timestamp,capturedAt,hands:frame.hands.map(h=>({...h,landmarks:h.landmarks.map(p=>({...p}))}))});
  }
  seal(endAt:number) {if(!Number.isFinite(endAt))throw new Error("Invalid capture boundary");this.endAt=endAt;}
  dispose() {this.samples=[];}
  diagnostics() {
    const s=this.samples,t=s.map(x=>x.time),gaps=t.slice(1).map((v,i)=>v-t[i]),visible=s.map(x=>x.hands.some(h=>h.landmarks.length===21&&h.landmarks.every(p=>[p.x,p.y,p.z].every(Number.isFinite))));
    const duration=s.length>1?t.at(-1)!-t[0]:0;
    let longestMissingMs=0,missingStart:number|null=null;
    for(let i=0;i<s.length;i++){if(!visible[i])missingStart??=t[i];else if(missingStart!==null){longestMissingMs=Math.max(longestMissingMs,t[i]-missingStart);missingStart=null;}}
    if(missingStart!==null)longestMissingMs=Math.max(longestMissingMs,t.at(-1)!-missingStart);
    return {frames:s.length,durationMs:duration,observedFps:duration?(s.length-1)*1000/duration:0,
      maxFrameGapMs:Math.max(0,...gaps),visibleFrames:visible.filter(Boolean).length,missingFrames:visible.filter(x=>!x).length,longestMissingMs,
      relativeFrameMs:t.map(v=>Math.round((v-t[0])*1000)/1000)};
  }
  finish() {
    const samples=this.samples;
    if(samples.length<2)throw new Error("No camera frames captured");
    const duration=samples.at(-1)!.time-samples[0].time;
    if(duration<850||duration>16000)throw new Error("Capture a complete name lasting 1–16 seconds");
    if((samples.length-1)*1000/duration<12)throw new Error("Tracking is too slow; try better lighting or another device");
    for(let i=1;i<samples.length;i++)if(samples[i].time-samples[i-1].time>200)throw new Error("Tracking was interrupted; record again");
    const frames=this.featureVersion==="v3"?samples.length:Math.floor(duration*15/1000)+1;
    if(frames>320)throw new Error("Capture contains too many frames; record again");
    const times=new Float64Array(frames);
    const hands={Left:new Float32Array(frames*63).fill(NaN),Right:new Float32Array(frames*63).fill(NaN)};
    const visible={Left:0,Right:0};
    let index=0;
    for(let t=0;t<frames;t++){
      const target=this.featureVersion==="v3"?samples[t].time:samples[0].time+t*1000/15;
      while(index+1<samples.length&&Math.abs(samples[index+1].time-target)<Math.abs(samples[index].time-target))index++;
      if(Math.abs(samples[index].time-target)>100)throw new Error("Camera timing is irregular; record again");
      times[t]=samples[index].time/1000;
      for(const side of ["Left","Right"] as const){
        const hand=samples[index].hands.find(h=>h.handedness===side&&h.landmarks.length===21&&h.landmarks.every(p=>[p.x,p.y,p.z].every(Number.isFinite)));
        if(!hand)continue;
        visible[side]++;
        hand.landmarks.forEach((p,j)=>hands[side].set([p.x,p.y,p.z],t*63+j*3));
      }
    }
    const side=visible.Left>=visible.Right?"Left":"Right";
    if(visible[side]/frames<.6)throw new Error("Keep one hand clearly visible throughout the name");
    return {features:this.featureVersion==="v3"?normalizeFingerspellingMotion(hands[side],times,frames,side,this.aspect):normalizeFingerspellingHand(hands[side],frames,side,this.aspect),frames};
  }
}

export type CaptureDiagnostics=ReturnType<FingerspellingCapture["diagnostics"]>;
