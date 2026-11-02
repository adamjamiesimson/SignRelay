/**
 * Stage fingerprints for comparing two runs of the camera-to-text pipeline.
 *
 * Each boundary (capture schedule, landmark observations, model input,
 * model output, decoded text) gets a 64-bit identifier over its exact bytes
 * (Float32 for numeric data), so a reviewer can see the FIRST stage at which
 * two runs diverge: different schedules point at sampling/scheduling, equal
 * schedules with different observations point at tracking, equal features
 * with different logits point at inference, and so on.
 *
 * These are identifiers, not security hashes (two independent 32-bit FNV-1a
 * lanes). They are one-way, carry no landmark values, and are only meaningful
 * for equality between runs. Do not use them for integrity or authentication;
 * model and asset integrity remain SHA-256.
 */
import type { HandObservation } from "./vision-types";

const PRIME = 0x01000193;
/** Numeric identity, not bit identity: -0 equals 0 and every NaN is one NaN
 * (JSON, structured cloning and arithmetic may change either bit pattern). */
function canonical<T extends Float32Array | Float64Array>(array: T): T {
  let copy: T | null = null;
  for (let i = 0; i < array.length; i++) {
    const value = array[i];
    if (value === 0 && Object.is(value, -0)) (copy ??= array.slice() as T)[i] = 0;
    else if (value !== value) (copy ??= array.slice() as T)[i] = NaN;
  }
  return copy ?? array;
}
export class Fingerprint {
  private a = 0x811c9dc5;
  private b = 0x050c5d1f;
  bytes(view: Uint8Array) {
    let a = this.a, b = this.b;
    for (let i = 0; i < view.length; i++) {
      a = Math.imul(a ^ view[i], PRIME);
      b = Math.imul(b ^ view[i] ^ 0x5a, PRIME);
    }
    this.a = a; this.b = b;
    return this;
  }
  float32(values: ArrayLike<number>) {
    const array = canonical(values instanceof Float32Array ? values : Float32Array.from(values));
    return this.bytes(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
  }
  float64(values: ArrayLike<number>) {
    const array = canonical(values instanceof Float64Array ? values : Float64Array.from(values));
    return this.bytes(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
  }
  text(value: string) { return this.bytes(new TextEncoder().encode(value)); }
  digest() { return (this.a >>> 0).toString(16).padStart(8, "0") + (this.b >>> 0).toString(16).padStart(8, "0"); }
}

export const fingerprintFloat32 = (values: ArrayLike<number>) => new Fingerprint().float32(values).digest();
export const fingerprintText = (value: string) => new Fingerprint().text(value).digest();

/** Relative sample times, exact to Float64. Identical schedules mean the same
 * decoded frames were sampled at the same media times. */
export function fingerprintSchedule(times: readonly number[]) {
  const origin = times[0] ?? 0;
  return new Fingerprint().float64(times.map(time => time - origin)).digest();
}

/** Landmark observations in a fixed order: per sample, each hand's category
 * code and its 21 points as Float32. Missing hands are explicit. */
export function fingerprintObservations(samples: readonly { hands: readonly HandObservation[] }[]) {
  const print = new Fingerprint();
  const code = { Left: 1, Right: 2, Unknown: 3 } as const;
  for (const sample of samples) {
    print.float32([sample.hands.length]);
    for (const hand of sample.hands) {
      print.float32([code[hand.handedness] ?? 0, hand.landmarks.length]);
      print.float32(hand.landmarks.flatMap(point => [point.x, point.y, point.z]));
    }
  }
  return print.digest();
}

export type StageFingerprints = {
  schedule?: string; observations?: string; features?: string; logits?: string; output?: string;
};
export const STAGE_ORDER: readonly (keyof StageFingerprints)[] = ["schedule", "observations", "features", "logits", "output"];

/** The first stage at which two runs differ, or null when every stage both
 * runs recorded is identical. A stage missing from either run is skipped. */
export function firstDivergentStage(a: StageFingerprints, b: StageFingerprints) {
  for (const stage of STAGE_ORDER) {
    if (a[stage] === undefined || b[stage] === undefined) continue;
    if (a[stage] !== b[stage]) return stage;
  }
  return null;
}
