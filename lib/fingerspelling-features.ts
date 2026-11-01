/** Independently defined training/browser contract, dominant-hand-wrist-palm-width-v2.
 * MediaPipe Tasks 0.10.35 gesture task 97952348…, image-normalized 21 points.
 * No rotation normalization, no frame labels, no gesture-to-letter mapping.
 */
export const HAND_FEATURE_COUNT = 66;
export function normalizeFingerspellingHand(raw: Float32Array, frames: number,
  side: "Left" | "Right", imageAspect: number) {
  if (!Number.isInteger(frames) || frames < 1 || frames > 320 || raw.length !== frames*63
    || !Number.isFinite(imageAspect) || imageAspect <= 0 || !["Left","Right"].includes(side)) {
    throw new Error("Invalid fingerspelling landmark contract");
  }
  const out = new Float32Array(frames*HAND_FEATURE_COUNT);
  let originX = 0, originY = 0, foundOrigin = false;
  const sign = side === "Left" ? -1 : 1;
  const clip = (x:number) => Math.min(8,Math.max(-8,x));
  for (let t=0;t<frames;t++) {
    const at=t*63, dest=t*HAND_FEATURE_COUNT;
    let valid=true;
    for(let j=0;j<63;j++) if(!Number.isFinite(raw[at+j])) {valid=false;break;}
    if(!valid) continue;
    const wx=raw[at], wy=raw[at+1], wz=raw[at+2];
    if(!foundOrigin) {originX=wx;originY=wy;foundOrigin=true;}
    // y is height-normalized; x/z are width-scaled. Convert before palm scale.
    const mx=raw[at+27]-wx, my=(raw[at+28]-wy)/imageAspect;
    const palm=Math.max(1e-4,Math.hypot(mx,my));
    for(let point=0;point<21;point++) {
      out[dest+point*3]=clip(sign*(raw[at+point*3]-wx)/palm);
      out[dest+point*3+1]=clip((raw[at+point*3+1]-wy)/imageAspect/palm);
      out[dest+point*3+2]=clip((raw[at+point*3+2]-wz)/palm);
    }
    out[dest+63]=clip(sign*(wx-originX)*4);
    out[dest+64]=clip((wy-originY)/imageAspect*4);
    out[dest+65]=1;
  }
  return out;
}

/** v3: image-width units, 3D MCP median scale, trajectory and observed-time motion.
 * Palm orientation is retained. Missing observations and their velocities are zero.
 */
export const MOTION_FEATURE_COUNT = 132;
export function normalizeFingerspellingMotion(raw:Float32Array,times:Float64Array,frames:number,side:"Left"|"Right",aspect:number){
 if(!Number.isInteger(frames)||frames<1||frames>320||raw.length!==frames*63||times.length!==frames
  ||!times.every(Number.isFinite)||!Number.isFinite(aspect)||aspect<=0||!["Left","Right"].includes(side))throw new Error("Invalid motion landmark contract");
 const f=Math.fround,clip=(x:number)=>Math.min(8,Math.max(-8,x)),out=new Float32Array(frames*132);
 const valid=new Uint8Array(frames),scales:number[]=[];
 const sign=side==="Left"?-1:1;let first=-1;
 const relative=new Float32Array(frames*63);
 for(let t=0;t<frames;t++){
  if(t&&times[t]<times[t-1])throw new Error("Non-monotonic motion timestamps");
  const at=t*63;
  if(!raw.subarray(at,at+63).every(Number.isFinite))continue;
  valid[t]=1;if(first<0)first=t;
  for(let p=0;p<21;p++){
   relative[at+p*3]=f(raw[at+p*3]-raw[at]);
   relative[at+p*3+1]=f(f(raw[at+p*3+1]-raw[at+1])/aspect);
   relative[at+p*3+2]=f(raw[at+p*3+2]-raw[at+2]);
  }
  const lengths=[5,9,13,17].map(p=>{
   const x=relative[at+p*3],y=relative[at+p*3+1],z=relative[at+p*3+2];
   return f(Math.sqrt(f(f(f(x*x)+f(y*y))+f(z*z))));
  }).sort((a,b)=>a-b);
  scales.push(Math.max(1e-4,f((lengths[1]+lengths[2])/2)));
 }
 if(first<0)return out;
 const sorted=[...scales].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);
 const median=Math.max(1e-4,sorted.length%2?sorted[middle]:f((sorted[middle-1]+sorted[middle])/2));
 let si=0;
 for(let t=0;t<frames;t++){
  if(!valid[t])continue;
  const at=t*63,dest=t*132,palm=scales[si++];
  for(let p=0;p<21;p++){
   out[dest+p*3]=clip(sign*f(relative[at+p*3]/palm));
   out[dest+p*3+1]=clip(f(relative[at+p*3+1]/palm));
   out[dest+p*3+2]=clip(f(relative[at+p*3+2]/palm));
  }
  out[dest+63]=clip(sign*f(f(raw[at]-raw[first*63])/median));
  out[dest+64]=clip(f(f(f(raw[at+1]-raw[first*63+1])/aspect)/median));
  out[dest+130]=1;
 }
 for(let t=1;t<frames;t++){
  if(!valid[t])continue;
  const dest=t*132,prior=(t-1)*132,dt=times[t]-times[t-1];
  if(valid[t-1]&&dt>1e-6){
   const factor=f((1/15)/dt);
   for(let j=0;j<63;j++)out[dest+65+j]=clip(f(f(out[dest+j]-out[prior+j])*factor));
   for(let j=0;j<2;j++)out[dest+128+j]=clip(f(f(out[dest+63+j]-out[prior+63+j])*factor));
  }
  out[dest+131]=Math.min(3,Math.max(0,dt*15));
 }
 return out;
}
