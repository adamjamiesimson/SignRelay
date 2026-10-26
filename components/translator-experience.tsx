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
  ArrowLeft, BookPlus, Camera, CameraOff, ChevronDown, CircleHelp, Copy, History, Info, LockKeyhole, Pencil,
  RotateCcw, Save, Square, Trash2, Volume2, X,
} from "lucide-react";
import {
  DEFAULT_SETTINGS,
  clearLocalSignRelayData,
  loadHistory,
  loadSettings,
  onboardingState,
  saveOnboarding,
  saveSession,
  saveSettings,
  type OnboardingStatus,
  type SpeechSettings,
  type TranscriptEntry,
  type TranscriptSession,
} from "@/lib/browser-storage";
import {
  clearCalibrationTemplates,
  deleteCalibrationGloss,
  loadCalibrationTemplates,
  saveCalibrationTemplateAndReload,
} from "@/lib/calibration-storage";
import {
  createCustomVocabularyEntry,
  isLanguageId,
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
import { Landing } from "./landing";
import { OnboardingTour } from "./onboarding-tour";

type Step = "welcome" | "workspace";
type CameraState = "idle" | "requesting" | "loading" | "active" | "denied" | "error";
type RecognitionState = "listening" | "processing" | "uncertain";
type CalibrationState = "idle" | "countdown" | "recording" | "saving" | "saved" | "error";

/** Personal-vocabulary words listed before a search narrows them. */
const LISTED_WORDS = 80;

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
  const [tourOpen, setTourOpen] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const vocabularyRef = useRef<HTMLDetailsElement>(null);
  const transcriptHeadingRef = useRef<HTMLHeadingElement>(null);
  const cameraButtonRef = useRef<HTMLButtonElement>(null);
  const urlEntryRef = useRef<() => void>(() => {});
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
  const cameraRequestRef = useRef<Promise<void> | null>(null);
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
    return matches.slice(0, search ? 200 : LISTED_WORDS);
  }, [filteredCalibrationVocabulary, vocabularySearch]);
  // ASL has no built-in concept library, but more than LISTED_WORDS taught
  // signs still need the search to reach the older ones (and to clear it).
  const showVocabularySearch = selected !== "asl" || filteredCalibrationVocabulary.length > LISTED_WORDS || vocabularySearch !== "";

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = loadSettings();
      settingsRef.current = stored;
      setSettings(stored);
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

  // Persist only a change the person made. Saving from an effect on `settings`
  // wrote the defaults over the stored preferences on every page load, before
  // they were read, and re-created the record right after Clear local data.
  const updateSettings = useCallback((patch: Partial<SpeechSettings>) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    saveSettings(next);
  }, []);

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

  const openCamera = useCallback(async () => {
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

  // A second caller (e.g. Record while the camera is still starting) waits for
  // the request already in progress instead of seeing the camera as off.
  const requestCamera = useCallback(() => {
    if (cameraPendingRef.current && cameraRequestRef.current) return cameraRequestRef.current;
    const request = openCamera();
    cameraRequestRef.current = request;
    return request;
  }, [openCamera]);

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

  const enterWorkspace = ({ startCamera, tour = false, language = selected }: { startCamera: boolean; tour?: boolean; language?: LanguageId }) => {
    if (!entries.length) sessionStartedRef.current = Date.now();
    const generation = ++cameraGenerationRef.current;
    setStep("workspace");
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    // RSL and Bangla use their own clip-capture components and cameras.
    if (language === "rsl" || language === "bdsl") return;
    // A first visit opens the tour instead; nothing starts the camera behind it.
    if (tour || onboardingState() === "due") { setTourOpen(true); return; }
    if (!startCamera) return;
    window.setTimeout(() => {
      if (generation === cameraGenerationRef.current) void requestCamera();
    }, 0);
  };
  const beginTranslation = () => enterWorkspace({ startCamera: true });

  const closeTour = (status: OnboardingStatus) => {
    saveOnboarding(status);
    setTourOpen(false);
    // The control that opened the tour may be gone; continue where signing starts.
    window.setTimeout(() => cameraButtonRef.current?.focus(), 0);
  };

  // Links into the translator: /#translator, /#tour (from "Take a tour") and
  // ?lang=<id> (from the languages page). The URL is tidied afterwards so a
  // repeated click fires again; other parameters such as ?perf are kept.
  useEffect(() => {
    urlEntryRef.current = () => {
      const url = new URL(window.location.href);
      const requested = url.searchParams.get("lang");
      const hash = url.hash;
      if (!requested && hash !== "#translator" && hash !== "#tour") return;
      url.searchParams.delete("lang");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
      let language: LanguageId = isLanguageId(requested) && isLanguageAvailable(requested) ? requested : selected;
      // The tour points at the live workspace, which RSL and Bangla do not use.
      if (hash === "#tour" && (language === "rsl" || language === "bdsl")) language = "asl";
      if (language !== selected && !selectLanguage(language)) return;
      enterWorkspace({ startCamera: false, tour: hash === "#tour", language });
    };
  });
  useEffect(() => {
    const open = () => urlEntryRef.current();
    const timer = window.setTimeout(open, 0);
    window.addEventListener("hashchange", open);
    return () => { window.clearTimeout(timer); window.removeEventListener("hashchange", open); };
  }, []);

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
      const { templates: updated } = await saveCalibrationTemplateAndReload(template);
      if (updated) setCalibrationTemplates(updated);
      if (captureGeneration !== captureGenerationRef.current) return;
      captureStateRef.current = "saved";
      setCalibrationState("saved");
      // A failed re-read after a committed save is not a failed save.
      setCalibrationMessage(updated
        ? `${calibrationWord.text} is now active for ${model.shortName}. Record two or three examples for better consistency.`
        : `${calibrationWord.text} was saved on this device, but the list of saved signs could not be refreshed. Reload the page to start using it.`);
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
    captureStateRef.current = "idle";
    setCalibrationState("idle");
    try {
      await deleteCalibrationGloss(gloss, selected);
    } catch {
      // Show what is still stored rather than pretending it was deleted.
      await loadCalibrationTemplates().then(setCalibrationTemplates, () => {});
      captureStateRef.current = "error";
      setCalibrationState("error");
      setCalibrationMessage("These examples could not be removed from this browser. Try again, or clear this site's data in your browser settings.");
      return;
    }
    // The deletion committed. If the list cannot be re-read, drop exactly what was deleted.
    const stored = await loadCalibrationTemplates().catch(() => null);
    setCalibrationTemplates(current => stored ?? current.filter(template =>
      template.gloss !== gloss || (template.language ?? "asl") !== selected));
    setCalibrationMessage("Personal examples removed for this word.");
  }, [selected]);

  const returnHome = () => {
    stopCamera();
    setTourOpen(false);
    setStep("welcome");
  };

  const openVocabulary = () => {
    const panel = vocabularyRef.current;
    if (!panel) return;
    panel.open = true;
    panel.querySelector("summary")?.focus({ preventScroll: true });
    panel.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
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
  const finishEditing = (id: string, { restoreFocus = false } = {}) => {
    setEditingId(null);
    setEntries((current) => current.flatMap((item) => item.id !== id ? [item] : item.text.trim() ? [{ ...item, text: item.text.trim() }] : []));
    // Enter removes the editor; keep the keyboard on this entry (or the
    // transcript heading if the edit removed it) instead of the page body.
    if (restoreFocus) window.setTimeout(() => {
      const entry = [...document.querySelectorAll<HTMLElement>("[data-entry-id]")].find(element => element.dataset.entryId === id);
      (entry?.querySelector<HTMLElement>("[data-edit]") ?? transcriptHeadingRef.current)?.focus();
    }, 0);
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
    // An example being recorded now must not be saved after everything was cleared.
    captureGenerationRef.current++;
    captureStateRef.current = "idle";
    captureFramesRef.current = [];
    setCalibrationState("idle");
    const localCleared = clearLocalSignRelayData();
    setEntries([]);
    setEditingId(null);
    setHistory([]);
    settingsRef.current = DEFAULT_SETTINGS;
    setSettings(DEFAULT_SETTINGS);
    sessionStartedRef.current = Date.now();
    try {
      await clearCalibrationTemplates();
      // Reflect storage, not an assumption: a save already committing finishes before the clear.
      setCalibrationTemplates(await loadCalibrationTemplates().catch(() => []));
      setPrivacyMessage(localCleared
        ? "Transcripts, settings, personal signs and tour progress were cleared from this browser."
        : "Personal signs were cleared, but saved transcripts and settings could not be removed from browser storage. Clear this site's data in your browser settings.");
    } catch {
      // Keep showing what is still stored rather than pretending it was deleted.
      setPrivacyMessage(localCleared
        ? "Transcripts and settings were cleared, but personal signs could not be deleted. Clear this site's data in your browser settings."
        : "Nothing could be removed from browser storage. Clear this site's data in your browser settings.");
    }
  };

  if (step === "workspace" && (selected === "rsl" || (selected === "bdsl" && MODEL_ADAPTERS.bdsl.status === "experimental"))) {
    return (
      <div className="app-shell">
        <SiteHeader />
        <main className="workspace-page clip-workspace" id="main">
          <div className="special-workspace-language-bar">
            <WorkspaceLanguageSwitcher selected={selected} onChange={changeWorkspaceLanguage} />
          </div>
          {selected === "rsl" ? <RslRecognizer onBack={returnHome} /> : <BdslRecognizer onBack={returnHome} />}
        </main>
        <SiteFooter />
      </div>
    );
  }

  if (step === "workspace") {
    const capability = capabilityStatus(selected);
    const status = recognitionStatus({ camera: cameraState, unavailable: recognitionUnavailable,
      handsVisible: detection.hands, motionReason, candidate, bufferSize });
    const cameraBusy = cameraState === "requesting" || cameraState === "loading";
    const examples = calibrationCounts.get(calibrationWord.gloss) ?? 0;
    return (
      <div className="app-shell">
        <SiteHeader />
        <main className="workspace-page" id="main">
          <div className="workspace-topbar">
            <button type="button" className="back-link" onClick={returnHome}>
              <ArrowLeft aria-hidden="true" size={16} />Change language
            </button>
            <div className="workspace-title">
              <span className="language-code">{model.shortName}</span>
              <div>
                <h1>Live sign recognition</h1>
                <p>{model.language}</p>
              </div>
            </div>
            <div className="workspace-topbar-actions">
              <WorkspaceLanguageSwitcher selected={selected} onChange={changeWorkspaceLanguage} />
              <button type="button" className="button ghost small" onClick={() => setTourOpen(true)}>
                <CircleHelp aria-hidden="true" size={16} />Take a tour
              </button>
            </div>
          </div>

          <div className="honesty-banner" role="note">
            <Info aria-hidden="true" size={18} />
            <div>
              <p>{ASL_ONLY && <span className="tag">ASL demo build · </span>}<strong>Research preview.</strong> Check every result.</p>
              <details>
                <summary>What this means <ChevronDown aria-hidden="true" size={14} /></summary>
                <p>{ASL_ONLY && "Other language models are not included in this build. "}<strong>{capability.headline}</strong> {capability.evidence} <span className="language-note">{SIGN_LANGUAGE_NOTE}</span></p>
              </details>
            </div>
          </div>

          <div className="translator-grid">
            <section className="camera-panel" aria-labelledby="camera-title" data-tour="camera">
              <div className="panel-heading">
                <h2 id="camera-title">Camera</h2>
                <StatusBadge active={cameraState === "active"} label={cameraMessage} />
              </div>

              <div className="camera-stage">
                <video ref={videoRef} muted playsInline aria-label="Mirrored live camera preview" />
                <canvas ref={canvasRef} aria-hidden="true" />
                {cameraState !== "active" && (
                  <div className={`camera-placeholder ${cameraState}`}>
                    <span className="camera-placeholder-icon" aria-hidden="true">
                      {cameraState === "denied" || cameraState === "error" ? <CameraOff size={22} /> : <Camera size={22} />}
                    </span>
                    <h3>{cameraState === "loading" ? "Preparing hand tracking" : cameraState === "requesting" ? "Allow camera access" : cameraState === "idle" ? "Camera is off" : "Camera unavailable"}</h3>
                    <p>{cameraState === "idle" ? "Video stays on this device." : cameraMessage}</p>
                    {(cameraState === "denied" || cameraState === "error") && (
                      <button type="button" className="button secondary small" onClick={() => void requestCamera()}>
                        Retry camera
                      </button>
                    )}
                  </div>
                )}
                                {calibrationState !== "idle" && calibrationState !== "saved" && calibrationState !== "error" && (
                  <div className={`calibration-capture ${calibrationState}`} role="status" aria-live="assertive">
                    <span>{calibrationState === "countdown" ? countdown : calibrationState === "recording" ? "REC" : "···"}</span>
                    <strong>{calibrationState === "countdown" ? `Get ready: ${calibrationWord.text}` : calibrationState === "recording" ? `Sign ${calibrationWord.text}` : "Saving example"}</strong>
                  </div>
                )}
              </div>

              <div className="camera-session-actions">
                <button type="button" ref={cameraButtonRef} className={`button ${cameraState === "active" || cameraBusy ? "secondary" : "primary"}`}
                  onClick={cameraState === "active" || cameraBusy ? stopCamera : () => void requestCamera()}>
                  {cameraState === "active" ? "Pause camera" : cameraBusy ? "Cancel" : "Start camera"}
                </button>
              </div>
              {perfMode && perfWarning && <p className="calibration-message error" role="status" data-perf-warning>{perfWarning}</p>}

              <details className="workspace-disclosure camera-options">
                <summary>Camera options <ChevronDown aria-hidden="true" size={16} /></summary>
                <div className="disclosure-body">
                  <label className="switch-row">
                    <input type="checkbox" checked={settings.showOverlay} onChange={(event) => updateSettings({ showOverlay: event.target.checked })} />
                    <span>Show hand landmarks on the preview</span>
                  </label>
                  <div className="detection-grid" aria-label="Vision detection status">
                    <DetectionItem label="Camera" active={cameraState === "active"} />
                    <DetectionItem label="Person" active={detection.person} />
                    <DetectionItem label="Hands" active={detection.hands} />
                    <DetectionItem label="Face" active={detection.face} />
                    <DetectionItem label="Upper body" active={detection.pose} />
                  </div>
                  {visionSource && <p className="calibration-message">Hand tracking loaded {visionSource === "self-hosted" ? "from this site, so it does not depend on an external CDN" : "from the public CDN fallback"}.</p>}
                  {perfMode && <p className="calibration-message perf-readout" data-perf>{perfReadout || "Collecting timings…"}</p>}
                </div>
              </details>
            </section>

            <section className="transcript-panel" aria-labelledby="transcript-title" data-tour="transcript">
              <div className="panel-heading">
                <h2 id="transcript-title" ref={transcriptHeadingRef} tabIndex={-1}>Transcript</h2>
                <div className={`recognition-state ${status.tone}`} data-status={status.key} data-worker-state={recognitionState}>
                  <span aria-hidden="true" /> {status.chip}
                </div>
              </div>

              <div className="candidate-bar">
                {status.key === "checking-sign" && <span className="candidate-label">Possible match · not confirmed</span>}
                <strong>{status.key === "checking-sign" ? candidate : status.detail}</strong>
              </div>
              {recognitionFeedback && <p className="calibration-message">{recognitionFeedback}</p>}
              <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
              <p className="sr-only" role="status" aria-live="polite">{cameraState === "active" ? "Camera on. Hand tracking is running." : cameraState === "idle" ? "Camera off." : cameraMessage}</p>
              {recognitionUnavailable && (
                <button type="button" className="button secondary small" onClick={() => workerRef.current?.restart()}>
                  <RotateCcw aria-hidden="true" size={16} />Restart recognition
                </button>
              )}
              <div className="transcript-body" aria-label="Confirmed words">
                {!entries.length ? (
                  <div className="transcript-empty">
                    <h3>Confirmed words appear here</h3>
                    <button type="button" className="text-action" onClick={openVocabulary}><BookPlus aria-hidden="true" size={16} />Teach a sign</button>
                  </div>
                ) : (
                  <ol className="transcript-list">
                    {entries.map((entry) => (
                      <li className="transcript-entry" key={entry.id} data-entry-id={entry.id}>
                        {editingId === entry.id ? (
                          <input
                            className="entry-editor"
                            maxLength={500}
                            value={entry.text}
                            autoFocus
                            onChange={(event) => setEntries((current) => current.map((item) => item.id === entry.id ? { ...item, text: event.target.value } : item))}
                            onBlur={() => finishEditing(entry.id)}
                            onKeyDown={(event) => event.key === "Enter" && finishEditing(entry.id, { restoreFocus: true })}
                            aria-label={`Edit ${entry.text}`}
                          />
                        ) : (
                          <p>{entry.text}</p>
                        )}
                        <div className="entry-actions">
                          <button type="button" className="icon-button" data-edit onClick={() => setEditingId(entry.id)} aria-label={`Edit ${entry.text}`} title="Edit"><Pencil aria-hidden="true" size={16} /></button>
                          <button type="button" className="icon-button" onClick={() => removeEntry(entry)} aria-label={`Remove ${entry.text}`} title="Remove"><X aria-hidden="true" size={16} /></button>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              <div className="speech-controls">
                <label className="switch-row prominent">
                  <input type="checkbox" checked={settings.autoSpeak} onChange={(event) => updateSettings({ autoSpeak: event.target.checked })} />
                  <span>Speak each word</span>
                </label>
                <div className="speech-buttons">
                  <button type="button" className="button secondary small" disabled={!entries.length} onClick={() => {
                    // Without the Web Speech API the button would otherwise do nothing at all.
                    if (!("speechSynthesis" in window)) { setTranscriptMessage("Speech output is not available in this browser. The transcript can still be read or copied."); return; }
                    speak(entries.map((entry) => entry.text).join(" "));
                  }}>
                    <Volume2 aria-hidden="true" size={16} />Speak
                  </button>
                  <button type="button" className="button ghost small" onClick={() => window.speechSynthesis?.cancel()}>
                    <Square aria-hidden="true" size={14} />Stop
                  </button>
                </div>
              </div>

              <div className="transcript-actions">
                <button type="button" className="button ghost small" disabled={!entries.length} onClick={() => void copyTranscript()}>
                  <Copy aria-hidden="true" size={16} />Copy
                </button>
                <button type="button" className="button ghost small" disabled={!entries.length} onClick={clearTranscript}>
                  <Save aria-hidden="true" size={16} />Save &amp; clear
                </button>
                <button type="button" className="button ghost small" aria-expanded={showHistory} aria-controls="transcript-history" onClick={() => setShowHistory((current) => !current)}>
                  <History aria-hidden="true" size={16} />History ({history.length})
                </button>
              </div>
              {transcriptMessage && <p className="calibration-message" role="status">{transcriptMessage}</p>}
              {storageMessage && <p className="calibration-message" role="status">{storageMessage}</p>}
              {showHistory && (
                <div className="history-drawer" id="transcript-history">
                  <div className="history-heading"><strong>Saved on this device</strong><button type="button" className="icon-button" onClick={() => setShowHistory(false)} aria-label="Close history"><X aria-hidden="true" size={16} /></button></div>
                  {!history.length ? <p>No saved transcripts yet. Save &amp; clear keeps the last eight here.</p> : history.map((session) => (
                    <div className="history-session" key={session.id}>
                      <span>{new Date(session.createdAt).toLocaleString()} · {MODEL_ADAPTERS[session.language].shortName}</span>
                      <p>{session.entries.map((entry) => entry.text).join(" ")}</p>
                    </div>
                  ))}
                </div>
              )}

              <details className="workspace-disclosure voice-options">
                <summary>Voice settings <ChevronDown aria-hidden="true" size={16} /></summary>
                <div className="voice-ranges">
                  <label className="range-control">
                    <span>Volume <strong>{Math.round(settings.volume * 100)}%</strong></span>
                    <input type="range" min="0" max="1" step="0.05" value={settings.volume} onChange={(event) => updateSettings({ volume: Number(event.target.value) })} />
                  </label>
                  <label className="range-control">
                    <span>Rate <strong>{settings.rate.toFixed(2)}×</strong></span>
                    <input type="range" min="0.6" max="1.4" step="0.05" value={settings.rate} onChange={(event) => updateSettings({ rate: Number(event.target.value) })} />
                  </label>
                  <p className="field-hint">Speech uses your browser or device voices. Some voices are online services that receive the text spoken.</p>
                </div>
              </details>
            </section>
          </div>

          <div className="workspace-secondary" data-tour="teach">
            <details className="calibration-panel workspace-disclosure vocabulary-disclosure" id="personal-vocabulary" ref={vocabularyRef} data-taught={trainedGlosses.size}>
              <summary>
                <span className="summary-title"><BookPlus aria-hidden="true" size={18} />Personal signs</span>
                <ChevronDown aria-hidden="true" size={16} />
              </summary>
              <div className="calibration-body">
                <div className="calibration-heading">
                  <h2 id="calibration-title">Teach a {model.shortName} sign</h2>
                  <p>Choose a word and record it two or three times. Video is not saved.</p>
                </div>

                <ol className="teach-steps">
                  <li className="teach-step">
                    <span className="teach-step-number" aria-hidden="true">1</span>
                    <div className="custom-word-controls">
                      <span className="custom-word-label">Choose a word</span>
                      <div className="custom-word-input">
                        <input
                          value={customWordInput}
                          maxLength={48}
                          onChange={(event) => setCustomWordInput(event.target.value)}
                          onKeyDown={(event) => event.key === "Enter" && selectCustomWord()}
                          placeholder="Type a word, e.g. Pizza"
                          aria-label="Word or short phrase to teach"
                        />
                        <button type="button" className="button secondary small" onClick={selectCustomWord} disabled={!customWordInput.trim()}>
                          Select word
                        </button>
                      </div>
                    </div>
                  </li>
                  <li className="teach-step">
                    <span className="teach-step-number" aria-hidden="true">2</span>
                    <div className="selected-word-card">
                      <div>
                        <strong>{calibrationWord.text}</strong>
                        <small>{examples} of 3 examples recorded</small>
                        <span className="example-meter" aria-hidden="true">{[0, 1, 2].map(i => <i key={i} className={i < examples ? "filled" : ""} />)}</span>
                      </div>
                      <div className="selected-word-actions">
                        <button type="button" className="button primary small" onClick={() => void recordCalibration()} disabled={calibrationState === "countdown" || calibrationState === "recording" || calibrationState === "saving"}>
                          {cameraState === "active" ? "Record example" : "Start camera & record"}
                        </button>
                        {trainedGlosses.has(calibrationWord.gloss) && (
                          <button type="button" className="button ghost small" onClick={() => void removeCalibration(calibrationWord.gloss)}>
                            <Trash2 aria-hidden="true" size={16} />Remove
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                </ol>
                <p className={`calibration-message ${calibrationState}`} role="status">{calibrationMessage}</p>

                <div className="vocabulary-section">
                  <div className="vocabulary-section-heading">
                    <h3>{selected === "asl" ? "Your signs" : `Your signs and ${model.shortName} concepts`}</h3>
                  </div>
                  {showVocabularySearch && (
                    <div className="custom-word-controls starter-library-search">
                      <label className="search-field">
                        <span className="sr-only">{selected === "asl" ? "Search taught ASL signs" : `Search built-in ${model.shortName} concepts`}</span>
                        <input
                          type="search"
                          value={vocabularySearch}
                          onChange={(event) => setVocabularySearch(event.target.value)}
                          placeholder={selected === "asl" ? `Search your ${filteredCalibrationVocabulary.length.toLocaleString()} taught signs` : `Search ${model.vocabulary.length.toLocaleString()} concepts, e.g. doctor`}
                          aria-label={selected === "asl" ? "Search taught ASL signs" : `Search built-in ${model.shortName} concepts`}
                        />
                      </label>
                    </div>
                  )}
                  {visibleCalibrationVocabulary.length ? (
                    <div className="vocabulary-grid" aria-label={`Personal ${model.shortName} vocabulary`}>
                      {visibleCalibrationVocabulary.map((word) => {
                        const exampleCount = calibrationCounts.get(word.gloss) ?? 0;
                        return (
                          <button
                            type="button"
                            key={word.gloss}
                            aria-pressed={calibrationWord.gloss === word.gloss}
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
                            {exampleCount > 0 && <span className="vocabulary-trained-label">Taught</span>}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="empty-state">{vocabularySearch ? "No sign matches that search." : "No signs taught yet. Choose a word above and record it."}</p>
                  )}
                  {filteredCalibrationVocabulary.length > visibleCalibrationVocabulary.length && (
                    <p className="calibration-message">Showing {visibleCalibrationVocabulary.length} of {filteredCalibrationVocabulary.length.toLocaleString()} words. Search to narrow the library.</p>
                  )}
                </div>
              </div>
            </details>

            <details className="workspace-disclosure privacy-disclosure">
              <summary>
                <span className="summary-title"><LockKeyhole aria-hidden="true" size={18} />Privacy &amp; data</span>
                <ChevronDown aria-hidden="true" size={16} />
              </summary>
              <div className="disclosure-body">
                <section className="privacy-strip" aria-labelledby="privacy-heading">
                  <div>
                    <h2 id="privacy-heading">Your camera stays private</h2>
                    <p>Frames are analysed in this browser; video is never uploaded or stored. Transcripts, settings, personal signs and tour progress stay in this browser until you clear them.</p>
                  </div>
                  <button type="button" className="button danger small" onClick={() => void clearAllLocalData()}>Clear local data</button>
                </section>
                {privacyMessage && <p className="calibration-message" role="status">{privacyMessage}</p>}
                <p className="model-detail-copy">{model.status === "experimental" ? `${model.automaticVocabularyCount.toLocaleString()} automatic ${model.shortName} test signs · ${model.version}. This is an isolated-sign research model, not a validated continuous sign-language interpreter.` : model.status === "preparing" ? `No shared automatic ${model.shortName} model is installed. Recognition uses only the private signs you teach.` : `${model.vocabulary.length.toLocaleString()} ${model.shortName} starter labels are available to teach. Labels are not pre-trained translations.`} Personal examples store normalised landmarks, never camera video.</p>
              </div>
            </details>
          </div>
        </main>
        <SiteFooter />
        <OnboardingTour open={tourOpen} onClose={closeTour} />
      </div>
    );
  }

  return (
    <div className="app-shell home-shell">
      <SiteHeader />
      <main id="main">
        {storageMessage && <p className="notice error page-notice" role="alert">{storageMessage}</p>}
        <Landing
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
    <label className="workspace-language-switcher" data-tour="language">
      <span className="sr-only">Sign language</span>
      <span className="workspace-language-select">
        <select
          value={selected}
          onChange={(event) => onChange(event.target.value as LanguageId)}
          aria-label="Change sign language"
        >
          <optgroup label="Automatic recognition · experimental">
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
        <ChevronDown aria-hidden="true" size={16} />
      </span>
    </label>
  );
}

function StatusBadge({ active, label }: { active: boolean; label: string }) {
  return <span className={`status-badge ${active ? "active" : ""}`} title={label}><span aria-hidden="true" />{active ? "Active" : label}</span>;
}

function DetectionItem({ label, active }: { label: string; active: boolean }) {
  return <div className={`detection-item ${active ? "active" : ""}`}><span>{label}</span><strong>{active ? "Detected" : "Waiting"}</strong></div>;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
