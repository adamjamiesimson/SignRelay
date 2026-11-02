import { describe, expect, it } from "vitest";
import { compileDistanceSequence, compiledSequenceDistance } from "../lib/personalized-recognition";

// Independent full matrix oracle. Exact equality protects accumulation order,
// masks, legacy padding and every warping path, including repeated query rows.
function oracle(a:number[][],b:number[][]) {
  const pad=(rows:number[][])=>rows.map(r=>r.length===208?[...r,...Array(32).fill(0)]:r);
  a=pad(a);b=pad(b);const n=a[0].length;
  const dp=Array.from({length:a.length+1},()=>new Float64Array(b.length+1).fill(Infinity));dp[0][0]=0;
  for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++){
    let sum=0,count=0;
    for(let k=0;k<n;k++){
      if(n===240){const g=k<66?0:k<132?66:k<173?132:173;
        if(g>=132?(!a[i-1][g]||!b[j-1][g]):(!a[i-1][g]&&!b[j-1][g]))continue;}
      const delta=a[i-1][k]-b[j-1][k];sum+=Math.min(delta*delta,4);count++;
    }
    dp[i][j]=(count?Math.sqrt(sum/count):Infinity)+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
  }
  return dp[a.length][b.length]/Math.max(a.length,b.length);
}
describe("exact repeated-observation DTW costs",()=>{
  it("matches the independent matrix bit for bit across repeats, masks, dimensions and bounds",()=>{
    let seed=12031;
    const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
    for(const width of [7,208,240])for(const length of [8,24,31])for(const every of [1,2,4,9]){
      const generate=(count:number)=>Array.from({length:count},()=>Array.from({length:width},(_,k)=>
        [0,66,132,173].includes(k)?Number(random()>.4):(random()-.5)*6));
      const a=generate(length),b=generate(24);
      for(let i=1;i<a.length;i++)if(i%every)a[i]=[...a[i-1]];
      const expected=oracle(a,b),query=compileDistanceSequence(a),template=compileDistanceSequence(b);
      expect(compiledSequenceDistance(query,template)).toBe(expected);
      for(const limit of [0,.06,.5,.56,expected,expected+1e-9]){
        const result=compiledSequenceDistance(query,template,limit);
        if(expected<=limit)expect(result).toBe(expected);
        else expect(result===Infinity||result===expected).toBe(true);
      }
    }
  });
  it("keeps saved rows independent and does not mutate them while caching",()=>{
    const rows=Array.from({length:24},()=>Array(240).fill(1));const before=structuredClone(rows);
    const compiled=compileDistanceSequence(rows);
    expect(compiledSequenceDistance(compiled,compiled,.56)).toBe(0);
    expect(rows).toEqual(before);expect(rows[0]).not.toBe(rows[1]);
  });
});
