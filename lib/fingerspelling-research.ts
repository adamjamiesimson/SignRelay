import type {CaptureDiagnostics} from "./fingerspelling-capture";
export const RESEARCH_PROMPTS=[
 {id:"anna",kind:"positive",text:"ANNA",instruction:"Fingerspell ANNA, including both N letters."},
 {id:"quinn",kind:"positive",text:"QUINN",instruction:"Fingerspell QUINN."},
 {id:"jazz",kind:"positive",text:"JAZZ",instruction:"Fingerspell JAZZ, including the J and Z movement."},
 {id:"lily",kind:"positive",text:"LILY",instruction:"Fingerspell LILY."},
 {id:"rest",kind:"negative",text:"",instruction:"Rest your hands out of view for three seconds."},
 {id:"wave",kind:"negative",text:"",instruction:"Wave naturally for three seconds. Do not fingerspell."},
 {id:"wash",kind:"negative",text:"",instruction:"Mime washing your hands for three seconds. Do not fingerspell."},
 {id:"clothing",kind:"negative",text:"",instruction:"Adjust your sleeve naturally. Do not fingerspell."},
 {id:"other-sign",kind:"negative",text:"",instruction:"Use a familiar non-fingerspelled sign for three seconds."},
] as const;
export type ResearchOutcome="candidate"|"abstained"|"quality-rejected"|"technical-failure"|"cancelled";
export type ResearchContext={device:"Windows"|"Mac"|"Android"|"iPhone"|"other";hand:"Right"|"Left"|"both";light:"front-lit"|"dim"|"back-lit";speed:"usual"|"slow"|"fast"};
export type ResearchDraft={promptId:string;startedAt:number;finishedAt?:number;quality?:CaptureDiagnostics;context:ResearchContext};
export type ResearchPending=ResearchDraft&{prediction:string;outcome:ResearchOutcome;finishToResultMs:number|null;inferenceMs:number|null};
export type ResearchTrial=ResearchPending&{truth:string;issue:"none"|"incorrect"|"missing"|"unexpected"|"tracking";exact:boolean|null;edits:number|null;characters:number;candidateShown:boolean};
export function researchDistance(a:string,b:string) {
 let prior=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=0;i<a.length;i++){const next=[i+1];for(let j=0;j<b.length;j++)next.push(Math.min(next[j]+1,prior[j+1]+1,prior[j]+(a[i]===b[j]?0:1)));prior=next;}
 return prior[b.length];
}
export function makeResearchTrial(p:ResearchPending,truth:string,issue:ResearchTrial["issue"]):ResearchTrial {
 const prompt=RESEARCH_PROMPTS.find(x=>x.id===p.promptId);if(!prompt)throw new Error("Unknown test prompt");
 const text=truth.trim().replace(/\s+/g," ").toUpperCase();
 if(prompt.kind==="positive"&&(!/^[A-Z ]{1,32}$/.test(text)))throw new Error("Enter the letters you actually signed (up to 32 A–Z letters/spaces).");
 const completed=!["cancelled","technical-failure"].includes(p.outcome);
 const candidateShown=p.outcome==="candidate"&&!!p.prediction.trim();
 const reference=prompt.kind==="positive"?text:"";
 return {...p,truth:reference,issue,candidateShown,characters:reference.length,
  exact:completed&&prompt.kind==="positive"?p.prediction===reference:null,
  edits:completed&&prompt.kind==="positive"?researchDistance(reference,p.prediction):null};
}
const number=(x:unknown)=>typeof x==="number"&&Number.isFinite(x)?Math.round(x*1000)/1000:null;
/** Explicit allowlist. Never serialize a trial, context or quality object directly:
 * local ground truth, predictions, absolute timestamps, landmarks and identifiers
 * must not silently become part of the optional metrics export. */
export function exportResearchMetrics(trials:ResearchTrial[],consent:boolean,modelSha256:string) {
 if(!consent)throw new Error("Choose metrics export before downloading");
 if(trials.length>100)throw new Error("Export at most 100 local results");
 return {schema:"signrelay-fingerspelling-metrics-v1",modelSha256,physicalCameraEvidence:"participant-reported; device and signing labels not independently verified",
  textIncluded:false,videoIncluded:false,landmarksIncluded:false,signerIndependence:"unknown; do not treat anonymous files as independent signers",
  trials:trials.map(t=>{
   const prompt=RESEARCH_PROMPTS.find(p=>p.id===t.promptId);if(!prompt)throw new Error("Unknown prompt");
   const q=t.quality;
   return {promptId:prompt.id,kind:prompt.kind,
    context:{device:["Windows","Mac","Android","iPhone","other"].includes(t.context.device)?t.context.device:"other",hand:["Right","Left","both"].includes(t.context.hand)?t.context.hand:"both",light:["front-lit","dim","back-lit"].includes(t.context.light)?t.context.light:"front-lit",speed:["usual","slow","fast"].includes(t.context.speed)?t.context.speed:"usual"},
    outcome:t.outcome,issue:t.issue,candidateShown:t.candidateShown,exact:t.exact,edits:t.edits,referenceCharacters:t.characters,predictedCharacters:t.prediction.length,
    finishToResultMs:number(t.finishToResultMs),inferenceMs:number(t.inferenceMs),
    tracking:q?{frames:q.frames,dominantReturnedCategory:q.dominantSide,leftFrames:q.leftFrames,rightFrames:q.rightFrames,visibleFrames:q.visibleFrames,missingFrames:q.missingFrames,observedFps:number(q.observedFps),durationMs:number(q.durationMs),maxFrameGapMs:number(q.maxFrameGapMs),longestMissingMs:number(q.longestMissingMs),relativeFrameMs:q.relativeFrameMs.slice(0,512).map(number)}:null};
  })};
}
export function researchSummary(trials:ResearchTrial[]){
 const completed=trials.filter(t=>t.outcome!=="cancelled"&&t.outcome!=="technical-failure");
 const positive=completed.filter(t=>RESEARCH_PROMPTS.find(p=>p.id===t.promptId)?.kind==="positive"),negative=completed.filter(t=>RESEARCH_PROMPTS.find(p=>p.id===t.promptId)?.kind==="negative");
 return {positive:positive.length,positiveCandidates:positive.filter(t=>t.candidateShown).length,positiveExact:positive.filter(t=>t.exact).length,positiveCharacters:positive.reduce((n,t)=>n+t.characters,0),positiveEdits:positive.reduce((n,t)=>n+(t.edits??0),0),
 negative:negative.length,negativeCandidates:negative.filter(t=>t.candidateShown).length,technicalFailures:trials.filter(t=>t.outcome==="technical-failure").length,cancellations:trials.filter(t=>t.outcome==="cancelled").length};
}
