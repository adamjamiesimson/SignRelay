import {describe,it,expect} from "vitest";
import {FingerspellingSamplingClock} from "../lib/fingerspelling-sampling";
import {FingerspellingCapture} from "../lib/fingerspelling-capture";
import {makeSign} from "./fixtures/asl-motion";
describe("decoded media sampling and intentional boundaries",()=>{
 it("selects the same 15 Hz decoded slots despite callback wall-clock jitter",()=>{
  const select=(offset:number)=>{const c=new FingerspellingSamplingClock();return Array.from({length:61},(_,i)=>({media:i/30,wall:i*33.3+offset*(i%3)})).flatMap(f=>c.take(f.media)===null?[]:[f.media]);};
  expect(select(1)).toEqual(select(20));expect(select(1)).toHaveLength(31);
 });
 it("does not duplicate, reverse or interpolate missing decoded slots",()=>{
  const c=new FingerspellingSamplingClock();
  expect([0,.033,.067,.067,.05,.3].map(x=>c.take(x))).toEqual([0,null,1,null,null,4]);
 });
 it("excludes pre-click and post-finish pixels even when results arrive late",()=>{
  const c=new FingerspellingCapture(1,"v3",1000);c.seal(1200);
  const frame=makeSign("SORRY")[0];
  for(const at of [990,1000,1067,1134,1200,1201])c.push({...frame,timestamp:at,capturedAt:at} as typeof frame);
  expect(c.diagnostics().frames).toBe(4);expect(c.diagnostics().durationMs).toBe(200);
  c.dispose();expect(c.diagnostics().frames).toBe(0);
 });
});
