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
