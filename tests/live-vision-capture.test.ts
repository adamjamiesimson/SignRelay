import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../lib/vision-engine", () => ({ VisionEngine: { create: vi.fn() } }));
import { LiveVision } from "../lib/live-vision";
import { makeSign } from "./fixtures/asl-motion";
class Port {
  static all: Port[]=[];
  onmessage: ((e:{data:unknown})=>void)|null=null; onerror:(()=>void)|null=null; onmessageerror=null;
  terminate=vi.fn();
  postMessage=vi.fn((d:{type:string})=>{if(d.type==="init")queueMicrotask(()=>this.emit({type:"ready",assetSource:"self-hosted",delegate:"CPU"}));});
  constructor(){Port.all.push(this);}
  emit(data:unknown){this.onmessage?.({data});}
}
let now=100;
const bitmaps:{close:ReturnType<typeof vi.fn>}[]=[];
function video(){
  let callback:VideoFrameRequestCallback;
  const v={videoWidth:640,videoHeight:480,requestVideoFrameCallback:vi.fn((cb:VideoFrameRequestCallback)=>{callback=cb;return 1;}),cancelVideoFrameCallback:vi.fn()};
  return {element:v as unknown as HTMLVideoElement, sample:(mediaTime:number)=>callback(now,{mediaTime,expectedDisplayTime:now,presentedFrames:mediaTime*30} as VideoFrameCallbackMetadata)};
}
beforeEach(()=>{
  Port.all=[];bitmaps.length=0;now=100;
  vi.spyOn(performance,"now").mockImplementation(()=>now);
  vi.stubGlobal("Worker",Port);vi.stubGlobal("createImageBitmap",vi.fn());
  vi.stubGlobal("OffscreenCanvas",class {width:number;height:number;constructor(w:number,h:number){this.width=w;this.height=h;}
    getContext(){return {drawImage:vi.fn()};} transferToImageBitmap(){const b={close:vi.fn()};bitmaps.push(b);return b;}});
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe("decoded capture buffer lifecycle",()=>{
  it.each(["ready","warming"])("keeps the frame watchdog after a stale %s startup message",async(type)=>{
    vi.useFakeTimers();
    const live=await LiveVision.create(undefined,false,undefined,"fingerspelling"),v=video(),failure=vi.fn();
    await live.process(v.element,now,vi.fn());v.sample(1);
    const frame=live.process(v.element,now,vi.fn()).catch(failure);
    try{
      Port.all[0].emit({type,assetSource:"self-hosted",delegate:"CPU"});
      await vi.advanceTimersByTimeAsync(4001);
      expect(failure).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(4000);
      expect(failure).toHaveBeenCalledOnce();
      expect(failure.mock.calls[0][0].message).toBe("Tracking frame timed out");
    }finally{live.close();await frame;vi.useRealTimers();}
  });
  it("releases the pending pre-failure bitmap before worker recovery",async()=>{
    const live=await LiveVision.create(undefined,false,undefined,"fingerspelling"),v=video();
    await live.process(v.element,now,vi.fn());v.sample(1);
    const first=live.process(v.element,now,vi.fn());now+=67;v.sample(1.067);
    const rejected=expect(first).rejects.toThrow("interrupted");Port.all[0].onerror?.();await rejected;
    expect(bitmaps[1].close).toHaveBeenCalledOnce();
    live.close();expect(bitmaps[1].close).toHaveBeenCalledOnce();
  });
  it("closes replaced and stopped bitmaps exactly once, retaining only the latest slot",async()=>{
    const live=await LiveVision.create(undefined,false,undefined,"fingerspelling"),v=video();
    await live.process(v.element,now,vi.fn());for(let i=0;i<100;i++){now+=67;v.sample(1+i/15);}
    expect(bitmaps).toHaveLength(100);expect(bitmaps.slice(0,-1).every(b=>b.close.mock.calls.length===1)).toBe(true);
    live.close();expect(bitmaps.at(-1)!.close).toHaveBeenCalledOnce();
    v.sample(9);expect(bitmaps).toHaveLength(100);
  });
  it("drains the final pre-Finish snapshot and excludes post-Finish decoded callbacks",async()=>{
    const live=await LiveVision.create(undefined,false,undefined,"fingerspelling"),v=video(),draw=vi.fn();
    await live.process(v.element,now,draw);v.sample(1);
    const first=live.process(v.element,now,draw);now+=67;v.sample(1.067);
    const drain=live.drain(v.element,now,draw);now+=67;v.sample(1.134);
    const complete=()=>{const frame={...makeSign("SORRY")[0],timestamp:now};Port.all[0].emit({type:"hands",frame,handsMs:10});Port.all[0].emit({type:"result",frame,timings:{hands:10,auxiliary:0}});};
    complete();await first;await Promise.resolve();complete();await drain;
    expect(bitmaps).toHaveLength(2);expect(draw.mock.calls.map(([f])=>f.capturedAt)).toEqual([100,167]);live.close();
  });
});
