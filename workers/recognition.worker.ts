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
import { TemplateMatchingClient, unpackTemplates, type TemplatePrediction } from "@/lib/template-matching-client";
import { validHand } from "@/lib/asl-starter-recognition";
import { MODEL_ADAPTERS, type LanguageId } from "@/lib/model-adapters";
import { appendObservation } from "@/lib/frame-timing";

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
let completedModelMs: number | undefined;

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

function resetSession() {
  completedModelMs = undefined;
  // In-flight requests from old sessions are invalidated by modelGeneration;
  // do not let their timers restart a newly selected language.
  for (const request of pending.values()) request.controller.abort();
  pending.clear();
  invalidatePersonal();
  frames.length = 0;
  receivedFrames = 0;
  lastInferenceAt = -Infinity;
  lastConfirmation = { label: "", time: 0 };
  invalidatePrediction();
  candidateLabel = null;
  candidateStreak = 0;
  candidateIsModel = false;
  blockedStarter = null;
  starterSeenAt = 0;
  modelProblem = false;
  retryAfter = 0;
  personalProblem = false;
  hadPersonalTracking = false;
  candidateSource = undefined;
}

self.onmessage = async (event: MessageEvent<WorkerInput>) => {
  const processingStarted = performance.now();
  if (event.data.type === "templates") {
    activeLanguage = event.data.language;
    const { templates } = event.data;
    personalTemplates = templatesForLanguage(Array.isArray(templates) ? templates : unpackTemplates(templates), activeLanguage);
    resetSession();
    personalMatcher.configure(personalTemplates);
    return;
  }
  if (event.data.type === "reset") { resetSession(); return; }

  const now = event.data.frame.timestamp;
  for (const [language, request] of pending) {
    const deadline = request.phase === "loading" ? MODEL_LOAD_TIMEOUT_MS : NORMAL_INFERENCE_TIMEOUT_MS;
    if (now - request.started < deadline) continue;
    if (request.phase === "loading") {
      request.controller.abort(); pending.delete(language);
      modelProblem = true; retryAfter = now + 30000;
    } else {
      invalidatePrediction(); pending.clear();
      self.postMessage({ type: "fault", session: event.data.session,
        message: "The research model stopped responding. Restarting recognition…",
      } satisfies WorkerMessage);
      return;
    }
  }
  receivedFrames += 1;
  appendObservation(frames, event.data.frame);
  const hasHand = event.data.frame.hands.some(validHand);
  if (!hasHand && hadPersonalTracking) invalidatePersonal();
  hadPersonalTracking = hasHand;
  if (latestPersonal && (now - personalTimestamp > MAX_PREDICTION_AGE_MS
    || performance.now() - personalReceivedAt > MAX_PREDICTION_AGE_MS)) latestPersonal = null;
  if (hasHand) personalMatcher.submit(frames);
  const personal = latestPersonal;
  const starterAnalysis = activeLanguage === "asl" ? analyzeAslStarter(frames) : null;
  const starter = starterAnalysis?.prediction ?? null;
  // The closed-set model can also label fist preparation YES. Require the
  // same completed wrist nod for automatic YES, while preserving personal
  // templates. Discard a rejected result so it cannot stall fresh inference.
  if (activeLanguage === "asl" && latestPrediction?.label.trim().toUpperCase() === "YES"
    && starter?.label !== "YES") invalidatePrediction();
  const motion = activeLanguage === "asl" ? analyzeSignMotion(frames)
    : { ...analyzeGenericSignMotion(frames), sequence: frames };

  if (!motion.ready || starterAnalysis?.ambiguousOpenPalm) invalidatePrediction();
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
      && !freshResult && !pending.has(language) && now >= retryAfter) {
      const request = { started: now, phase: (language === "asl" ? "inference" : "loading") as "loading" | "inference", controller: new AbortController() };
      pending.set(language, request);
      lastInferenceAt = now;
      const generation = modelGeneration;
      const submittedAt = performance.now();
      let inferenceStarted: number | undefined;
      classifier([...motion.sequence], { signal: request.controller.signal, onPhase: phase => {
        if (pending.get(language) !== request) return;
        request.phase = phase;
        if (phase === "inference") inferenceStarted = performance.now();
        request.started = frames.at(-1)?.timestamp ?? now;
      } }).then((prediction) => {
        if (generation !== modelGeneration || request.controller.signal.aborted) return;
        if (inferenceStarted !== undefined) completedModelMs = performance.now() - inferenceStarted;
        if ((frames.at(-1)?.timestamp ?? now) - now > MAX_PREDICTION_AGE_MS
          || performance.now() - submittedAt > MAX_PREDICTION_AGE_MS) return;
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
    ? activeLanguage === "asl"
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
    ...(event.data.measure ? { processingMs: performance.now() - processingStarted,
      modelMs: completedModelMs, personalMs: personalMatcher.takeTiming(), referenceMs: pslMatcher.takeTiming() } : {}),
  } satisfies WorkerMessage);
  completedModelMs = undefined;

  if (!result || result.confidence < CONFIDENCE_THRESHOLD) {
    candidateLabel = null;
    candidateStreak = 0;
    return;
  }
  if (result === latestPrediction) {
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
