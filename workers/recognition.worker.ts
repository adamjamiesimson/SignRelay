/// <reference lib="webworker" />

import type { CalibrationTemplate, VisionFrame, WorkerInput, WorkerMessage } from "@/lib/vision-types";
import { shouldConfirm } from "@/lib/decoder";
import { recognizePersonalTemplate, templatesForLanguage } from "@/lib/personalized-recognition";
import { recognizeAslStarter } from "@/lib/asl-starter-recognition";
import { analyzeSignMotion } from "@/lib/sign-motion";
import { hasAsl100CompletedSignMotion } from "@/lib/asl100-runtime";
import { recognizeAsl1000 } from "@/lib/asl1000-runtime";
import { recognizeIsl263 } from "@/lib/isl263-runtime";
import { recognizeBsl1064 } from "@/lib/bsl1064-runtime";
import { recognizeLse300 } from "@/lib/lse300-runtime";
import { MODEL_ADAPTERS, type LanguageId } from "@/lib/model-adapters";

const CONFIDENCE_THRESHOLD = 0.62;
const COOLDOWN_MS = 2600;
const frames: VisionFrame[] = [];
let candidateLabel: string | null = null;
let candidateStreak = 0;
let candidateIsModel = false;
let lastConfirmation = { label: "", time: 0 };
let personalTemplates: CalibrationTemplate[] = [];
let activeLanguage: LanguageId = "asl";
const classifiers = { asl: recognizeAsl1000, bsl: recognizeBsl1064, isl: recognizeIsl263, lse: recognizeLse300 };
const pending = new Set<LanguageId>();
const MAX_PREDICTION_AGE_MS = 2500;
let latestPrediction: Awaited<ReturnType<typeof recognizeAsl1000>> = null;
let predictionTimestamp = 0;
let predictionVersion = 0;
let consumedPredictionVersion = 0;
let receivedFrames = 0;
let modelGeneration = 0;
let modelProblem = false;
let retryAfter = 0;
let blockedStarter: string | null = null;
let starterSeenAt = 0;

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
  lastConfirmation = { label: "", time: 0 };
  invalidatePrediction();
  candidateLabel = null;
  candidateStreak = 0;
  candidateIsModel = false;
  blockedStarter = null;
  starterSeenAt = 0;
  modelProblem = false;
  retryAfter = 0;
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
  receivedFrames += 1;
  frames.push(event.data.frame);
  while (frames.length > (activeLanguage === "asl" ? 120 : 80)) frames.shift();
  const motion = activeLanguage === "asl" ? analyzeSignMotion(frames) : {
    ready: hasAsl100CompletedSignMotion(frames), sequence: frames, reason: "idle",
  };

  if (!motion.ready) invalidatePrediction();
  else {
    if (latestPrediction && now - predictionTimestamp > MAX_PREDICTION_AGE_MS) invalidatePrediction();
    const language = activeLanguage;
    const classifier = language in classifiers ? classifiers[language as keyof typeof classifiers] : null;
    const cadence = language === "isl" ? 8 : 6;
    if (classifier && MODEL_ADAPTERS[language].status === "experimental"
      && frames.length >= (language === "asl" ? 6 : 24) && receivedFrames % cadence === 0
      && !pending.has(language) && now >= retryAfter) {
      pending.add(language);
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
      }).finally(() => { pending.delete(language); });
    }
  }

  const personal = recognizePersonalTemplate(frames, personalTemplates);
  const direct = personal ?? (activeLanguage === "asl" ? recognizeAslStarter(frames) : null);
  if (direct?.label === blockedStarter) starterSeenAt = now;
  else if (now - starterSeenAt > 500) blockedStarter = null;
  const rawResult = direct?.label === blockedStarter ? null : direct ?? latestPrediction;
  const result = rawResult && Number.isFinite(rawResult.confidence) ? rawResult : null;
  const feedback = modelProblem
    ? activeLanguage === "asl"
      ? "The research model could not run. Common ASL signs and saved personal signs are still available. Retrying shortly…"
      : "The research model could not run. Saved personal signs are still available. Reload this page to try the research model again."
    : activeLanguage !== "asl" ? undefined
      : motion.reason === "hands" ? "Keep your signing hand in view. Tracking will resume automatically."
        : motion.reason === "moving" ? "Following your movement…"
          : result ? "Checking your sign…" : "Ready. Sign naturally, then pause briefly between words.";
  self.postMessage({ type: "analysis", state: frames.length < 6 ? "listening" : result ? "processing" : "uncertain",
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
  if (candidateLabel === result.label) candidateStreak += 1;
  else { candidateLabel = result.label; candidateStreak = 1; }

  if (shouldConfirm({ confidence: result.confidence, threshold: CONFIDENCE_THRESHOLD,
    streak: candidateStreak, sameLabel: lastConfirmation.label === result.label,
    elapsedSinceLast: now - lastConfirmation.time, cooldown: COOLDOWN_MS,
  })) {
    self.postMessage({ type: "confirmed", text: result.text, gloss: result.label,
      confidence: result.confidence, timestamp: Date.now(),
    } satisfies WorkerMessage);
    lastConfirmation = { label: result.label, time: now };
    if (activeLanguage === "asl" && !candidateIsModel) {
      blockedStarter = result.label;
      starterSeenAt = now;
    }
    invalidatePrediction();
    candidateStreak = 0;
    if (activeLanguage === "asl") frames.length = 0;
    else frames.splice(0, Math.max(0, frames.length - 5));
  }
};

export {};
