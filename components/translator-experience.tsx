"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DEFAULT_SETTINGS,
  clearLocalSignRelayData,
  loadHistory,
  loadSettings,
  saveSession,
  saveSettings,
  type SpeechSettings,
  type TranscriptEntry,
  type TranscriptSession,
} from "@/lib/browser-storage";
import {
  clearCalibrationTemplates,
  deleteCalibrationGloss,
  loadCalibrationTemplates,
  saveCalibrationTemplate,
} from "@/lib/calibration-storage";
import {
  createCustomVocabularyEntry,
  LANGUAGE_LIST,
  MODEL_ADAPTERS,
  PERSONAL_STARTER_VOCABULARY,
  type AslVocabularyEntry,
  type LanguageId,
} from "@/lib/model-adapters";
import { isRecentDuplicate } from "@/lib/decoder";
import { calibrationFrames, prepareCalibrationSequence } from "@/lib/personalized-recognition";
import { LiveVision } from "@/lib/live-vision";
import { RecognitionSession } from "@/lib/recognition-session";
import { recognitionStatus } from "@/lib/recognition-status";
import { ASL_ONLY, OUT_OF_PROFILE_LABEL, isLanguageAvailable } from "@/lib/build-profile";
import { REHEARSAL, RehearsalScript } from "@/lib/rehearsal";
import { formatPerfReadout, RollingTimer, ThroughputMonitor } from "@/lib/frame-perf";
import { capabilityStatus, SIGN_LANGUAGE_NOTE } from "@/lib/capability-status";
const RslRecognizer = dynamic(() => import("@/components/rsl-recognizer").then(module => module.RslRecognizer));
const BdslRecognizer = dynamic(() => import("@/components/bdsl-recognizer").then(module => module.BdslRecognizer));
import type {
  CalibrationTemplate,
  DetectionStatus,
  VisionFrame,
  WorkerMessage,
} from "@/lib/vision-types";
import { SiteFooter, SiteHeader } from "./site-chrome";
import { FigmaMakeLanding } from "./figma-make-landing";
import { SurfaceMotion } from "./surface-motion";

type Step = "welcome" | "workspace";
type CameraState = "idle" | "requesting" | "loading" | "active" | "denied" | "error";
type RecognitionState = "listening" | "processing" | "uncertain";
type CalibrationState = "idle" | "countdown" | "recording" | "saving" | "saved" | "error";

const EMPTY_DETECTION: DetectionStatus = {
  person: false,
  hands: false,
  face: false,
  pose: false,
};

export function TranslatorExperience() {
  const [step, setStep] = useState<Step>("welcome");
  const [selected, setSelected] = useState<LanguageId>("asl");
  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [cameraMessage, setCameraMessage] = useState("Camera is off");
  const [detection, setDetection] = useState<DetectionStatus>(EMPTY_DETECTION);
  const [recognitionState, setRecognitionState] = useState<RecognitionState>("listening");
  const [candidate, setCandidate] = useState<string | null>(null);
  const [confidence, setConfidence] = useState(0);
  const [bufferSize, setBufferSize] = useState(0);
  const [recognitionFeedback, setRecognitionFeedback] = useState("");
  const [recognitionUnavailable, setRecognitionUnavailable] = useState(false);
  const [motionReason, setMotionReason] = useState<string | null>(null);
  const [visionSource, setVisionSource] = useState<LiveVision["assetSource"] | null>(null);
  // Screen readers hear confirmed words and camera changes, never tentative candidates.
  const [announcement, setAnnouncement] = useState("");
  const [transcriptMessage, setTranscriptMessage] = useState("");
  const [privacyMessage, setPrivacyMessage] = useState("");
  // Opt-in device-test readout (`?perf`): timings only, nothing is stored or sent.
  const [perfMode] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("perf"));
  const [perfReadout, setPerfReadout] = useState("");
  const [perfWarning, setPerfWarning] = useState<string | null>(null);
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [storageMessage, setStorageMessage] = useState("");
  const [history, setHistory] = useState<TranscriptSession[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [settings, setSettings] = useState<SpeechSettings>(DEFAULT_SETTINGS);
  const [calibrationTemplates, setCalibrationTemplates] = useState<CalibrationTemplate[]>([]);
  const [calibrationWord, setCalibrationWord] = useState<AslVocabularyEntry>(() => createCustomVocabularyEntry("Personal sign")!);
  const [customWordInput, setCustomWordInput] = useState("");
  const [vocabularySearch, setVocabularySearch] = useState("");
  const [calibrationState, setCalibrationState] = useState<CalibrationState>("idle");
  const [calibrationMessage, setCalibrationMessage] = useState("Type a word or short phrase, then record the complete sign one to three times.");
  const [countdown, setCountdown] = useState(3);

  const videoRef = useRef<HTMLVideoElement>(null);
  const vocabularyRef = useRef<HTMLDetailsElement>(null);
  const transcriptHeadingRef = useRef<HTMLHeadingElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const engineRef = useRef<LiveVision | null>(null);
  const workerRef = useRef<RecognitionSession | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);
  const lastVideoTimeRef = useRef(-1);
  const frameErrorsRef = useRef(0);
  const cameraProgressRef = useRef(0);
  const cameraGenerationRef = useRef(0);
  const trackingEpochRef = useRef(0);
  const cameraPendingRef = useRef(false);
  const captureGenerationRef = useRef(0);
  const frameLoopRef = useRef<() => void>(() => {});
  const settingsRef = useRef(settings);
  const sessionStartedRef = useRef(0);
  const templatesRef = useRef<CalibrationTemplate[]>([]);
  const captureFramesRef = useRef<VisionFrame[]>([]);
  const captureStateRef = useRef<CalibrationState>("idle");
  const entriesRef = useRef<TranscriptEntry[]>([]);
  const rehearsalRef = useRef<RehearsalScript | null>(null);
  useEffect(() => {
    if (!REHEARSAL) return;
    const script = new RehearsalScript();
    rehearsalRef.current = script;
    (window as unknown as { __signrelayRehearsal?: unknown }).__signrelayRehearsal = {
      play: (frames: VisionFrame[]) => script.play(frames), get playing() { return script.playing; },
    };
    return () => { delete (window as unknown as { __signrelayRehearsal?: unknown }).__signrelayRehearsal; };
  }, []);
  const perfRef = useRef({ tracking: new RollingTimer(), roundTrip: new RollingTimer(), queueWait: new RollingTimer(),
    capture: new RollingTimer(), hands: new RollingTimer(), auxiliary: new RollingTimer(), transport: new RollingTimer(),
    overlay: new RollingTimer(), age: new RollingTimer(), classification: new RollingTimer(), communication: new RollingTimer(),
    model: new RollingTimer(), personal: new RollingTimer(), reference: new RollingTimer(),
    throughput: new ThroughputMonitor(), analysed: 0, since: 0, frames: 0, handFrames: 0 });

  const model = useMemo(
    () => LANGUAGE_LIST.find((item) => item.id === selected)!,
    [selected],
  );

  const calibrationCounts = useMemo(() => {
    const counts = new Map<string, number>();
    calibrationTemplates
      .filter((template) => (template.language ?? "asl") === selected)
      .forEach((template) => counts.set(template.gloss, (counts.get(template.gloss) ?? 0) + 1));
    return counts;
  }, [calibrationTemplates, selected]);

  const trainedGlosses = useMemo(() => new Set(calibrationCounts.keys()), [calibrationCounts]);

  const calibrationVocabulary = useMemo(() => {
    const knownGlosses = new Set<string>();
    const customWords: AslVocabularyEntry[] = [];

    calibrationTemplates.filter((template) => (template.language ?? "asl") === selected).forEach((template) => {
      if (knownGlosses.has(template.gloss)) return;
      const word = createCustomVocabularyEntry(template.text || template.gloss);
      if (!word || knownGlosses.has(word.gloss)) return;
      knownGlosses.add(word.gloss);
      customWords.push(word);
    });

    return customWords;
  }, [calibrationTemplates, selected]);

  const activeCustomCount = trainedGlosses.size;

  const filteredCalibrationVocabulary = useMemo(() => {
    const builtInStarter = selected === "asl" ? [] : PERSONAL_STARTER_VOCABULARY;
    const knownGlosses = new Set<string>();
    return [...calibrationVocabulary, ...builtInStarter].filter((word) => {
      if (knownGlosses.has(word.gloss)) return false;
      knownGlosses.add(word.gloss);
      return true;
    });
  }, [calibrationVocabulary, selected]);

  const visibleCalibrationVocabulary = useMemo(() => {
    const search = vocabularySearch.trim().toLocaleLowerCase();
    const matches = search
      ? filteredCalibrationVocabulary.filter((word) => `${word.text} ${word.gloss}`.toLocaleLowerCase().includes(search))
      : filteredCalibrationVocabulary;
    return matches.slice(0, search ? 200 : 80);
  }, [filteredCalibrationVocabulary, vocabularySearch]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSettings(loadSettings());
      setHistory(loadHistory());
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    void loadCalibrationTemplates()
      .then(setCalibrationTemplates)
      .catch(() => setCalibrationMessage("Personal vocabulary storage is unavailable in this browser."));
  }, []);

  useEffect(() => {
    templatesRef.current = calibrationTemplates;
    workerRef.current?.postMessage({ type: "templates", language: selected, templates: calibrationTemplates });
  }, [calibrationTemplates, selected]);

  function selectLanguage(language: LanguageId) {
    if (language === selected) return true;
    // The ASL demo build does not ship other models; never open a workspace
    // that would pretend they are usable.
    if (!isLanguageAvailable(language)) {
      setStorageMessage(`${MODEL_ADAPTERS[language].language} is not included in this ASL demo build.`);
      return false;
    }
    // All entry points share this boundary, including returning home before
    // selecting another language. Keep the original transcript on save failure.
    if (entries.length) {
      const saved = saveSession({ id: String(sessionStartedRef.current), language: selected,
        createdAt: sessionStartedRef.current, entries });
      if (!saved) {
        setStorageMessage("Couldn't save this transcript. It has been kept here. Free browser storage before changing languages.");
        return false;
      }
      setHistory(loadHistory());
    }
    setEntries([]);
    setEditingId(null);
    setStorageMessage("");
    setTranscriptMessage("");
    // Nothing from the previous language's transcript may keep speaking.
    window.speechSynthesis?.cancel();
    sessionStartedRef.current = Date.now();
    workerRef.current?.postMessage({ type: "reset" });
    captureGenerationRef.current++;
    setSelected(language);
    const personalSign = createCustomVocabularyEntry("Personal sign")!;
    setCalibrationWord(personalSign);
    setCustomWordInput("");
    setVocabularySearch("");
    captureStateRef.current = "idle";
    setCalibrationState("idle");
    setCalibrationMessage(`Type a ${language.toUpperCase()} word or short phrase, then record two or three examples.`);
    return true;
  }

  useEffect(() => { entriesRef.current = entries; }, [entries]);

  useEffect(() => {
    settingsRef.current = settings;
    if (typeof window !== "undefined") saveSettings(settings);
  }, [settings]);

  const speak = useCallback((text: string) => {
    if (!text || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.volume = settingsRef.current.volume;
    utterance.rate = settingsRef.current.rate;
    utterance.lang = model.speechLocale;
    window.speechSynthesis.speak(utterance);
  }, [model.speechLocale]);

  const handleWorkerMessage = useCallback((message: WorkerMessage) => {
    if (message.type === "analysis") {
      if (perfMode) {
        perfRef.current.analysed++;
        const roundTrip = workerRef.current?.lastRoundTripMs;
        if (roundTrip !== null && roundTrip !== undefined) perfRef.current.roundTrip.record(roundTrip);
        if (message.processingMs !== undefined) {
          perfRef.current.classification.record(message.processingMs);
          if (roundTrip != null) perfRef.current.communication.record(Math.max(0, roundTrip - message.processingMs));
        }
        if (message.modelMs !== undefined) perfRef.current.model.record(message.modelMs);
        if (message.personalMs !== undefined) perfRef.current.personal.record(message.personalMs);
        if (message.referenceMs !== undefined) perfRef.current.reference.record(message.referenceMs);
        const queueWait = workerRef.current?.stats.lastQueueAgeMs;
        if (queueWait !== null && queueWait !== undefined) perfRef.current.queueWait.record(queueWait);
      }
      setRecognitionUnavailable(false);
      setRecognitionState(message.state);
      setCandidate(message.candidate);
      setConfidence(message.confidence);
      setBufferSize(message.bufferSize);
      setRecognitionFeedback(message.feedback ?? "");
      setMotionReason(message.motionReason ?? null);
      return;
    }
    // Confirmations from a stopped or replaced session never reach here:
    // RecognitionSession drops messages from before every reset.
    if (message.type !== "confirmed") return;

    const entry: TranscriptEntry = {
      id: `${message.timestamp}-${message.gloss}`,
      text: message.text,
      gloss: message.gloss,
      confidence: message.confidence,
      timestamp: message.timestamp,
      source: message.source,
    };
    // Decide once, synchronously, so a suppressed duplicate is neither shown nor spoken.
    if (isRecentDuplicate(entriesRef.current.at(-1), entry)) return;
    entriesRef.current = [...entriesRef.current, entry];
    setEntries(entriesRef.current);
    setAnnouncement(`Confirmed: ${message.text}`);
    if (settingsRef.current.autoSpeak) speak(message.text);
  }, [speak, perfMode]);

  useEffect(() => {
    if (step !== "workspace" || selected === "rsl" || (selected === "bdsl" && MODEL_ADAPTERS.bdsl.status === "experimental")) return;
    const worker = new RecognitionSession(
      () => new Worker("/workers/recognition.worker.js?v=tracking-temporal-3", { type: "module" }),
      handleWorkerMessage,
      status => {
        setRecognitionUnavailable(status.state === "failed");
        if (status.message) setRecognitionFeedback(status.message);
        if (status.state !== "running") {
          setCandidate(null);
          setConfidence(0);
          setBufferSize(0);
          setRecognitionState("listening");
        }
      },
      perfMode,
    );
    worker.postMessage({ type: "templates", language: selected, templates: templatesRef.current });
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [step, selected, handleWorkerMessage, perfMode]);

  const stopCamera = useCallback(() => {
    cameraGenerationRef.current++;
    captureGenerationRef.current++;
    cameraPendingRef.current = false;
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    engineRef.current?.close();
    engineRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    workerRef.current?.postMessage({ type: "reset" });
    setCameraState("idle");
    setCameraMessage("Camera is off");
    setDetection(EMPTY_DETECTION);
    setCandidate(null);
    setConfidence(0);
    setBufferSize(0);
    setRecognitionFeedback("");
    setMotionReason(null);
    window.speechSynthesis?.cancel();
    lastVideoTimeRef.current = -1;
    frameErrorsRef.current = 0;
    captureStateRef.current = "idle";
    captureFramesRef.current = [];
    setCalibrationState("idle");
  }, []);

  const changeWorkspaceLanguage = (language: LanguageId) => {
    if (language === selected) return;

    if (!selectLanguage(language)) return;

    const enteringSpecialRecognizer = language === "rsl" || language === "bdsl";
    const leavingSharedRecognizer = selected !== "rsl" && selected !== "bdsl";
    if (enteringSpecialRecognizer && leavingSharedRecognizer) stopCamera();

    workerRef.current?.postMessage({ type: "reset" });
    setCandidate(null);
    setConfidence(0);
    setBufferSize(0);
    setRecognitionFeedback("");
    setRecognitionUnavailable(false);
    setRecognitionState("listening");
  };

  useEffect(() => {
    if (!perfMode || cameraState !== "active") return;
    const perf = perfRef.current;
    perf.tracking.reset(); perf.roundTrip.reset(); perf.queueWait.reset(); perf.throughput.reset();
    for (const name of ["capture", "hands", "auxiliary", "transport", "overlay", "age", "classification", "communication", "model", "personal", "reference"] as const) perf[name].reset();
    perf.analysed = 0; perf.frames = 0; perf.handFrames = 0; perf.since = performance.now();
    workerRef.current?.resetStats();
    const timer = window.setInterval(() => {
      const session = workerRef.current;
      perf.throughput.tick(perf.analysed, performance.now());
      setPerfWarning(perf.throughput.warning());
      setPerfReadout(formatPerfReadout({ tracking: perf.tracking.summary(), roundTrip: perf.roundTrip.summary(), queueWait: perf.queueWait.summary(),
        seconds: (performance.now() - perf.since) / 1000, analysed: perf.analysed, session: session?.stats ?? null,
        assets: engineRef.current?.assetSource ?? null,
        recognition: session ? { state: session.state, recoveries: session.stats.recoveries } : null,
        hands: { seen: perf.handFrames, frames: perf.frames },
        stages: Object.fromEntries((["capture", "hands", "auxiliary", "transport", "overlay", "age", "classification", "communication", "model", "personal", "reference"] as const)
          .map(name => [name, perf[name].summary()])),
        tracker: engineRef.current ? `${engineRef.current.mode}/${engineRef.current.delegate}` : undefined }));
    }, 1000);
    return () => { window.clearInterval(timer); setPerfWarning(null); };
  }, [perfMode, cameraState]);

  useEffect(() => () => {
    cameraGenerationRef.current++;
    captureGenerationRef.current++;
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    engineRef.current?.close();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    window.speechSynthesis?.cancel();
  }, []);

  const drawOverlay = useCallback((frame: VisionFrame) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!settingsRef.current.showOverlay) return;

    const drawPoints = (points: Array<{ x: number; y: number }>, color: string, radius: number) => {
      context.fillStyle = color;
      for (const point of points) {
        context.beginPath();
        context.arc(point.x * canvas.width, point.y * canvas.height, radius, 0, Math.PI * 2);
        context.fill();
      }
    };

    frame.hands.forEach((hand) => {
      context.strokeStyle = "rgba(118, 236, 199, .78)";
      context.lineWidth = 2;
      const connections = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
      for (const [a, b] of connections) {
        const start = hand.landmarks[a];
        const end = hand.landmarks[b];
        if (!start || !end) continue;
        context.beginPath();
        context.moveTo(start.x * canvas.width, start.y * canvas.height);
        context.lineTo(end.x * canvas.width, end.y * canvas.height);
        context.stroke();
      }
      drawPoints(hand.landmarks, "#b8ffe9", 3.2);
    });
    drawPoints(frame.face, "rgba(255, 217, 129, .9)", 2.6);
    drawPoints(frame.pose, "rgba(190, 220, 255, .9)", 3.2);
  }, []);

  const runFrameLoop = useCallback(() => {
    const video = videoRef.current;
    const engine = engineRef.current;
    const now = performance.now();
    // A track can end without an "ended" event (stopped by script, some drivers,
    // revoked permission), and some browsers keep advancing the video clock.
    const tracks = streamRef.current?.getVideoTracks() ?? [];
    if (engine && tracks.length && tracks.every((track) => track.readyState === "ended")) {
      stopCamera();
      setCameraState("error");
      setCameraMessage("The camera was disconnected or stopped by your device. Start the camera again to reconnect.");
      return;
    }
    if (video && engine && !document.hidden) {
      if (video.readyState >= 2 && video.currentTime !== lastVideoTimeRef.current) cameraProgressRef.current = now;
      if (now - cameraProgressRef.current >= 8000) {
        stopCamera();
        setCameraState("error");
        setCameraMessage("The camera stopped sending video. Start the camera again to reconnect.");
        return;
      }
    }
    if (!video || !engine || video.readyState < 2 || document.hidden) {
      animationRef.current = requestAnimationFrame(frameLoopRef.current);
      return;
    }

    if (!engine.busy && now - lastFrameRef.current >= 33 && video.currentTime !== lastVideoTimeRef.current) {
      lastFrameRef.current = now;
      lastVideoTimeRef.current = video.currentTime;
      const generation = cameraGenerationRef.current;
      const trackingEpoch = trackingEpochRef.current;
      const captureGeneration = captureGenerationRef.current;
      const trackingStarted = performance.now();
      const current = () => engineRef.current === engine && cameraGenerationRef.current === generation
        && trackingEpochRef.current === trackingEpoch && !document.hidden;
      const showHands = (frame: VisionFrame) => {
        if (!current()) return;
        const drawing = performance.now();
        drawOverlay(frame);
        if (perfMode) {
          perfRef.current.overlay.record(performance.now() - drawing);
          perfRef.current.age.record(performance.now() - trackingStarted);
        }
      };
      void (async () => {
        // Rehearsal builds only: while a script plays, synthetic landmarks replace
        // the tracker, which is not run (its output would be discarded).
        const rehearsal = REHEARSAL ? rehearsalRef.current?.next(now) : null;
        if (rehearsal) showHands(rehearsal);
        const frame = rehearsal ?? await engine.process(video, now, showHands);
        if (!frame || !current() || captureGeneration !== captureGenerationRef.current) return;
        if (perfMode) {
          perfRef.current.tracking.record(performance.now() - trackingStarted);
          for (const name of ["capture", "hands", "auxiliary", "transport"] as const) perfRef.current[name].record(engine.timings[name]);
          perfRef.current.frames++;
          if (frame.hands.length) perfRef.current.handFrames++;
        }
        const nextDetection = {
          person: frame.face.length > 0 || frame.pose.length > 0,
          hands: frame.hands.length > 0,
          face: frame.face.length > 0,
          pose: frame.pose.length > 0,
        };
        setDetection(previous => Object.keys(nextDetection).every(key => previous[key as keyof DetectionStatus] === nextDetection[key as keyof DetectionStatus]) ? previous : nextDetection);
        if (captureStateRef.current === "recording") captureFramesRef.current.push(frame);
        else workerRef.current?.postMessage({ type: "frame", frame });
        frameErrorsRef.current = 0;
      })().catch(error => {
        if (!current()) return;
        if (process.env.NODE_ENV === "development") console.warn("A video frame could not be processed", error);
        if (++frameErrorsRef.current >= 5) {
          stopCamera();
          setCameraState("error");
          setCameraMessage("Hand tracking stopped. Start the camera again to reload tracking.");
          return;
        }
      });
    }
    animationRef.current = requestAnimationFrame(frameLoopRef.current);
  }, [drawOverlay, stopCamera, perfMode]);

  useEffect(() => {
    frameLoopRef.current = runFrameLoop;
  }, [runFrameLoop]);

  const requestCamera = useCallback(async () => {
    if (cameraPendingRef.current || engineRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState("error");
      setCameraMessage("This browser does not expose camera access.");
      return;
    }
    const generation = ++cameraGenerationRef.current;
    cameraPendingRef.current = true;
    setCameraState("requesting");
    setCameraMessage("Waiting for camera permission");
    let loadingVision = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (generation !== cameraGenerationRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      streamRef.current = stream;
      for (const track of stream.getVideoTracks()) track.addEventListener("ended", () => {
        if (generation !== cameraGenerationRef.current) return;
        stopCamera();
        setCameraState("error");
        setCameraMessage("The camera was disconnected or stopped by your device. Start the camera again to reconnect.");
      }, { once: true });
      if (!videoRef.current) throw new Error("Camera view was not ready");
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      if (generation !== cameraGenerationRef.current) return;

      setCameraState("loading");
      loadingVision = true;
      const engine = await LiveVision.create(message => {
        if (generation === cameraGenerationRef.current) setCameraMessage(message);
      });
      if (generation !== cameraGenerationRef.current) { engine.close(); return; }
      engineRef.current = engine;
      setVisionSource(engine.assetSource);
      cameraProgressRef.current = performance.now();
      setCameraState("active");
      setCameraMessage("Camera and vision models active");
      animationRef.current = requestAnimationFrame(frameLoopRef.current);
    } catch (error) {
      if (generation !== cameraGenerationRef.current) return;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      const name = error instanceof Error ? error.name : "";
      const permissionDenied = !loadingVision && (name === "NotAllowedError" || name === "PermissionDeniedError");
      setCameraState(permissionDenied ? "denied" : "error");
      setCameraMessage(loadingVision
        ? "The camera opened, but the tracking models could not load. Check your connection and start the camera again."
        : permissionDenied
        ? "Camera permission was denied. SignRelay cannot analyse video without it."
        : name === "NotFoundError" || name === "DevicesNotFoundError"
          ? "No camera was found. Connect or enable a camera, then start it again."
          : name === "NotReadableError" || name === "TrackStartError"
            ? "The camera is busy or unavailable. Close other apps using it, then start it again."
            : "The camera could not start. Check camera access in your browser and device settings, then try again.");
    } finally {
      if (generation === cameraGenerationRef.current) cameraPendingRef.current = false;
    }
  }, [stopCamera]);

  useEffect(() => {
    const resume = () => {
      trackingEpochRef.current++;
      workerRef.current?.postMessage({ type: "reset" });
      cameraProgressRef.current = performance.now();
      const video = videoRef.current;
      if (document.hidden || !engineRef.current || !video?.paused) return;
      const generation = cameraGenerationRef.current;
      void video.play().catch(() => {
        if (generation !== cameraGenerationRef.current) return;
        stopCamera();
        setCameraState("error");
        setCameraMessage("Camera playback was interrupted. Start the camera again to resume.");
      });
    };
    document.addEventListener("visibilitychange", resume);
    return () => document.removeEventListener("visibilitychange", resume);
  }, [stopCamera]);

  const beginTranslation = () => {
    if (!entries.length) sessionStartedRef.current = Date.now();
    const generation = ++cameraGenerationRef.current;
    setStep("workspace");
    window.scrollTo({ top: 0, behavior: "smooth" });
    // RSL and Bangla use their own clip-capture components and cameras.
    if (selected !== "rsl" && selected !== "bdsl") {
      window.setTimeout(() => {
        if (generation === cameraGenerationRef.current) void requestCamera();
      }, 0);
    }
  };

  const recordCalibration = useCallback(async () => {
    if (captureStateRef.current !== "idle" && captureStateRef.current !== "saved" && captureStateRef.current !== "error") return;
    const captureGeneration = ++captureGenerationRef.current;
    if (!engineRef.current) await requestCamera();
    if (captureGeneration !== captureGenerationRef.current) return;
    if (!engineRef.current) {
      setCalibrationState("error");
      setCalibrationMessage("Start the camera before recording a personal sign example.");
      return;
    }

    captureStateRef.current = "countdown";
    setCalibrationState("countdown");
    setCalibrationMessage(`Get ready to sign ${calibrationWord.text}.`);
    for (let value = 3; value >= 1; value -= 1) {
      setCountdown(value);
      await wait(700);
      if (!engineRef.current || captureGeneration !== captureGenerationRef.current) return;
    }

    captureFramesRef.current = [];
    captureStateRef.current = "recording";
    setCalibrationState("recording");
    setCalibrationMessage(`Signing ${calibrationWord.text}. Complete the full movement.`);
    await wait(3000);
    if (!engineRef.current || captureGeneration !== captureGenerationRef.current) return;

    captureStateRef.current = "saving";
    setCalibrationState("saving");
    const validFrames = calibrationFrames(captureFramesRef.current);
    if (!validFrames.length) {
      captureStateRef.current = "error";
      setCalibrationState("error");
      setCalibrationMessage("Not enough hand movement was visible. Keep your hands in frame and try again.");
      return;
    }

    const createdAt = Date.now();
    const template: CalibrationTemplate = {
      id: `${calibrationWord.gloss}-${createdAt}-${Math.random().toString(36).slice(2, 7)}`,
      language: selected,
      gloss: calibrationWord.gloss,
      text: calibrationWord.text,
      createdAt,
      normalization: "trajectory-v3",
      frames: prepareCalibrationSequence(validFrames, "trajectory-v3"),
    };

    try {
      await saveCalibrationTemplate(template);
      const updated = await loadCalibrationTemplates();
      setCalibrationTemplates(updated);
      if (captureGeneration !== captureGenerationRef.current) return;
      captureStateRef.current = "saved";
      setCalibrationState("saved");
      setCalibrationMessage(`${calibrationWord.text} is now active for ${model.shortName}. Record two or three examples for better consistency.`);
    } catch {
      if (captureGeneration !== captureGenerationRef.current) return;
      captureStateRef.current = "error";
      setCalibrationState("error");
      setCalibrationMessage("This browser could not save the example. Check private-browsing storage settings and try again.");
    }
  }, [calibrationWord, model.shortName, requestCamera, selected]);

  const selectCustomWord = () => {
    const customWord = createCustomVocabularyEntry(customWordInput);
    if (!customWord) {
      setCalibrationState("error");
      setCalibrationMessage("Type a word or short phrase first. Letters, numbers, spaces, apostrophes and hyphens are supported.");
      return;
    }

    captureGenerationRef.current++;
    setCalibrationWord(customWord);
    setCustomWordInput("");
    captureStateRef.current = "idle";
    setCalibrationState("idle");
    setCalibrationMessage(`${customWord.text} is selected for ${model.shortName}. Record two or three examples for the most reliable match.`);
  };

  const removeCalibration = useCallback(async (gloss: string) => {
    captureGenerationRef.current++;
    await deleteCalibrationGloss(gloss, selected);
    setCalibrationTemplates(await loadCalibrationTemplates());
    captureStateRef.current = "idle";
    setCalibrationState("idle");
    setCalibrationMessage("Personal examples removed for this word.");
  }, [selected]);

  const returnHome = () => {
    stopCamera();
    setStep("welcome");
  };

  const clearTranscript = () => {
    const saved = saveSession({
      id: String(sessionStartedRef.current),
      language: selected,
      createdAt: sessionStartedRef.current,
      entries,
    });
    if (!saved) { setStorageMessage("Could not save on this device. Your transcript has been kept here."); return; }
    window.speechSynthesis?.cancel();
    setStorageMessage("");
    setEditingId(null);
    setEntries([]);
    sessionStartedRef.current = Date.now();
    setHistory(loadHistory());
    setTranscriptMessage("Transcript saved to this device's history and cleared.");
  };

  // An edit that leaves no text removes the entry, so Speak and Copy never see blanks.
  const finishEditing = (id: string) => {
    setEditingId(null);
    setEntries((current) => current.flatMap((item) => item.id !== id ? [item] : item.text.trim() ? [{ ...item, text: item.text.trim() }] : []));
  };

  const removeEntry = (entry: TranscriptEntry) => {
    setEntries((current) => current.filter((item) => item.id !== entry.id));
    setTranscriptMessage(`Removed "${entry.text}".`);
    // The pressed button disappears; keep keyboard focus in the transcript.
    transcriptHeadingRef.current?.focus();
  };

  const copyTranscript = async () => {
    const text = entries.map((entry) => entry.text).join(" ");
    try {
      await navigator.clipboard.writeText(text);
      setTranscriptMessage("Transcript copied.");
    } catch {
      setTranscriptMessage("Copying is not available here. Select the transcript text to copy it.");
    }
  };

  const clearAllLocalData = async () => {
    window.speechSynthesis?.cancel();
    clearLocalSignRelayData();
    setEntries([]);
    setEditingId(null);
    setHistory([]);
    setSettings(DEFAULT_SETTINGS);
    sessionStartedRef.current = Date.now();
    try {
      await clearCalibrationTemplates();
      setCalibrationTemplates([]);
      setPrivacyMessage("Local transcripts, settings and personal signs were cleared from this browser.");
    } catch {
      // Keep showing what is still stored rather than pretending it was deleted.
      setPrivacyMessage("Transcripts and settings were cleared, but personal signs could not be deleted. Clear this site's data in your browser settings.");
    }
  };

  if (step === "workspace" && selected === "bdsl" && MODEL_ADAPTERS.bdsl.status === "experimental") {
    return (
      <div className="app-shell">
        <SiteHeader />
        <main>
          <div className="special-workspace-language-bar">
            <WorkspaceLanguageSwitcher selected={selected} onChange={changeWorkspaceLanguage} />
          </div>
          <BdslRecognizer onBack={returnHome} />
        </main>
      </div>
    );
  }
  if (step === "workspace" && selected === "rsl") {
    return (
      <div className="app-shell">
        <SiteHeader />
        <main>
          <div className="special-workspace-language-bar">
            <WorkspaceLanguageSwitcher selected={selected} onChange={changeWorkspaceLanguage} />
          </div>
          <RslRecognizer onBack={returnHome} />
        </main>
      </div>
    );
  }

  if (step === "workspace") {
    const capability = capabilityStatus(selected);
    const status = recognitionStatus({ camera: cameraState, unavailable: recognitionUnavailable,
      handsVisible: detection.hands, motionReason, candidate, bufferSize });
    return (
      <div className="app-shell">
        <SurfaceMotion scene={`workspace-${selected}`} cursor={false} />
        <SiteHeader />
        <main className="workspace-page">
          <div className="workspace-topbar">
            <button className="back-link" onClick={returnHome}>
              Change language
            </button>
            <div className="workspace-title">
              <span className="language-code compact">{model.shortName}</span>
              <div>
                <h1>Live sign recognition</h1>
                <p>{model.language}</p>
              </div>
            </div>
            <div className="workspace-topbar-actions">
              <WorkspaceLanguageSwitcher selected={selected} onChange={changeWorkspaceLanguage} />
              <span className="local-badge">On-device processing</span>
            </div>
          </div>

          <div className="honesty-banner" role="note">
            <span className="honesty-label">Model status</span>
            <p>{ASL_ONLY && <><strong>ASL demo build.</strong> Other language models are not included. </>}<strong>{capability.headline}</strong> {capability.evidence} Check every word before relying on it. <span className="language-note">{SIGN_LANGUAGE_NOTE}</span></p>
            <button className="text-action" onClick={() => {
              const panel = vocabularyRef.current;
              if (!panel) return;
              panel.open = true;
              panel.querySelector("summary")?.focus({ preventScroll: true });
              panel.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
            }}>Teach a sign</button>
          </div>

          <div className="translator-grid">
            <section className="camera-panel" aria-labelledby="camera-title">
              <div className="panel-heading">
                <div>
                  <h2 id="camera-title">Camera</h2>
                </div>
                <StatusBadge active={cameraState === "active"} label={cameraMessage} />
              </div>

              <div className="camera-stage">
                <video ref={videoRef} muted playsInline aria-label="Mirrored live camera preview" />
                <canvas ref={canvasRef} aria-hidden="true" />
                {cameraState !== "active" && (
                  <div className="camera-placeholder">
                    <span className={`camera-placeholder-label ${cameraState === "loading" || cameraState === "requesting" ? "loading" : ""}`}>Camera</span>
                    <h3>{cameraState === "loading" ? "Preparing your camera" : cameraState === "requesting" ? "Allow camera access" : cameraState === "idle" ? "Ready when you are" : "Camera unavailable"}</h3>
                    <p>{cameraMessage}</p>
                    {(cameraState === "denied" || cameraState === "error" || cameraState === "idle") && (
                      <button className="button secondary small" onClick={requestCamera}>
                        {cameraState === "idle" ? "Start camera" : "Retry camera"}
                      </button>
                    )}
                  </div>
                )}
                {cameraState === "active" && (
                  <div className="camera-guidance">Keep your hands, face and shoulders in frame.</div>
                )}
                {calibrationState !== "idle" && calibrationState !== "saved" && calibrationState !== "error" && (
                  <div className={`calibration-capture ${calibrationState}`} role="status" aria-live="assertive">
                    <span>{calibrationState === "countdown" ? countdown : calibrationState === "recording" ? "REC" : "···"}</span>
                    <strong>{calibrationState === "countdown" ? `Get ready: ${calibrationWord.text}` : calibrationState === "recording" ? `Sign ${calibrationWord.text}` : "Saving example"}</strong>
                  </div>
                )}
              </div>

              <details className="workspace-disclosure camera-options">
                <summary>Camera options</summary>
              <div className="detection-grid" aria-label="Vision detection status">
                <DetectionItem label="Camera" active={cameraState === "active"} />
                <DetectionItem label="Person" active={detection.person} />
                <DetectionItem label="Hands" active={detection.hands} />
                <DetectionItem label="Face" active={detection.face} />
                <DetectionItem label="Upper body" active={detection.pose} />
              </div>

              {perfMode && <p className="calibration-message perf-readout" data-perf>{perfReadout || "Collecting timings…"}</p>}
              {visionSource && <p className="calibration-message">Hand tracking loaded {visionSource === "self-hosted" ? "from this site, so it does not depend on an external CDN" : "from the public CDN fallback"}.</p>}
              <div className="camera-actions">
                <label className="switch-row">
                  <input
                    type="checkbox"
                    checked={settings.showOverlay}
                    onChange={(event) => setSettings((current) => ({ ...current, showOverlay: event.target.checked }))}
                  />
                  <span>Show landmarks</span>
                </label>
              </div>
              </details>
              {perfMode && perfWarning && <p className="calibration-message error" role="status" data-perf-warning>{perfWarning}</p>}
              <div className="camera-session-actions">
                <span>{cameraState === "active" ? "Camera on · video stays private" : "Video stays on this device"}</span>
                <button className="button ghost small" onClick={cameraState === "active" || cameraState === "requesting" || cameraState === "loading" ? stopCamera : requestCamera}>
                  {cameraState === "active" ? "Pause camera" : cameraState === "requesting" || cameraState === "loading" ? "Cancel" : "Start camera"}
                </button>
              </div>
            </section>

            <section className="transcript-panel" aria-labelledby="transcript-title">
              <div className="panel-heading">
                <div>
                  <h2 id="transcript-title" ref={transcriptHeadingRef} tabIndex={-1}>Transcript</h2>
                </div>
                <div className={`recognition-state ${status.tone}`} data-status={status.key} data-worker-state={recognitionState}>
                  <span /> {status.chip}
                </div>
              </div>

              <div className="candidate-bar">
                <div>
                  <span className="candidate-label">{status.key === "checking-sign" ? "Possible match · not confirmed" : "Current sequence"}</span>
                  <strong>{status.key === "checking-sign" ? candidate : status.detail}</strong>
                </div>
                <div className="confidence-ring" title="Match score, not a measured probability of correct translation" style={{ "--confidence": `${Math.round(confidence * 100)}%` } as React.CSSProperties}>
                  <span aria-label={`Match score ${Math.round(confidence * 100)} out of 100`}>{Math.round(confidence * 100)}</span>
                </div>
              </div>

              <p className="calibration-message">Match score out of 100. It is not measured translation accuracy.</p>
              {recognitionFeedback && <p className="calibration-message">{recognitionFeedback}</p>}
              <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
              <p className="sr-only" role="status" aria-live="polite">{cameraState === "active" ? "Camera on. Hand tracking is running." : cameraState === "idle" ? "Camera off." : cameraMessage}</p>
              {recognitionUnavailable && (
                <button className="button secondary small" onClick={() => workerRef.current?.restart()}>
                  Restart recognition
                </button>
              )}
              <div className="transcript-body" aria-label="Confirmed words">
                {!entries.length ? (
                  <div className="transcript-empty">
                    <h3>Your words, here.</h3>
                    <p>Complete each sign. Confident matches appear here.</p>
                  </div>
                ) : (
                  <div className="transcript-list">
                    {entries.map((entry) => (
                      <article className="transcript-entry" key={entry.id}>
                        <div className="entry-time">
                          {new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </div>
                        {editingId === entry.id ? (
                          <input
                            className="entry-editor"
                            maxLength={500}
                            value={entry.text}
                            autoFocus
                            onChange={(event) => setEntries((current) => current.map((item) => item.id === entry.id ? { ...item, text: event.target.value } : item))}
                            onBlur={() => finishEditing(entry.id)}
                            onKeyDown={(event) => event.key === "Enter" && finishEditing(entry.id)}
                            aria-label={`Edit ${entry.text}`}
                          />
                        ) : (
                          <p>{entry.text}</p>
                        )}
                        <div className="entry-actions">
                          <span>{Math.round(entry.confidence * 100)}/100 {entry.source === "starter" ? "rule match" : entry.source === "personal" ? "template match" : "match score"} · {entry.gloss}</span>
                          <button onClick={() => setEditingId(entry.id)} aria-label={`Edit ${entry.text}`}>Edit</button>
                          <button onClick={() => removeEntry(entry)} aria-label={`Remove ${entry.text}`}>Remove</button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>

              <div className="speech-controls">
                <label className="switch-row prominent">
                  <input
                    type="checkbox"
                    checked={settings.autoSpeak}
                    onChange={(event) => setSettings((current) => ({ ...current, autoSpeak: event.target.checked }))}
                  />
                  <span><strong>Auto speak</strong></span>
                </label>
                <div className="speech-buttons">
                  <button className="button secondary small" disabled={!entries.length} onClick={() => speak(entries.map((entry) => entry.text).join(" "))}>
                    Speak
                  </button>
                  <button className="button ghost small" onClick={() => window.speechSynthesis?.cancel()}>
                    Stop
                  </button>
                </div>
              </div>
              <details className="workspace-disclosure voice-options">
                <summary>Voice settings</summary>
                <div className="voice-ranges">
                <label className="range-control">
                  <span>Volume <strong>{Math.round(settings.volume * 100)}%</strong></span>
                  <input type="range" min="0" max="1" step="0.05" value={settings.volume} onChange={(event) => setSettings((current) => ({ ...current, volume: Number(event.target.value) }))} />
                </label>
                <label className="range-control">
                  <span>Rate <strong>{settings.rate.toFixed(2)}×</strong></span>
                  <input type="range" min="0.6" max="1.4" step="0.05" value={settings.rate} onChange={(event) => setSettings((current) => ({ ...current, rate: Number(event.target.value) }))} />
                </label>
                </div>
              </details>

              <div className="transcript-actions">
                <button className="button ghost small" onClick={() => setShowHistory((current) => !current)}>
                  History ({history.length})
                </button>
                <button className="button ghost small" disabled={!entries.length} onClick={() => void copyTranscript()}>
                  Copy
                </button>
                <button className="button danger small" disabled={!entries.length} onClick={clearTranscript}>
                  Save & clear
                </button>
              </div>
              {transcriptMessage && <p className="calibration-message" role="status">{transcriptMessage}</p>}

              {storageMessage && <p className="calibration-message" role="status">{storageMessage}</p>}
              {showHistory && (
                <div className="history-drawer">
                  <div className="history-heading"><strong>Local history</strong><button onClick={() => setShowHistory(false)} aria-label="Close history">Close</button></div>
                  {!history.length ? <p>No saved sessions on this device.</p> : history.map((session) => (
                    <div className="history-session" key={session.id}>
                      <span>{new Date(session.createdAt).toLocaleString()}</span>
                      <p>{session.entries.map((entry) => entry.text).join(" ")}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <details className="calibration-panel workspace-disclosure vocabulary-disclosure" id="personal-vocabulary" ref={vocabularyRef}>
            <summary><span>Personal vocabulary <small>{activeCustomCount} signs taught</small></span></summary>
            <div className="calibration-heading">
              <div>
                <h2 id="calibration-title">Teach a {model.shortName} sign</h2>
                <p>Choose a word, then record its complete sign two or three times. Examples stay on this device.</p>
              </div>
              <div className="calibration-progress" aria-label={`${activeCustomCount} personal words active`}>
                <strong>{activeCustomCount}</strong><span> personal</span>
              </div>
            </div>

            <div className="calibration-controls">
              <div className="selected-word-card">
                <div>
                  <span>Selected word</span>
                  <strong>{calibrationWord.text}</strong>
                  <small>{calibrationCounts.get(calibrationWord.gloss) ?? 0} of 3 examples recorded</small>
                </div>
                <div className="selected-word-actions">
                  <button className="button primary small" onClick={() => void recordCalibration()} disabled={calibrationState === "countdown" || calibrationState === "recording" || calibrationState === "saving"}>
                    {cameraState === "active" ? "Record example" : "Start camera & record"}
                  </button>
                  {trainedGlosses.has(calibrationWord.gloss) && (
                    <button className="button ghost small" onClick={() => void removeCalibration(calibrationWord.gloss)}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="custom-word-controls">
              <div>
                <span className="custom-word-label">Type a word, then sign it</span>
                <p>Type what you want SignRelay to say, select it, then record yourself signing it.</p>
              </div>
              <div className="custom-word-input">
                <input
                  value={customWordInput}
                  maxLength={48}
                  onChange={(event) => setCustomWordInput(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && selectCustomWord()}
                  placeholder="e.g. Pizza"
                  aria-label="Word or short phrase to teach"
                />
                <button className="button secondary small" onClick={selectCustomWord} disabled={!customWordInput.trim()}>
                  Select word
                </button>
              </div>
            </div>

            {selected !== "asl" && (
              <div className="custom-word-controls starter-library-search">
                <div>
                  <span className="custom-word-label">Search the {model.vocabulary.length.toLocaleString()} built-in concepts</span>
                  <p>Choose a concept first, then record two or three examples of the sign you use for it.</p>
                </div>
                <div className="custom-word-input">
                  <input
                    value={vocabularySearch}
                    onChange={(event) => setVocabularySearch(event.target.value)}
                    placeholder="Search, e.g. doctor, travel, happy"
                    aria-label={`Search built-in ${model.shortName} concepts`}
                  />
                </div>
              </div>
            )}

            <p className={`calibration-message ${calibrationState}`} role="status">{calibrationMessage}</p>
            <div className="vocabulary-grid" aria-label={`Personal ${model.shortName} vocabulary`}>
              {visibleCalibrationVocabulary.map((word) => {
                const exampleCount = calibrationCounts.get(word.gloss) ?? 0;
                return (
                  <button
                    key={word.gloss}
                    className={`${calibrationWord.gloss === word.gloss ? "selected" : ""} ${exampleCount ? "trained" : ""}`}
                    onClick={() => {
                      captureGenerationRef.current++;
                      setCalibrationWord(word);
                      captureStateRef.current = "idle";
                      setCalibrationState("idle");
                      setCalibrationMessage(exampleCount ? `${word.text} is active. Add another example to improve consistency.` : `Record ${word.text} to activate it in your personal recognizer.`);
                    }}
                  >
                    <span>{word.text}</span>
                    <small>{exampleCount ? `${exampleCount} example${exampleCount === 1 ? "" : "s"}` : word.category}</small>
                    {exampleCount > 0 && <span className="vocabulary-trained-label">Taught</span>}
                  </button>
                );
              })}
            </div>
            {filteredCalibrationVocabulary.length > visibleCalibrationVocabulary.length && (
              <p className="calibration-message">Showing {visibleCalibrationVocabulary.length} of {filteredCalibrationVocabulary.length.toLocaleString()} words. Search to narrow the library.</p>
            )}
          </details>

          <details className="workspace-disclosure privacy-disclosure">
            <summary>Privacy &amp; model details</summary>
            <p className="model-detail-copy">{model.status === "experimental" ? `${model.automaticVocabularyCount.toLocaleString()} automatic ${model.shortName} test signs · ${model.version}. This is an isolated-sign research model, not a validated continuous sign-language interpreter.` : model.status === "preparing" ? `No shared automatic ${model.shortName} model is installed. Recognition uses only the private signs you teach.` : `${model.vocabulary.length.toLocaleString()} ${model.shortName} starter labels are available to teach. Labels are not pre-trained translations.`} Personal examples store normalised landmarks, never camera video.</p>
          <section className="privacy-strip" aria-labelledby="privacy-heading">
            <div>
              <h2 id="privacy-heading">Your camera stays private</h2>
              <p>Frames are analysed in this browser. Raw video is not uploaded or stored. Settings and saved transcripts stay in local browser storage.</p>
            </div>
            <button className="button ghost small" onClick={() => void clearAllLocalData()}>Clear local data</button>
          </section>
          {privacyMessage && <p className="calibration-message" role="status">{privacyMessage}</p>}
          </details>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <SiteHeader />
      <main>
        {storageMessage && <p className="calibration-message" role="alert">{storageMessage}</p>}
        <FigmaMakeLanding
          selected={selected}
          onSelect={selectLanguage}
          onStart={beginTranslation}
        />
      </main>
      <SiteFooter />
    </div>
  );
}

function WorkspaceLanguageSwitcher({
  selected,
  onChange,
}: {
  selected: LanguageId;
  onChange: (language: LanguageId) => void;
}) {
  const automatic = LANGUAGE_LIST.filter((language) => language.status === "experimental");
  const development = LANGUAGE_LIST.filter((language) => language.status !== "experimental");

  return (
    <label className="workspace-language-switcher">
      <span>Language</span>
      <div className="workspace-language-select">
        <select
          value={selected}
          onChange={(event) => onChange(event.target.value as LanguageId)}
          aria-label="Change sign language"
        >
          <optgroup label="Research models · live accuracy not measured">
            {automatic.map((language) => (
              <option key={language.id} value={language.id} disabled={!isLanguageAvailable(language.id)}>
                {language.shortName} · {language.language}{isLanguageAvailable(language.id) ? "" : ` (${OUT_OF_PROFILE_LABEL.toLowerCase()})`}
              </option>
            ))}
          </optgroup>
          <optgroup label="Teach your own signs · no automatic model">
            {development.map((language) => (
              <option key={language.id} value={language.id} disabled={!isLanguageAvailable(language.id)}>
                {language.shortName} · {language.language}{isLanguageAvailable(language.id) ? "" : ` (${OUT_OF_PROFILE_LABEL.toLowerCase()})`}
              </option>
            ))}
          </optgroup>
        </select>
      </div>
    </label>
  );
}

function StatusBadge({ active, label }: { active: boolean; label: string }) {
  return <span className={`status-badge ${active ? "active" : ""}`} title={label}><span />{active ? "Active" : label}</span>;
}

function DetectionItem({ label, active }: { label: string; active: boolean }) {
  return <div className={`detection-item ${active ? "active" : ""}`}><span>{label}</span><strong>{active ? "Detected" : "Waiting"}</strong></div>;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
