/// <reference lib="webworker" />

import type { CalibrationTemplate, VisionFrame, WorkerInput, WorkerMessage } from "@/lib/vision-types";
import { shouldConfirm } from "@/lib/decoder";
import { templatesForLanguage } from "@/lib/personalized-recognition";
import { analyzeAslStarter } from "@/lib/asl-starter-recognition";
import { analyzeSignMotion } from "@/lib/sign-motion";
import { analyzeGenericSignMotion } from "@/lib/asl100-runtime";
import { recognizeAsl1000 } from "@/lib/asl1000-runtime";
import { recognizeIsl263 } from "@/lib/isl263-runtime";
import { recognizeBsl1064 } from "@/lib/bsl1064-runtime";
import { recognizeLse300 } from "@/lib/lse300-runtime";
import { TemplateMatchingClient, type TemplatePrediction } from "@/lib/template-matching-client";
import { validHand } from "@/lib/asl-starter-recognition";
import { MODEL_ADAPTERS, type LanguageId } from "@/lib/model-adapters";
import { trackingGapLimit } from "@/lib/frame-timing";
import { AslV31Segmenter } from "@/lib/asl-v31-segmenter";
import { embedAslV31, recognizeAslV31, warmAslV31Model } from "@/lib/asl-v31-runtime";
import { matchPersonalEmbedding } from "@/lib/asl-v31-personal";
import { emptyAslV31Diagnostics, type AslV31Decision, type AslV31Diagnostics } from "@/lib/asl-v31-diagnostics";
import { ASL_V31_ASSET_PINS, ASL_V31_POLICY } from "@/lib/asl-v31-assets.mjs";
import { FPS, N_POINTS } from "../engine-v3/web/preprocess.mjs";

const CONFIDENCE_THRESHOLD = 0.62;
const COOLDOWN_MS = 2600;
const frames: VisionFrame[] = [];
let candidateLabel: string | null = null;
let candidateStreak = 0;
let candidateIsModel = false;
let candidateSource: "personal" | "starter" | "model" | undefined;
let lastConfirmation = { label: "", time: 0 };
let personalTemplates: CalibrationTemplate[] = [];
let activeLanguage: LanguageId = "asl";
let useAslV31 = false;
const v3Segmenter = new AslV31Segmenter();
let v3ModelReady = false;
let queuedV3: { clip: Float32Array[]; closedAt: number; receivedAt: number; session?: number } | undefined;
// Developer diagnostics (?perf only): stage counters for the V3.1 path, kept in memory.
let diagnosticsEnabled = false;
let diagnostics: AslV31Diagnostics = emptyAslV31Diagnostics();
let lastDecisionAt = 0;
const classifiers = { asl: recognizeAsl1000, bsl: recognizeBsl1064, isl: recognizeIsl263, lse: recognizeLse300 };
const pending = new Map<LanguageId, { started: number; phase: "loading" | "inference"; controller: AbortController }>();
const MODEL_LOAD_TIMEOUT_MS = 400000;
const NORMAL_INFERENCE_TIMEOUT_MS = 20000;
const MAX_PREDICTION_AGE_MS = 2500;
let latestPrediction: Awaited<ReturnType<typeof recognizeAsl1000>> = null;
let predictionTimestamp = 0;
let predictionReceivedAt = 0;
let predictionVersion = 0;
let consumedPredictionVersion = 0;
let receivedFrames = 0;
let lastInferenceAt = -Infinity;
let modelGeneration = 0;
let modelProblem = false;
let retryAfter = 0;
let blockedStarter: string | null = null;
let starterSeenAt = 0;
const NEW_MOVEMENT_AFTER_WORD_MS = 600;
let evaluatedDeparture: number | undefined;
let handReturnedAfterConfirmation = true;
let handWasAbsent = false;

let latestPersonal: TemplatePrediction | null = null;
let personalTimestamp = 0;
let personalReceivedAt = 0;
let personalVersion = 0;
let consumedPersonalVersion = 0;
let hadPersonalTracking = false;
let personalProblem = false;
const personalMatcher = new TemplateMatchingClient("personal", (prediction, timestamp) => {
  latestPersonal = prediction;
  personalTimestamp = timestamp;
  personalReceivedAt = performance.now();
  personalVersion++;
  personalProblem = false;
}, () => { personalProblem = true; });
const pslMatcher = new TemplateMatchingClient("psl", (prediction, timestamp) => {
  if (activeLanguage !== "psl") return;
  latestPrediction = prediction as typeof latestPrediction;
  predictionTimestamp = timestamp;
  predictionReceivedAt = performance.now();
  predictionVersion++;
  modelProblem = false;
}, () => { modelProblem = true; });

function invalidatePersonal() {
  latestPersonal = null;
  personalMatcher.reset();
}

function invalidatePrediction() {
  latestPrediction = null;
  pslMatcher.reset();
  if (candidateIsModel) {
    candidateLabel = null;
    candidateStreak = 0;
  }
  modelGeneration += 1;
}

function resetEvidence() {
  v3Segmenter.reset();
  queuedV3 = undefined;
  invalidatePersonal();
  frames.length = 0;
  receivedFrames = 0;
  lastInferenceAt = -Infinity;
  invalidatePrediction();
  candidateLabel = null;
  candidateStreak = 0;
  candidateIsModel = false;
  blockedStarter = null;
  starterSeenAt = 0;
  evaluatedDeparture = undefined;
  handReturnedAfterConfirmation = true;
  handWasAbsent = false;
  hadPersonalTracking = false;
  candidateSource = undefined;
}

function resetSession() {
  lastCapture = undefined;
  diagnostics = { ...emptyAslV31Diagnostics(), model: v3ModelReady ? "ready" : "not-started" };
  v3Segmenter.resetStats();
  for (const request of pending.values()) request.controller.abort();
  pending.clear();
  resetEvidence();
  lastConfirmation = { label: "", time: 0 };
  modelProblem = false;
  retryAfter = 0;
  personalProblem = false;
}

/** `?perf` only: the last classified window, kept so a live misrecognition can be saved
 * and replayed offline. Landmarks only; no camera image is ever retained. */
type LastCapture = { clip: Float32Array[]; decision: AslV31Decision | null; at: number };
let lastCapture: LastCapture | undefined;

function captureSign() {
  if (!lastCapture) return null;
  const frames = lastCapture.clip.map(frame => Array.from(frame, value =>
    Number.isFinite(value) ? Math.round(value * 1e5) / 1e5 : null));
  return {
    tool: "signrelay-live-clip-v1",
    capturedAt: new Date(lastCapture.at).toISOString(),
    model: { version: "v3.1", sha256: ASL_V31_ASSET_PINS["model.onnx"].sha256, policy: ASL_V31_POLICY },
    contract: { points: N_POINTS, fps: FPS, order: "hand slots 0-41 (left, right), pose slots 42-54, face slots 55-85; NaN = missing" },
    frames: frames.length,
    decision: lastCapture.decision,
    diagnostics: diagnosticsSnapshot(),
    clip: frames,
  };
}

function submitV3(now: number) {
  if (pending.has("asl") || now < retryAfter) return;
  if (queuedV3 && (now - queuedV3.closedAt > MAX_PREDICTION_AGE_MS
    || performance.now() - queuedV3.receivedAt > MAX_PREDICTION_AGE_MS)) {
    queuedV3 = undefined;
    diagnostics.segmentsSkipped++;
  }
  const segment = v3ModelReady ? queuedV3 : undefined;
  if (v3ModelReady && !segment) return;
  if (segment) queuedV3 = undefined;

  const request = { started: now, phase: (segment ? "inference" : "loading") as "inference" | "loading", controller: new AbortController() };
  pending.set("asl", request);
  const generation = modelGeneration;
  const startedAt = performance.now();
  if (!segment) diagnostics.model = "loading";
  // `?perf` only: keep the exact window and decision so a live misrecognition can be
  // replayed offline. Landmarks are overwritten by the next sign and never leave the device.
  const capture: LastCapture | undefined = segment ? { clip: segment.clip, decision: null, at: Date.now() } : undefined;
  // Held per request so a taught sign is matched against its own window's embedding, even when the
  // model's gate declines it.
  const observed: { embedding?: number[] } = {};
  if (capture) lastCapture = capture;
  const task = segment
    ? recognizeAslV31(segment.clip, { signal: request.controller.signal, onDecision: decision => {
      diagnostics.inferences++;
      diagnostics.lastInferenceMs = performance.now() - startedAt;
      diagnostics.decisions[decision.status]++;
      diagnostics.lastDecision = { ...decision, ageMs: 0 };
      lastDecisionAt = performance.now();
      if (capture) capture.decision = decision;
    }, onEmbedding: embedding => { observed.embedding = embedding; } })
    : warmAslV31Model().then(() => { v3ModelReady = true; diagnostics.model = "ready"; });

  task.then(prediction => {
    if (generation !== modelGeneration || request.controller.signal.aborted) return;
    modelProblem = false;
    if (!segment) return;
    // A sign this signer taught the app beats the 523-class head: measured on their own camera,
    // repeats of the same sign sat at 0.93 cosine while different signs stayed under 0.27.
    const personal = matchPersonalEmbedding(observed.embedding, personalTemplates);
    if (personal) {
      self.postMessage({ type: "confirmed", session: segment.session, gloss: personal.template.gloss,
        text: personal.template.text, confidence: personal.similarity, timestamp: Date.now(), source: "personal",
      } satisfies WorkerMessage);
      return;
    }
    if (!prediction) return;
    if ((frames.at(-1)?.timestamp ?? now) - segment.closedAt > MAX_PREDICTION_AGE_MS
      || performance.now() - segment.receivedAt > MAX_PREDICTION_AGE_MS) {
      diagnostics.suggestionsStale++;
      return;
    }
    diagnostics.suggestionsPosted++;
    self.postMessage({ type: "suggestion", session: segment.session, gloss: prediction.label, text: prediction.text,
      confidence: prediction.confidence, timestamp: Date.now(), source: "model",
    } satisfies WorkerMessage);
  }).catch(error => {
    if (generation !== modelGeneration || request.controller.signal.aborted) return;
    if (segment) diagnostics.inferenceFailures++;
    else {
      diagnostics.model = "failed";
      diagnostics.modelError = error instanceof Error ? error.message : String(error);
    }
    modelProblem = true;
    retryAfter = (frames.at(-1)?.timestamp ?? now) + 5000;
  }).finally(() => { if (pending.get("asl") === request) pending.delete("asl"); });
}

function diagnosticsSnapshot(): AslV31Diagnostics {
  const { opened, completed, capped, tooFewHands } = v3Segmenter.stats;
  return { ...diagnostics, segmentsOpened: opened, segmentsCompleted: completed, segmentsCapped: capped, segmentsTooFewHands: tooFewHands,
    decisions: { ...diagnostics.decisions },
    lastDecision: diagnostics.lastDecision && { ...diagnostics.lastDecision, ageMs: performance.now() - lastDecisionAt } };
}

self.onmessage = async (event: MessageEvent<WorkerInput>) => {
  if (event.data.type === "templates") {
    activeLanguage = event.data.language;
    useAslV31 = activeLanguage === "asl" && event.data.aslEngine === "v3.1";
    diagnosticsEnabled = event.data.diagnostics === true;
    personalTemplates = templatesForLanguage(event.data.templates, activeLanguage);
    resetSession();
    personalMatcher.configure(personalTemplates);
    return;
  }
  if (event.data.type === "capture") {
    self.postMessage({ type: "clip", session: event.data.session, at: Date.now(), sign: captureSign() } satisfies WorkerMessage);
    return;
  }
  if (event.data.type === "embed") {
    // Teaching a sign: the page sends the recorded V3.1 frames and stores the embedding it gets back.
    const { requestId, frames: recorded, session } = event.data;
    const reply = (embedding: number[] | null) =>
      self.postMessage({ type: "embedding", session, requestId, embedding } satisfies WorkerMessage);
    embedAslV31(recorded, {})
      .then(embedding => reply(embedding ? Array.from(embedding) : null))
      .catch(() => reply(null));
    return;
  }
  if (event.data.type === "reset") { resetSession(); return; }

  const now = event.data.frame.timestamp;
  const previousFrame = frames.at(-1);
  if (previousFrame) {
    const gap = now - previousFrame.timestamp;
    // Preserve the cooldown across a forward pause, but never combine motion
    // or prediction evidence from before that pause with fresh observations.
    if (gap < 0) resetSession();
    else if (gap === 0 || gap > trackingGapLimit([...frames.slice(-12), event.data.frame])) resetEvidence();
  }
  for (const [language, request] of pending) {
    const deadline = request.phase === "loading" ? MODEL_LOAD_TIMEOUT_MS : NORMAL_INFERENCE_TIMEOUT_MS;
    if (now - request.started < deadline) continue;
    if (request.phase === "loading") {
      request.controller.abort(); pending.delete(language);
      modelProblem = true; retryAfter = now + 30000;
      if (language === "asl" && useAslV31) {
        diagnostics.model = "failed";
        diagnostics.modelError = "model did not finish loading";
      }
    } else {
      request.controller.abort(); invalidatePrediction(); pending.clear();
      self.postMessage({ type: "fault", session: event.data.session,
        message: "The research model stopped responding. Restarting recognition…",
      } satisfies WorkerMessage);
      return;
    }
  }
  receivedFrames += 1;
  frames.push(event.data.frame);
  while (frames.length > (activeLanguage === "asl" ? 120 : 80)) frames.shift();
  const hasHand = event.data.frame.hands.some(validHand);
  if (hasHand && handWasAbsent) handReturnedAfterConfirmation = true;
  handWasAbsent = !hasHand;
  if (!hasHand && hadPersonalTracking) invalidatePersonal();
  hadPersonalTracking = hasHand;
  if (latestPersonal && (now - personalTimestamp > MAX_PREDICTION_AGE_MS
    || performance.now() - personalReceivedAt > MAX_PREDICTION_AGE_MS)) latestPersonal = null;
  if (hasHand) personalMatcher.submit(frames);
  const personal = latestPersonal;
  const starterAnalysis = activeLanguage === "asl" && !useAslV31 ? analyzeAslStarter(frames) : null;
  const starter = starterAnalysis?.prediction ?? null;
  // The closed-set model can also label fist preparation YES. Require the
  // same completed wrist nod for automatic YES, while preserving personal
  // templates. Discard a rejected result so it cannot stall fresh inference.
  if (activeLanguage === "asl" && latestPrediction?.label.trim().toUpperCase() === "YES"
    && starter?.label !== "YES") invalidatePrediction();
  const v3Features = event.data.frame.aslV3Features;
  if (useAslV31 && v3Features) {
    diagnostics.observations++;
    if (hasHand) diagnostics.handFrames++;
    // V3.1 pose slots 7 and 8 hold the shoulders (pose landmarks 11 and 12).
    if (Number.isFinite(v3Features[(42 + 7) * 3]) && Number.isFinite(v3Features[(42 + 8) * 3])) diagnostics.shoulderFrames++;
  }
  const v3Motion = useAslV31 ? v3Segmenter.observe(now, v3Features) : null;
  const observed = activeLanguage === "asl" && !useAslV31 ? analyzeSignMotion(frames) : null;
  const startsInConfirmedTail = observed?.completion === "departure" && !handReturnedAfterConfirmation
    && observed.sequence[0].timestamp - lastConfirmation.time < NEW_MOVEMENT_AFTER_WORD_MS;
  const motion = startsInConfirmedTail ? { ready: false, sequence: [], reason: "hands" as const }
    : v3Motion ? { ready: Boolean(v3Motion.clip), sequence: [], reason: v3Motion.reason }
      : observed ?? { ...analyzeGenericSignMotion(frames), sequence: frames };
  const departureEnd = observed?.completion === "departure" && !startsInConfirmedTail
    ? observed.sequence.at(-1)?.timestamp : undefined;

  if (v3Motion) {
    // Limit the pipeline to one inference and one queued completed segment.
    // Camera analyses still receive their acknowledgement during model loading.
    if (v3Motion.clip) {
      if (queuedV3) diagnostics.segmentsSkipped++;
      queuedV3 = { clip: v3Motion.clip, closedAt: now, receivedAt: performance.now(), session: event.data.session };
    }
    submitV3(now);
  } else if (!motion.ready || starterAnalysis?.ambiguousOpenPalm) invalidatePrediction();
  else {
    if (latestPrediction && (now - predictionTimestamp > MAX_PREDICTION_AGE_MS
      || performance.now() - predictionReceivedAt > MAX_PREDICTION_AGE_MS)) invalidatePrediction();
    const language = activeLanguage;
    const classifier = language in classifiers ? classifiers[language as keyof typeof classifiers] : null;
    if (language === "psl" && frames.length >= 24 && receivedFrames % 6 === 0) pslMatcher.submit([...motion.sequence]);
    const cadence = language === "isl" ? 8 : 6;
    // Frame-count scheduling can skip the entire completion window on a slow
    // device. ASL needs fresh results while that movement is still available.
    const inferenceDue = language === "asl" ? now - lastInferenceAt >= 250 : receivedFrames % cadence === 0;
    const freshResult = latestPrediction && Number.isFinite(latestPrediction.confidence)
      && latestPrediction.confidence >= CONFIDENCE_THRESHOLD && consumedPredictionVersion !== predictionVersion;
    if (classifier && MODEL_ADAPTERS[language].status === "experimental"
      && frames.length >= (language === "asl" ? 6 : 24) && inferenceDue
      && (departureEnd === undefined || departureEnd !== evaluatedDeparture)
      && !freshResult && !pending.has(language) && now >= retryAfter) {
      const request = { started: now, phase: (language === "asl" ? "inference" : "loading") as "loading" | "inference", controller: new AbortController() };
      pending.set(language, request);
      lastInferenceAt = now;
      const generation = modelGeneration;
      const submittedAt = performance.now();
      classifier([...motion.sequence], { signal: request.controller.signal, onPhase: phase => {
        if (pending.get(language) !== request) return;
        request.phase = phase;
        request.started = frames.at(-1)?.timestamp ?? now;
      } }).then((prediction) => {
        if (generation !== modelGeneration || request.controller.signal.aborted) return;
        if ((frames.at(-1)?.timestamp ?? now) - now > MAX_PREDICTION_AGE_MS
          || performance.now() - submittedAt > MAX_PREDICTION_AGE_MS) return;
        // A departed movement contains a fixed sequence. Re-running it would
        // produce the same result, including when the model abstains.
        if (departureEnd !== undefined) evaluatedDeparture = departureEnd;
        latestPrediction = prediction;
        predictionTimestamp = now;
        predictionReceivedAt = performance.now();
        predictionVersion += 1;
        modelProblem = false;
      }).catch(() => {
        if (generation !== modelGeneration || request.controller.signal.aborted) return;
        invalidatePrediction();
        modelProblem = true;
        retryAfter = (frames.at(-1)?.timestamp ?? now) + 5000;
      }).finally(() => { if (pending.get(language) === request) pending.delete(language); });
    }
  }

  const direct = personal ?? starter;
  if (direct?.label === blockedStarter) starterSeenAt = now;
  else if (now - starterSeenAt > 500) blockedStarter = null;
  const rawResult = direct?.label === blockedStarter ? null : direct ?? latestPrediction;
  const result = rawResult && Number.isFinite(rawResult.confidence) ? rawResult : null;
  const source = result ? result === personal ? "personal" : result === starter ? "starter" : "model" : undefined;
  const feedback = starterAnalysis?.ambiguousOpenPalm && !personal ? "This movement resembles more than one sign. Pause and try again."
    : personalProblem ? "Saved signs could not be checked. Retrying shortly…" : modelProblem
    ? activeLanguage === "asl" && !useAslV31
      ? "The research model could not run. Common ASL signs and saved personal signs are still available. Retrying shortly…"
      : "The research model could not run. Saved personal signs are still available. Retrying shortly…"
    : motion.reason === "hands" ? "Keep your signing hand in view. Tracking will resume automatically."
      : motion.reason === "moving" ? "Following your movement…"
        : result ? "Checking your sign…" : "Ready. Sign naturally, then pause briefly between words.";
  self.postMessage({ type: "analysis", session: event.data.session, frameId: event.data.frameId,
    state: frames.length < 6 ? "listening" : result ? "processing" : "uncertain",
    candidate: result?.label ?? null, confidence: result?.confidence ?? 0,
    bufferSize: frames.length, feedback,
    source, motionReason: motion.reason,
    ...(diagnosticsEnabled && useAslV31 ? { diagnostics: diagnosticsSnapshot() } : {}),
  } satisfies WorkerMessage);

  if (!result || result.confidence < CONFIDENCE_THRESHOLD) {
    candidateLabel = null;
    candidateStreak = 0;
    return;
  }
  if (result === latestPrediction) {
    // The WLASL model's measured precision on camera landmarks is too low
    // to write into the transcript. Its output stays in the candidate bar.
    if (activeLanguage === "asl") {
      consumedPredictionVersion = predictionVersion;
      candidateLabel = null;
      candidateStreak = 0;
      return;
    }
    if (consumedPredictionVersion === predictionVersion) return;
    consumedPredictionVersion = predictionVersion;
  }
  if (result === latestPersonal) {
    if (consumedPersonalVersion === personalVersion) return;
    consumedPersonalVersion = personalVersion;
  }
  candidateIsModel = result === latestPrediction;
  // Independent recognizers cannot lend each other confirmation evidence.
  if (candidateLabel === result.label && candidateSource === source) candidateStreak += 1;
  else { candidateLabel = result.label; candidateSource = source; candidateStreak = 1; }

  if (shouldConfirm({ confidence: result.confidence, threshold: CONFIDENCE_THRESHOLD,
    streak: candidateStreak, sameLabel: lastConfirmation.label === result.label,
    elapsedSinceLast: now - lastConfirmation.time, cooldown: COOLDOWN_MS,
  })) {
    self.postMessage({ type: "confirmed", session: event.data.session, text: result.text, gloss: result.label,
      confidence: result.confidence, timestamp: Date.now(),
      source,
    } satisfies WorkerMessage);
    lastConfirmation = { label: result.label, time: now };
    handReturnedAfterConfirmation = false;
    if (useAslV31) {
      v3Segmenter.suppressCurrentSegment();
      queuedV3 = undefined;
    }
    if (activeLanguage === "asl" && !candidateIsModel) {
      blockedStarter = result.label;
      starterSeenAt = now;
    }
    invalidatePrediction();
    invalidatePersonal();
    candidateStreak = 0;
    if (activeLanguage === "asl") frames.length = 0;
    else frames.splice(0, Math.max(0, frames.length - 5));
  }
};

export {};
