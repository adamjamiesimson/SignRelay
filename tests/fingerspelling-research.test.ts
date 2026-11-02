import {describe,it,expect} from "vitest";
import {makeResearchTrial,exportResearchMetrics,researchSummary,type ResearchPending} from "../lib/fingerspelling-research";
const base:ResearchPending={promptId:"anna",startedAt:123456,finishedAt:124000,context:{device:"Windows",hand:"Left",light:"front-lit",speed:"usual"},outcome:"candidate",prediction:"ANA",inferenceMs:2,finishToResultMs:20};
describe("consented text-free research metrics",()=>{
 it("keeps positive coverage visible while scoring errors and negative false candidates",()=>{
  const a=makeResearchTrial(base,"ANNA","incorrect"),b=makeResearchTrial({...base,promptId:"wash",prediction:"AOH"},"","unexpected"),c=makeResearchTrial({...base,outcome:"quality-rejected",prediction:""},"ANNA","missing");
  expect(researchSummary([a,b,c])).toMatchObject({positive:2,positiveCandidates:1,positiveExact:0,positiveEdits:5,positiveCharacters:8,negative:1,negativeCandidates:1});
 });
 it("exports no prediction, corrected text, absolute timestamp or injected identifiers",()=>{
  const t=makeResearchTrial({...base,context:{...base.context,device:"PERSONAL IDENTIFIER" as never}},"PRIVATE NAME","incorrect");
  expect(()=>exportResearchMetrics([t],false,"sha")).toThrow("Choose metrics");
  const s=JSON.stringify(exportResearchMetrics([t],true,"sha"));
  for(const secret of ["PRIVATE NAME","ANA", "123456","124000","PERSONAL IDENTIFIER"])expect(s).not.toContain(secret);
  expect(JSON.parse(s).trials[0].context.device).toBe("other");
 });
 it("separates technical failures and cancellation from rejection/accuracy counts",()=>{
  const trials=["technical-failure","cancelled"].map(outcome=>makeResearchTrial({...base,outcome:outcome as ResearchPending["outcome"],prediction:""},"ANNA","tracking"));
  expect(researchSummary(trials)).toMatchObject({positive:0,negative:0,technicalFailures:1,cancellations:1});
 });
});
