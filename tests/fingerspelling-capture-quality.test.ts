import { describe, expect, it } from "vitest";
import { FingerspellingCapture } from "../lib/fingerspelling-capture";
import { makeSign } from "./fixtures/asl-motion";
import type { VisionFrame } from "../lib/vision-types";

// Synthetic landmark contract tests. These do not establish letter accuracy,
// physical handedness, RGB mirroring or rejection of ordinary movement.
const frames=()=>makeSign("SORRY",{duration:2000,count:31});
function capture(input:VisionFrame[],start=-Infinity,end=Infinity){
  const c=new FingerspellingCapture(4/3,"v3",start);
  if(Number.isFinite(end))c.seal(end);
  for(const frame of input)c.push(frame);
  return c;
}
describe("fingerspelling sequence quality and time contracts",()=>{
  it.each([900,8000,15900])("accepts an observed %i ms sequence without padding or duplicating frames",duration=>{
    const input=makeSign("SORRY",{duration,count:Math.floor(duration*15/1000)+1});
    const c=capture(input),result=c.finish();
    expect(result.frames).toBe(input.length);expect(result.features).toHaveLength(input.length*132);
    expect(Array.from(result.features).every(Number.isFinite)).toBe(true);c.dispose();
  });
  it("is independent of the absolute media-time origin",()=>{
    const input=frames(),a=capture(input).finish(),b=capture(input.map(f=>({...f,timestamp:f.timestamp+500000}))).finish();
    // Timestamp subtraction can differ by a final floating-point rounding bit.
    expect(a.frames).toBe(b.frames);
    for(let i=0;i<a.features.length;i++)expect(a.features[i]).toBeCloseTo(b.features[i],5);
  });
  it("keeps short missing-hand runs as explicit zero observations and clears their velocities",()=>{
    const input=frames().map((f,i)=>i>=10&&i<=13?{...f,hands:[]}:f),c=capture(input);
    const result=c.finish();expect(result.frames).toBe(31);expect(c.diagnostics().missingFrames).toBe(4);
    for(let i=10;i<=13;i++)expect(result.features.slice(i*132,(i+1)*132).every(x=>x===0)).toBe(true);
    expect(result.features.slice(14*132+65,14*132+130).every(x=>x===0)).toBe(true);
  });
  it("abstains on no hands and on insufficient visibility, rather than feeding a stale sign",()=>{
    expect(()=>capture(frames().map(f=>({...f,hands:[]}))).finish()).toThrow(/visible/);
    expect(()=>capture(frames().map((f,i)=>i<15?{...f,hands:[]}:f)).finish()).toThrow(/visible/);
  });
  it("rejects slow tracking and an interrupted stream even with a visible hand at Finish",()=>{
    expect(()=>capture(makeSign("SORRY",{duration:2000,count:20})).finish()).toThrow(/slow/);
    expect(()=>capture(frames().filter((_,i)=>i<10||i>13)).finish()).toThrow(/interrupted/);
  });
  it("does not let duplicate or reversed observations manufacture coverage",()=>{
    const input=frames(),c=capture(input.flatMap(f=>[f,f,{...f,timestamp:f.timestamp-1}]));
    expect(c.diagnostics().frames).toBe(input.length);expect(c.finish().frames).toBe(input.length);
  });
  it("excludes the prior and next capture even when all results arrive after Finish",()=>{
    const input=frames(),c=new FingerspellingCapture(4/3,"v3",1200);c.seal(2800);
    for(const f of input)c.push({...f,capturedAt:f.timestamp} as VisionFrame);
    expect(c.diagnostics().durationMs).toBe(1600);expect(c.diagnostics().frames).toBe(25);
    expect(c.finish().frames).toBe(25);
  });
  it("preserves canonical coordinates under declared landmark reflection/category swap",()=>{
    const input=frames(),mirror=input.map(f=>({...f,hands:f.hands.map(h=>({...h,handedness:"Left" as const,
      landmarks:h.landmarks.map(p=>({...p,x:1-p.x}))}))}));
    const a=capture(input).finish().features,b=capture(mirror).finish().features;
    for(let i=0;i<a.length;i++)expect(a[i]).toBeCloseTo(b[i],4);
  });
  it("rejects camera orientation changes instead of mixing coordinate systems",()=>{
    const c=capture(frames().slice(0,10));expect(()=>c.push(frames()[10],3/4)).toThrow(/orientation/);
  });
});
