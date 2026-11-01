import {describe,it,expect} from "vitest";
import {decodeCtc} from "../lib/fingerspelling-ctc-runtime";
import {visualBeam} from "../lib/fingerspelling-decoding";
const frame=(blank:number,a:number)=>{const x=new Float32Array(28).fill(Math.log(1e-12));x[0]=Math.log(blank);x[2]=Math.log(a);return x;};
describe("language-free CTC path marginalisation (software math checks)",()=>{
 it("can recover A from two blank-dominant frames by summing valid paths",()=>{
  const x=new Float32Array([...frame(.6,.4),...frame(.6,.4)]);
  expect(decodeCtc(x,2).text).toBe("");
  expect(visualBeam(x,2)).toBe("A");
 });
 it("preserves a blank-separated double A and collapses a held A",()=>{
  expect(visualBeam(new Float32Array([...frame(.05,.95),...frame(.95,.05),...frame(.05,.95)]),3)).toBe("AA");
  expect(visualBeam(new Float32Array([...frame(.05,.95),...frame(.05,.95),...frame(.05,.95)]),3)).toBe("A");
 });
});
