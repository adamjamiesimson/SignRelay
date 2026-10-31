import type { VisionFrame, HandObservation } from "./vision-types";
import { normalizeFingerspellingHand } from "./fingerspelling-features";

type Sample = { time:number; hands:HandObservation[] };
/** Explicit bounded sequence capture. These are input-quality gates, not
 * calibrated rejection of non-sign movement or a recognition confidence. */
export class FingerspellingCapture {
  private samples:Sample[]=[];
  constructor(private aspect:number) {
    if(!Number.isFinite(aspect)||aspect<=0)throw new Error("Camera dimensions unavailable");
  }
  push(frame:VisionFrame) {
    const last=this.samples.at(-1);
    if(!Number.isFinite(frame.timestamp)||(last&&frame.timestamp<=last.time))return;
    if(this.samples.length>=512)throw new Error("Capture is too long; record again");
    this.samples.push({time:frame.timestamp,hands:frame.hands.map(h=>({...h,landmarks:h.landmarks.map(p=>({...p}))}))});
  }
  finish() {
    const samples=this.samples;
    if(samples.length<2)throw new Error("No camera frames captured");
    const duration=samples.at(-1)!.time-samples[0].time;
    if(duration<850||duration>16000)throw new Error("Capture a complete name lasting 1–16 seconds");
    if((samples.length-1)*1000/duration<12)throw new Error("Tracking is too slow; try better lighting or another device");
    for(let i=1;i<samples.length;i++)if(samples[i].time-samples[i-1].time>200)throw new Error("Tracking was interrupted; record again");
    const frames=Math.floor(duration*15/1000)+1;
    const hands={Left:new Float32Array(frames*63).fill(NaN),Right:new Float32Array(frames*63).fill(NaN)};
    const visible={Left:0,Right:0};
    let index=0;
    for(let t=0;t<frames;t++){
      const target=samples[0].time+t*1000/15;
      while(index+1<samples.length&&Math.abs(samples[index+1].time-target)<Math.abs(samples[index].time-target))index++;
      if(Math.abs(samples[index].time-target)>100)throw new Error("Camera timing is irregular; record again");
      for(const side of ["Left","Right"] as const){
        const hand=samples[index].hands.find(h=>h.handedness===side&&h.landmarks.length===21&&h.landmarks.every(p=>[p.x,p.y,p.z].every(Number.isFinite)));
        if(!hand)continue;
        visible[side]++;
        hand.landmarks.forEach((p,j)=>hands[side].set([p.x,p.y,p.z],t*63+j*3));
      }
    }
    const side=visible.Left>=visible.Right?"Left":"Right";
    if(visible[side]/frames<.6)throw new Error("Keep one hand clearly visible throughout the name");
    return {features:normalizeFingerspellingHand(hands[side],frames,side,this.aspect),frames};
  }
}
