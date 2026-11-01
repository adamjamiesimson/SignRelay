/** Language-free CTC prefix beam. No names, dictionary or language model. */
import {CTC_VOCABULARY} from "./fingerspelling-vocabulary";
const neg=-Infinity;
function add(a:number,b:number){if(a===neg)return b;if(b===neg)return a;return Math.max(a,b)+Math.log1p(Math.exp(-Math.abs(a-b)));}
export function visualBeam(logits:Float32Array,frames:number,width=8){
 type State={text:string;blank:number;nonblank:number;last:number};
 let beams:State[]=[{text:"",blank:0,nonblank:neg,last:0}];
 for(let t=0;t<frames;t++){
  const at=t*28,max=Math.max(...logits.subarray(at,at+28));let sum=0;
  for(let c=0;c<28;c++)sum+=Math.exp(logits[at+c]-max);
  const logsum=Math.log(sum),lp=Array.from({length:28},(_,c)=>logits[at+c]-max-logsum);
  const choices=Array.from({length:27},(_,i)=>i+1).sort((a,b)=>lp[a]-lp[b]||a-b).slice(-4);
  const next=new Map<string,State>();
  const update=(text:string,last:number,blank=neg,nonblank=neg)=>{
   const prior=next.get(text);
   if(prior){prior.blank=add(prior.blank,blank);prior.nonblank=add(prior.nonblank,nonblank);}
   else next.set(text,{text,last,blank,nonblank});
  };
  for(const state of beams){
   const total=add(state.blank,state.nonblank);update(state.text,state.last,total+lp[0]);
   for(const c of choices){
    if(state.text&&c===state.last){update(state.text,state.last,neg,state.nonblank+lp[c]);update(state.text+CTC_VOCABULARY[c],c,neg,state.blank+lp[c]);}
    else update(state.text+CTC_VOCABULARY[c],c,neg,total+lp[c]);
   }
  }
  beams=[...next.values()].sort((a,b)=>add(b.blank,b.nonblank)-add(a.blank,a.nonblank)).slice(0,width);
 }
 return beams[0].text;
}
export type SequenceCalibration={means:number[];standardDeviations:number[];intercept:number;coefficients:number[]};
export function visualConfidenceFeatures(logits:Float32Array,frames:number,features:Float32Array,inputSize:number,presence:number,text:string){
 const emitted:number[]=[];let previous=-1,entropy=0,blank=0,visible=0,run=0,longest=0;
 for(let t=0;t<frames;t++){
  const at=t*28;let best=0,max=-Infinity;
  for(let c=0;c<28;c++)if(logits[at+c]>max){best=c;max=logits[at+c];}
  let sum=0;for(let c=0;c<28;c++)sum+=Math.exp(logits[at+c]-max);
  const logsum=Math.log(sum);
  for(let c=0;c<28;c++){const lp=logits[at+c]-max-logsum;entropy-=Math.exp(lp)*lp;}
  if(best&&best!==previous)emitted.push(-logsum);
  previous=best;if(!best)blank++;
  if(features[t*inputSize+presence]>0){visible++;run=0;}else{run++;longest=Math.max(longest,run);}
 }
 return [emitted.length?emitted.reduce((a,b)=>a+b,0)/emitted.length:-20,emitted.length?Math.min(...emitted):-20,
  entropy/frames/Math.log(28),blank/frames,text.length/frames,visible/frames,longest/frames];
}
export function exactSequenceProbability(values:number[],cal:SequenceCalibration){
 let z=cal.intercept;
 for(let i=0;i<7;i++)z+=(values[i]-cal.means[i])/cal.standardDeviations[i]*cal.coefficients[i];
 return 1/(1+Math.exp(-Math.max(-30,Math.min(30,z))));
}
