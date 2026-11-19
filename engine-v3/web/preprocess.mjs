// Engine V3 browser preprocessing. Line-for-line mirror of
//   pipeline/extract.py (landmark slots), pipeline/build_cache.py:gather (point selection,
//   aspect correction, pose visibility rule) and train/v3model.py:prepare_clip (span trim,
//   uniform resampling, padding). Feature normalisation itself happens inside the ONNX graph.

export const N_POINTS = 86;
export const TMAX = 48;
export const PAD = 2;
export const FPS = 15;
export const LONG_SIDE = 480;
export const POSE = [0, 2, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
export const FACE = [0, 17, 1, 152, 10, 61, 291, 185, 409, 40, 270, 39, 269, 37, 267, 146, 375, 91, 321, 181, 405, 84, 314,
  33, 263, 133, 362, 70, 300, 105, 334];

/** Analysis canvas size: long side 480 px, even dimensions (extract.py:out_size). */
export function analysisSize(w, h) {
  const s = LONG_SIDE / Math.max(w, h);
  return [Math.round((w * s) / 2) * 2, Math.round((h * s) / 2) * 2];
}

/**
 * One frame of MediaPipe Tasks results -> Float32Array(86*3) with NaN for missing points.
 * hands: HandLandmarkerResult, pose: PoseLandmarkerResult, face: FaceLandmarkerResult.
 */
export function gatherFrame(hands, pose, face, width, height) {
  const out = new Float32Array(N_POINTS * 3).fill(NaN);
  const L = Math.max(width, height), ax = width / L, ay = height / L;
  const put = (i, p) => { out[i * 3] = p.x * ax; out[i * 3 + 1] = p.y * ay; out[i * 3 + 2] = p.z; };
  const best = [0, 0];
  (hands?.landmarks ?? []).forEach((lm, k) => {
    const cat = hands.handedness?.[k]?.[0] ?? hands.handednesses?.[k]?.[0];
    const slot = cat?.categoryName === "Left" ? 0 : 1;
    const score = cat?.score ?? 0;
    if (best[slot] >= score) return; // keep the best hand per slot (same rule as extract.py)
    best[slot] = score;
    for (let j = 0; j < 21; j++) put(slot * 21 + j, lm[j]);
  });
  const pl = pose?.landmarks?.[0];
  if (pl) POSE.forEach((p, j) => { if ((pl[p].visibility ?? 0) >= 0.5) put(42 + j, pl[p]); });
  const fl = face?.faceLandmarks?.[0];
  if (fl) FACE.forEach((p, j) => put(55 + j, fl[p]));
  return out;
}

const finite3 = (f, i) => Number.isFinite(f[i * 3]) && Number.isFinite(f[i * 3 + 1]) && Number.isFinite(f[i * 3 + 2]);
export const hasHand = f => { for (let i = 0; i < 42; i++) if (Number.isFinite(f[i * 3])) return true; return false; };

/** frames: Float32Array[] (each 86*3) -> {x, valid, fmask, span} or null when no hand was observed. */
export function prepareClip(frames, tmax = TMAX) {
  let first = -1, last = -1;
  frames.forEach((f, i) => { if (hasHand(f)) { if (first < 0) first = i; last = i; } });
  if (first < 0) return null;
  const a = Math.max(0, first - PAD), b = Math.min(frames.length - 1, last + PAD);
  let seg = frames.slice(a, b + 1);
  if (seg.length > tmax) {
    const n = seg.length;
    seg = Array.from({ length: tmax }, (_, k) => seg[Math.floor((k * (n - 1)) / Math.max(tmax - 1, 1) + 0.5)]);
  }
  const x = new Float32Array(tmax * N_POINTS * 3), valid = new Float32Array(tmax * N_POINTS), fmask = new Float32Array(tmax);
  seg.forEach((f, t) => {
    fmask[t] = 1;
    for (let i = 0; i < N_POINTS; i++) {
      if (!finite3(f, i)) continue;
      valid[t * N_POINTS + i] = 1;
      const o = (t * N_POINTS + i) * 3;
      x[o] = f[i * 3]; x[o + 1] = f[i * 3 + 1]; x[o + 2] = f[i * 3 + 2];
    }
  });
  return { x, valid, fmask, span: [a, b], frames: seg.length };
}

/**
 * Camera frames arrive at irregular times. Resample landmark frames onto the 15 Hz grid the
 * model was trained on: linear interpolation per point when both neighbours observed it,
 * otherwise the nearest observation within one source gap, else missing.
 * samples: [{t: ms, f: Float32Array}] sorted by t.
 */
export function resampleTo15Hz(samples, t0 = samples[0]?.t, t1 = samples.at(-1)?.t) {
  if (!samples.length) return [];
  const out = [], step = 1000 / FPS;
  let j = 0;
  for (let t = t0; t <= t1 + 1e-6; t += step) {
    while (j + 1 < samples.length && samples[j + 1].t <= t) j++;
    const A = samples[j], B = samples[Math.min(j + 1, samples.length - 1)];
    const f = new Float32Array(N_POINTS * 3).fill(NaN);
    const w = B.t > A.t ? Math.min(1, Math.max(0, (t - A.t) / (B.t - A.t))) : 0;
    for (let i = 0; i < N_POINTS; i++) {
      const ha = finite3(A.f, i), hb = finite3(B.f, i);
      for (let c = 0; c < 3; c++) {
        const k = i * 3 + c;
        if (ha && hb) f[k] = A.f[k] * (1 - w) + B.f[k] * w;
        else if (ha && w <= 0.5) f[k] = A.f[k];
        else if (hb && w > 0.5) f[k] = B.f[k];
      }
    }
    out.push(f);
  }
  return out;
}
