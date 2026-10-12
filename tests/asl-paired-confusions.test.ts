import { describe, expect, it } from "vitest";
import { analyzePair, renderReport } from "../scripts/report-asl-confusions.mjs";

const hash = (id: number) => String(id).padStart(64,"0");
function sign(id: number, gloss: string, predicted: string | null = gloss, outcome = "correct") {
  return {
    fixture_id:"fixture-"+id, language:"asl", trial_type:"sign",
    expected_gloss:gloss, predicted_gloss:predicted, accepted:predicted!==null, outcome,
    source_file:"clip-"+id+".mp4", notes:"sha256="+hash(id),
    participant_id:"anonymous-signer-"+id, device:"phone", condition:"front",
    frame_mode:"source-frames-only", tracker:{hand_coverage:0.7},
  };
}
function negative(id: number, accepted=false) {
  return {
    ...sign(id,"NO_SIGN",accepted?"HELLO":null,accepted?"false_accept":"correct_reject"),
    trial_type:"no_sign", expected_gloss:null,
  };
}
describe("paired ASL confusion diagnostics",()=>{
  it("separates HELLO/THANK YOU/PLEASE confusions and unstable outcomes",()=>{
    const a=[sign(1,"HELLO","THANK YOU","wrong"), sign(2,"THANK YOU","PLEASE","wrong"),sign(3,"PLEASE"),negative(4)];
    const b=[sign(1,"HELLO",null,"rejected"), sign(2,"THANK YOU","PLEASE","wrong"),sign(3,"PLEASE"),negative(4)];
    const r=analyzePair(a,b);
    expect(r.changed).toEqual(["fixture-1"]);
    expect(r.signed).toBe(3);
    expect(r.confusion).toEqual(expect.arrayContaining([
      {parts:["A","HELLO","THANK YOU"],count:1},
      {parts:["B","THANK YOU","PLEASE"],count:1},
    ]));
    expect(renderReport(r)).toContain("NOT independent-signer accuracy");
    expect(renderReport(r)).toContain("HELLO |");
  });
  it("rejects source fingerprint or signer changes between runs",()=>{
    const item=sign(1,"HELLO");
    expect(()=>analyzePair([item],[{...item,participant_id:"different-signer"}])).toThrow(/participant_id/);
    expect(()=>analyzePair([item],[{...item,notes:"sha256="+hash(9)}])).toThrow(/notes/);
  });
  it("refuses missing SHA, duplicate video content, or duplicate/missing fixtures",()=>{
    const a=sign(1,"HELLO"),b={...sign(2,"THANK YOU"),notes:a.notes};
    expect(()=>analyzePair([a,b],[a,b])).toThrow(/Duplicate source SHA-256/);
    expect(()=>analyzePair([{...a,notes:"no fingerprint"}],[{...a,notes:"no fingerprint"}])).toThrow(/SHA-256 provenance/);
    expect(()=>analyzePair([a,a],[a,a])).toThrow(/duplicate or missing fixture ID/);
    expect(()=>analyzePair([a],[sign(2,"HELLO")])).toThrow(/same fixture IDs/);
  });
  it("rejects inconsistent labels or false positive metadata",()=>{
    const a=sign(1,"HELLO");
    expect(()=>analyzePair([{...a,predicted_gloss:"PLEASE"}],[{...a,predicted_gloss:"PLEASE"}])).toThrow(/inconsistent correct/);
    const n=negative(2,true);
    expect(()=>analyzePair([{...n,accepted:false}],[{...n,accepted:false}])).toThrow(/inconsistent no-sign/);
  });
  it("counts false accepts separately from sign correctness without claiming readiness",()=>{
    const a=[sign(1,"HELLO"),negative(2,true)];
    const b=[sign(1,"HELLO"),negative(2,false)];
    const r=analyzePair(a,b);
    expect(r.falseA).toBe(1);
    expect(r.falseB).toBe(0);
    expect(r.lowCoverage).toContain("HELLO");
    expect(r.lowNegatives).toBe(true);
    expect(renderReport(r)).toContain("Fewer than ten non-sign-intent clips");
  });
});