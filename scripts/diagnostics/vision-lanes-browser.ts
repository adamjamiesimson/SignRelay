import { drawLandmarkOverlay } from "../../lib/landmark-overlay";
import { recognizeAslStarter } from "../../lib/asl-starter-recognition";
import type { VisionFrame } from "../../lib/vision-types";

type Source = { ms: number; png: string };
type Reply = { type: string; frame: VisionFrame; computeMs?: number; handsMs?: number; timings?: { hands: number; auxiliary: number }; delegate?: string; message?: string };
type Mark = { index: number; draw: number; present: number | null; hands: number; age: number | null; frame: VisionFrame };
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const AUX_MAX_AGE = 200;

class Lane {
  private worker: Worker;
  constructor(url: string) { this.worker = new Worker(url); }
  run(message: object, transfer: Transferable[], end: string, onHands?: (reply: Reply) => void): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const fail = (reason: string) => { clearTimeout(timer); reject(new Error(reason)); };
      const timer = setTimeout(() => fail(`Worker timed out waiting for ${end}`), 45000);
      this.worker.onerror = event => fail(event.message);
      this.worker.onmessage = ({ data }: MessageEvent<Reply>) => {
        if (data.type === "error") fail(data.message ?? "Worker failed");
        else if (data.type === "hands") onHands?.(data);
        else if (data.type === end) { clearTimeout(timer); resolve(data); }
      };
      try { this.worker.postMessage(message, transfer); }
      catch (error) { clearTimeout(timer); reject(error); }
    });
  }
  close() { this.worker.terminate(); }
}

function stats(samples: number[]) {
  const s = samples.slice().sort((a, b) => a - b);
  const q = (p: number) => s.length ? s[Math.ceil(s.length * p) - 1] : null;
  return { n: s.length, p50: q(.5), p95: q(.95), p99: s.length >= 100 ? q(.99) : null, max: s.at(-1) ?? null };
}

async function replay(source: Source[], mode: "combined" | "split" | "reference", annotatedStart: number, annotatedEnd: number, fastIndices: number[] = []) {
  const inputs: ImageBitmap[] = [];
  const hands = new Lane(mode === "split" ? "/split.worker.js" : "/combined.worker.js");
  const aux = mode === "split" ? new Lane("/split.worker.js") : null;
  try {
    for (const frame of source) {
      const response = await fetch(frame.png);
      if (!response.ok) throw new Error("Frame download failed");
      inputs.push(await createImageBitmap(await response.blob()));
    }
    const canvas = document.createElement("canvas");
    canvas.width = inputs[0].width; canvas.height = inputs[0].height;
    const context = canvas.getContext("2d")!;
    document.body.replaceChildren(canvas);
    const init = performance.now();
    await Promise.all([hands.run({ type: "init", accelerated: false, lane: "hands" }, [], "ready"),
      aux?.run({ type: "init", lane: "auxiliary" }, [], "ready")]);
    const startup = performance.now() - init;
    const marks: Mark[] = [], frames: VisionFrame[] = [], gaps: number[] = [], completion: number[] = [];
    const auxHistory: VisionFrame[] = [];
    let lastAux = -Infinity, handTask: Promise<void> | null = null, auxTask: Promise<void> | null = null;
    let latest: number | null = null, failures: unknown, tail: string | null = null, priorLabel: string | null = null;
    let firstCandidate: number | null = null, previousDraw: number | null = null, auxCompleted = 0;
    let handPosts = 0, auxPosts = 0, missedPaint = 0;
    const beginning = performance.now(), at = (i: number) => beginning + source[i].ms - source[0].ms;
    const stamp = (i: number) => source[i].ms - source[0].ms + 1000;
    const draw = (i: number, frame: VisionFrame, handsMs: number, age: number | null) => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      drawLandmarkOverlay(context, canvas.width, canvas.height, frame);
      const now = performance.now();
      if (previousDraw !== null) gaps.push(now - previousDraw);
      previousDraw = now;
      const mark: Mark = { index: i, draw: now - at(i), present: null, hands: handsMs, age, frame };
      marks.push(mark);
      requestAnimationFrame(t => {
        if (marks.at(-1) !== mark) { missedPaint++; return; }
        mark.present = Math.max(performance.now(), t) - at(i);
      });
    };
    const process = async (lane: Lane, i: number, onHands?: (reply: Reply) => void) => {
      const bitmap = await createImageBitmap(inputs[i]);
      try { return await lane.run({ type: "frame", bitmap, timestamp: stamp(i) }, [bitmap], "result", onHands); }
      finally { bitmap.close(); }
    };
    if (mode === "reference") {
      // Dense reference labels the shared fast-motion slots independently
      // of which frames either live-rate lane manages to deliver.
      const fast: number[] = [];
      let prior: VisionFrame | undefined;
      for (let i = 0; i < source.length; i++) {
        const { frame } = await process(hands, i);
        const delta = prior ? (frame.timestamp - prior.timestamp) / 1000 : Infinity;
        const rapid = delta > 0 && delta <= .1 && frame.hands.some(hand => {
          if (hand.handedness === "Unknown") return false;
          const previous = prior!.hands.filter(h => h.handedness === hand.handedness);
          const same = frame.hands.filter(h => h.handedness === hand.handedness);
          if (previous.length !== 1 || same.length !== 1) return false;
          const a = previous[0].landmarks[0], b = hand.landmarks[0];
          return a && b && Math.hypot(a.x - b.x, a.y - b.y) / delta >= .7;
        });
        if (rapid && source[i].ms >= annotatedStart && source[i].ms <= annotatedEnd) fast.push(i);
        prior = frame;
      }
      return fast;
    }
    const pump = () => {
      if (latest === null || failures) return;
      const i = latest;
      if (aux && !auxTask && stamp(i) - lastAux >= 150) {
        lastAux = stamp(i); auxPosts++;
        auxTask = process(aux, i).then(reply => {
          auxCompleted++;
          auxHistory.push(reply.frame);
          if (auxHistory.length > 2) auxHistory.shift();
        }).catch(error => { failures = error; }).finally(() => { auxTask = null; });
      }
      if (handTask) return;
      latest = null; handPosts++;
      handTask = process(hands, i, reply => draw(i, reply.frame, reply.handsMs ?? 0, null)).then(reply => {
        let frame = reply.frame;
        if (mode === "split") {
          const cached = auxHistory.findLast(f => f.timestamp <= frame.timestamp && frame.timestamp - f.timestamp <= AUX_MAX_AGE);
          if (cached) frame = { ...frame, face: cached.face, pose: cached.pose };
          draw(i, frame, reply.computeMs ?? 0, cached ? frame.timestamp - cached.timestamp : null);
        }
        completion.push(performance.now() - at(i));
        frames.push(frame);
        if (frames.length > 120) frames.shift();
        const label = recognizeAslStarter(frames)?.label ?? null;
        if (label && label === priorLabel && !tail) {
          tail = label;
          firstCandidate = performance.now() - (beginning + annotatedEnd - source[0].ms);
        }
        priorLabel = label;
      }).catch(error => { failures = error; }).finally(() => { handTask = null; pump(); });
    };
    const n = source.length;
    for (let i = 0; i < n; i++) {
      const wait = at(i) - performance.now();
      if (wait > 0) await delay(wait);
      while (i + 1 < n && at(i + 1) <= performance.now()) i++;
      if (failures) throw failures;
      latest = i; pump();
    }
    while (handTask) await handTask;
    if (auxTask) await auxTask;
    if (failures) throw failures;
    await delay(50);
    const active = marks.filter(m => source[m.index].ms >= annotatedStart && source[m.index].ms <= annotatedEnd);
    const fastSet = new Set(fastIndices), fast = active.filter(mark => fastSet.has(mark.index));
    let losses = 0, recoveries = 0;
    for (let i = 1; i < active.length; i++) {
      if (active[i - 1].frame.hands.length && !active[i].frame.hands.length) losses++;
      if (!active[i - 1].frame.hands.length && active[i].frame.hands.length) recoveries++;
    }
    return { mode, startup, sourceFrames: n, delivered: marks.length, dropped: n - handPosts, auxPosts, auxCompleted,
      handCompute: stats(marks.map(m => m.hands)), draw: stats(marks.map(m => m.draw)),
      nextRaf: stats(marks.flatMap(m => m.present === null ? [] : [m.present])), missedPaint,
      result: stats(completion), gaps: stats(gaps), freezesOver200Ms: gaps.filter(g => g > 200).length,
      auxAge: stats(marks.flatMap(m => m.age === null ? [] : [m.age])), noFreshAux: mode === "split" ? marks.filter(m => m.age === null).length : null,
      activeDelivered: active.length, activeNoHands: active.filter(m => !m.frame.hands.length).length,
      activeTwoHands: active.filter(m => m.frame.hands.length === 2).length, losses, recoveries,
      fastSlots: fastSet.size, fastDelivered: fast.length, fastNoHands: fast.filter(m => !m.frame.hands.length).length,
      fastDraw: stats(fast.map(m => m.draw)),
      candidate: tail, candidateRelativeToEndMs: firstCandidate,
      activeHandCounts: active.map(m => [m.index, m.frame.hands.length]) };
  } finally {
    hands.close(); aux?.close();
    for (const input of inputs) input.close();
  }
}

Object.assign(window, { replayVisionLanes: replay });
