/// <reference lib="webworker" />

import type { CalibrationTemplate, VisionFrame, WorkerInput, WorkerMessage } from "@/lib/vision-types";
import { shouldConfirm } from "@/lib/decoder";
import { recognizePersonalTemplate, templatesForLanguage } from "@/lib/personalized-recognition";
import { recognizeAslStarter } from "@/lib/asl-starter-recognition";
import { analyzeSignMotion } from "@/lib/sign-motion";
import { analyzeGenericSignMotion } from "@/lib/asl100-runtime";
import { recognizeAsl1000 } from "@/lib/asl1000-runtime";
import { recognizeIsl263 } from "@/lib/isl263-runtime";
import { recognizeBsl1064 } from "@/lib/bsl1064-runtime";
import { recognizeLse300 } from "@/lib/lse300-runtime";
import { recognizePsl776 } from "@/lib/psl776-runtime";
import { MODEL_ADAPTERS, type LanguageId } from "@/lib/model-adapters";
import { InterSignGate } from "@/lib/inter-sign-gate";

const CONFIDENCE_THRESHOLD = 0.62;
const COOLDOWN_MS = 2600;
const frames: VisionFrame[] = [];
let candidateLabel: string | null = null;
let candidateStreak = 0;
let candidateIsModel = false;
let lastConfirmation = { label: "", time: 0 };
let personalTemplates: CalibrationTemplate[] = [];
let activeLanguage: LanguageId = "asl";
const classifiers = { asl: recognizeAsl1000, bsl: recognizeBsl1064, isl: recognizeIsl263, lse: recognizeLse300, psl: recognizePsl776 };
const pending = new Map<LanguageId, number>();
const MAX_PREDICTION_AGE_MS = 2500;
let latestPrediction: Awaited<ReturnType<typeof recognizeAsl1000>> = null;
let predictionTimestamp = 0;
let predictionVersion = 0;
let consumedPredictionVersion = 0;
let receivedFrames = 0;
let lastInferenceAt = -Infinity;
let modelGeneration = 0;
let modelProblem = false;
let retryAfter = 0;
const STARTER_VALIDATED_ASL_LABELS = new Set([
  "HELLO", "NO", "YES", "PLEASE", "SORRY", "THANK YOU", "I LOVE YOU",
]);
// These two rules have substantially stronger evidence than the geometric
// common-sign heuristics: YES requires a completed out-and-back wrist nod,
// while I LOVE YOU requires MediaPipe's dedicated hand gesture consistently
// across the held sign. They remain usable without a model decision.
const DIRECT_SAFE_STARTER_LABELS = new Set(["YES", "I LOVE YOU"]);
const interSignGate = new InterSignGate(260);

function invalidatePrediction() {
  latestPrediction = null;
  if (candidateIsModel) {
    candidateLabel = null;
    candidateStreak = 0;
  }
  modelGeneration += 1;
}

function resetSession() {
  frames.length = 0;
  receivedFrames = 0;
  lastInferenceAt = -Infinity;
  lastConfirmation = { label: "", time: 0 };
  invalidatePrediction();
  candidateLabel = null;
  candidateStreak = 0;
  candidateIsModel = false;
  modelProblem = false;
  retryAfter = 0;
  interSignGate.reset();
}

self.onmessage = async (event: MessageEvent<WorkerInput>) => {
  if (event.data.type === "templates") {
    activeLanguage = event.data.language;
    personalTemplates = templatesForLanguage(event.data.templates, activeLanguage);
    resetSession();
    return;
  }
  if (event.data.type === "reset") { resetSession(); return; }

  const now = event.data.frame.timestamp;
  if ([...pending.values()].some(started => now - started >= 20000)) {
    invalidatePrediction();
    pending.clear();
    self.postMessage({ type: "fault", session: event.data.session,
      message: "The research model stopped responding. Restarting recognition…",
    } satisfies WorkerMessage);
    return;
  }
  receivedFrames += 1;
  frames.push(event.data.frame);
  while (frames.length > (activeLanguage === "asl" ? 120 : 80)) frames.shift();
  const personal = recognizePersonalTemplate(frames, personalTemplates);
  const starter = activeLanguage === "asl" ? recognizeAslStarter(frames) : null;
  // The closed-set model can force arbitrary movement into one of its labels.
  // For the seven common motion-sensitive signs where SignRelay has an
  // explicit temporal rule, require model + temporal-rule agreement. The
  // heuristic rule is a validator only; it never emits a transcript word by
  // itself. This prevents open-hand waves or unrelated circular movements
  // from becoming confident HELLO/PLEASE/SORRY/etc. outputs.
  const modelGloss = latestPrediction?.label.trim().toUpperCase();
  if (activeLanguage === "asl" && modelGloss && STARTER_VALIDATED_ASL_LABELS.has(modelGloss)
    && starter?.label !== modelGloss) invalidatePrediction();
  const motion = activeLanguage === "asl" ? analyzeSignMotion(frames)
    : { ...analyzeGenericSignMotion(frames), sequence: frames };
  const armedForNextSign = interSignGate.update(now, motion.reason);

  if (!armedForNextSign || !motion.ready) invalidatePrediction();
  else {
    if (latestPrediction && now - predictionTimestamp > MAX_PREDICTION_AGE_MS) invalidatePrediction();
    const language = activeLanguage;
    const classifier = language in classifiers ? classifiers[language as keyof typeof classifiers] : null;
    const cadence = language === "isl" ? 8 : 6;
    // Frame-count scheduling can skip the entire completion window on a slow
    // device. ASL needs fresh results while that movement is still available.
    const inferenceDue = language === "asl" ? now - lastInferenceAt >= 250 : receivedFrames % cadence === 0;
    const freshResult = latestPrediction && Number.isFinite(latestPrediction.confidence)
      && latestPrediction.confidence >= CONFIDENCE_THRESHOLD && consumedPredictionVersion !== predictionVersion;
    if (classifier && MODEL_ADAPTERS[language].status === "experimental"
      && frames.length >= (language === "asl" ? 6 : 24) && inferenceDue
      && !freshResult && !pending.has(language) && now >= retryAfter) {
      pending.set(language, now);
      lastInferenceAt = now;
      const generation = modelGeneration;
      classifier([...motion.sequence]).then((prediction) => {
        if (generation !== modelGeneration) return;
        if ((frames.at(-1)?.timestamp ?? now) - now > MAX_PREDICTION_AGE_MS) return;
        latestPrediction = prediction;
        predictionTimestamp = now;
        predictionVersion += 1;
        modelProblem = false;
      }).catch(() => {
        if (generation !== modelGeneration) return;
        invalidatePrediction();
        modelProblem = true;
        retryAfter = now + 5000;
      }).finally(() => { if (pending.get(language) === now) pending.delete(language); });
    }
  }

  // Personal, signer-taught templates stay independent and highest priority.
  // Geometric starter rules cannot create words on their own. Only the two
  // high-specificity direct rules above remain available without a model.
  const directSafeStarter = starter && DIRECT_SAFE_STARTER_LABELS.has(starter.label)
    ? starter : null;
  const rawResult = !armedForNextSign ? null : personal ?? latestPrediction ?? directSafeStarter;
  const result = rawResult && Number.isFinite(rawResult.confidence) ? rawResult : null;
  const feedback = modelProblem
    ? activeLanguage === "asl"
      ? "The research model could not run. Saved personal signs are still available. Retrying shortly…"
      : "The research model could not run. Saved personal signs are still available. Retrying shortly…"
    : !armedForNextSign ? "Pause briefly before the next sign."
      : motion.reason === "hands" ? "Keep your signing hand in view. Tracking will resume automatically."
      : motion.reason === "moving" ? "Following your movement…"
        : result ? "Checking your sign…" : "Ready. Sign naturally, then pause briefly between words.";
  self.postMessage({ type: "analysis", session: event.data.session, frameId: event.data.frameId,
    state: frames.length < 6 ? "listening" : result ? "processing" : "uncertain",
    candidate: result?.label ?? null, confidence: result?.confidence ?? 0,
    bufferSize: frames.length, feedback,
  } satisfies WorkerMessage);

  if (!result || result.confidence < CONFIDENCE_THRESHOLD) {
    candidateLabel = null;
    candidateStreak = 0;
    return;
  }
  if (result === latestPrediction) {
    if (consumedPredictionVersion === predictionVersion) return;
    consumedPredictionVersion = predictionVersion;
  }
  candidateIsModel = result === latestPrediction;
  const temporalValidatedModel = activeLanguage === "asl" && candidateIsModel
    && STARTER_VALIDATED_ASL_LABELS.has(result.label.trim().toUpperCase())
    && starter?.label === result.label.trim().toUpperCase();
  if (candidateLabel === result.label) candidateStreak += 1;
  else {
    candidateLabel = result.label;
    // A fresh model result plus an independently computed temporal-rule match
    // provides two distinct pieces of evidence. Ordinary model words still
    // need two fresh model predictions.
    candidateStreak = temporalValidatedModel ? 2 : 1;
  }

  if (shouldConfirm({ confidence: result.confidence, threshold: CONFIDENCE_THRESHOLD,
    streak: candidateStreak, sameLabel: lastConfirmation.label === result.label,
    elapsedSinceLast: now - lastConfirmation.time, cooldown: COOLDOWN_MS,
  })) {
    self.postMessage({ type: "confirmed", session: event.data.session, text: result.text, gloss: result.label,
      confidence: result.confidence, timestamp: Date.now(),
    } satisfies WorkerMessage);
    lastConfirmation = { label: result.label, time: now };
    interSignGate.lock();
    invalidatePrediction();
    candidateStreak = 0;
    if (activeLanguage === "asl") frames.length = 0;
    else frames.splice(0, Math.max(0, frames.length - 5));
  }
};

export {};
