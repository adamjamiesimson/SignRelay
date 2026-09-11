"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CameraOff,
  Check,
  ChevronDown,
  Clock3,
  Edit3,
  Eye,
  Hand,
  History,
  Mic2,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
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
  PERSONAL_STARTER_VOCABULARY,
  type AslVocabularyEntry,
  type LanguageId,
} from "@/lib/model-adapters";
import { isRecentDuplicate } from "@/lib/decoder";
import { calibrationFrames, prepareCalibrationSequence } from "@/lib/personalized-recognition";
import { VisionEngine } from "@/lib/vision-engine";
import { RecognitionSession } from "@/lib/recognition-session";
import type {
  CalibrationTemplate,
  DetectionStatus,
  VisionFrame,
  WorkerMessage,
} from "@/lib/vision-types";
import { SiteFooter, SiteHeader } from "./site-chrome";
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const engineRef = useRef<VisionEngine | null>(null);
  const workerRef = useRef<RecognitionSession | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);
  const lastVideoTimeRef = useRef(-1);
  const frameErrorsRef = useRef(0);
  const cameraProgressRef = useRef(0);
  const cameraGenerationRef = useRef(0);
  const cameraPendingRef = useRef(false);
  const captureGenerationRef = useRef(0);
  const frameLoopRef = useRef<() => void>(() => {});
  const settingsRef = useRef(settings);
  const sessionStartedRef = useRef(0);
  const templatesRef = useRef<CalibrationTemplate[]>([]);
  const captureFramesRef = useRef<VisionFrame[]>([]);
  const captureStateRef = useRef<CalibrationState>("idle");

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
    if (language === selected) return;
    captureGenerationRef.current++;
    setSelected(language);
    const personalSign = createCustomVocabularyEntry("Personal sign")!;
    setCalibrationWord(personalSign);
    setCustomWordInput("");
    setVocabularySearch("");
    captureStateRef.current = "idle";
    setCalibrationState("idle");
    setCalibrationMessage(`Type a ${language.toUpperCase()} word or short phrase, then record two or three examples.`);
  }

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
      setRecognitionUnavailable(false);
      setRecognitionState(message.state);
      setCandidate(message.candidate);
      setConfidence(message.confidence);
      setBufferSize(message.bufferSize);
      setRecognitionFeedback(message.feedback ?? "");
      return;
    }
    if (message.type !== "confirmed") return;

    const entry: TranscriptEntry = {
      id: `${message.timestamp}-${message.gloss}`,
      text: message.text,
      gloss: message.gloss,
      confidence: message.confidence,
      timestamp: message.timestamp,
    };
    setEntries((current) => {
      const previous = current[current.length - 1];
      if (isRecentDuplicate(previous, entry)) return current;
      return [...current, entry];
    });
    if (settingsRef.current.autoSpeak) speak(message.text);
  }, [speak]);

  useEffect(() => {
    if (step !== "workspace") return;
    const worker = new RecognitionSession(
      () => new Worker("/workers/recognition.worker.js?v=fist-motion-2", { type: "module" }),
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
    );
    worker.postMessage({ type: "templates", language: selected, templates: templatesRef.current });
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [step, selected, handleWorkerMessage]);

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
    lastVideoTimeRef.current = -1;
    frameErrorsRef.current = 0;
    captureStateRef.current = "idle";
    captureFramesRef.current = [];
    setCalibrationState("idle");
  }, []);

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

    if (now - lastFrameRef.current >= 50 && video.currentTime !== lastVideoTimeRef.current) {
      lastFrameRef.current = now;
      lastVideoTimeRef.current = video.currentTime;
      try {
        const frame = engine.process(video, now);
        const nextDetection = {
          person: frame.face.length > 0 || frame.pose.length > 0,
          hands: frame.hands.length > 0,
          face: frame.face.length > 0,
          pose: frame.pose.length > 0,
        };
        setDetection(nextDetection);
        drawOverlay(frame);
        if (captureStateRef.current === "recording") captureFramesRef.current.push(frame);
        else workerRef.current?.postMessage({ type: "frame", frame });
        frameErrorsRef.current = 0;
      } catch (error) {
        if (process.env.NODE_ENV === "development") console.warn("A video frame could not be processed", error);
        if (++frameErrorsRef.current >= 5) {
          stopCamera();
          setCameraState("error");
          setCameraMessage("Hand tracking stopped. Start the camera again to reload tracking.");
          return;
        }
      }
    }
    animationRef.current = requestAnimationFrame(frameLoopRef.current);
  }, [drawOverlay, stopCamera]);

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
      const engine = await VisionEngine.create(message => {
        if (generation === cameraGenerationRef.current) setCameraMessage(message);
      });
      if (generation !== cameraGenerationRef.current) { engine.close(); return; }
      engineRef.current = engine;
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
    sessionStartedRef.current = Date.now();
    setStep("workspace");
    window.scrollTo({ top: 0, behavior: "smooth" });
    window.setTimeout(() => void requestCamera(), 0);
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
    setCalibrationMessage(`Signing ${calibrationWord.text} — complete the full movement.`);
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
      frames: prepareCalibrationSequence(validFrames),
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
      setCalibrationMessage("Type a word or short phrase first—letters, numbers, spaces, apostrophes and hyphens are supported.");
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
    setStorageMessage("");
    setEntries([]);
    sessionStartedRef.current = Date.now();
    setHistory(loadHistory());
  };

  const clearAllLocalData = async () => {
    clearLocalSignRelayData();
    await clearCalibrationTemplates();
    setEntries([]);
    setHistory([]);
    setCalibrationTemplates([]);
    setSettings(DEFAULT_SETTINGS);
  };

  if (step === "workspace") {
    return (
      <div className="app-shell">
        <SurfaceMotion scene={`workspace-${selected}`} cursor={false} />
        <SiteHeader />
        <main className="workspace-page">
          <div className="workspace-topbar">
            <button className="back-link" onClick={returnHome}>
              <ArrowLeft size={18} aria-hidden="true" /> Change language
            </button>
            <div className="workspace-title">
              <span className="language-code compact">{model.shortName}</span>
              <div>
                <h1>Live translation</h1>
                <p>{model.language}</p>
              </div>
            </div>
            <span className="local-badge"><ShieldCheck size={16} /> On-device processing</span>
          </div>

          <div className="honesty-banner" role="note">
            <Sparkles size={18} aria-hidden="true" />
            <p>{model.status === "experimental" ? <><strong>Research preview.</strong> {model.automaticVocabularyCount.toLocaleString()} isolated signs. Check translations before relying on them.</> : model.status === "preparing" ? <><strong>Personal signs only.</strong> The shared model is not installed. Teach a sign to get started.</> : <><strong>Personal signs only.</strong> Record examples to activate your {model.shortName} vocabulary.</>}</p>
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
                    {cameraState === "requesting" || cameraState === "loading" ? (
                      <RefreshCw className="spin" size={34} aria-hidden="true" />
                    ) : cameraState === "denied" ? (
                      <CameraOff size={38} aria-hidden="true" />
                    ) : (
                      <Camera size={38} aria-hidden="true" />
                    )}
                    <h3>{cameraState === "loading" ? "Preparing your camera" : cameraState === "requesting" ? "Allow camera access" : cameraState === "idle" ? "Ready when you are" : "Camera unavailable"}</h3>
                    <p>{cameraMessage}</p>
                    {(cameraState === "denied" || cameraState === "error" || cameraState === "idle") && (
                      <button className="button secondary small" onClick={requestCamera}>
                        {cameraState === "idle" ? <><Play size={16} aria-hidden="true" /> Start camera</> : <><RefreshCw size={16} aria-hidden="true" /> Retry camera</>}
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
                <summary>Camera options <ChevronDown size={16} aria-hidden="true" /></summary>
              <div className="detection-grid" aria-label="Vision detection status">
                <DetectionItem icon={<Camera size={16} />} label="Camera" active={cameraState === "active"} />
                <DetectionItem icon={<UserRound size={16} />} label="Person" active={detection.person} />
                <DetectionItem icon={<Hand size={16} />} label="Hands" active={detection.hands} />
                <DetectionItem icon={<Eye size={16} />} label="Face" active={detection.face} />
                <DetectionItem icon={<UserRound size={16} />} label="Upper body" active={detection.pose} />
              </div>

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
              <div className="camera-session-actions">
                <span>{cameraState === "active" ? "Camera on · video stays private" : "Video stays on this device"}</span>
                <button className="button ghost small" onClick={cameraState === "active" ? stopCamera : requestCamera}>
                  {cameraState === "active" ? <><Pause size={16} /> Pause</> : <><Play size={16} /> Start camera</>}
                </button>
              </div>
            </section>

            <section className="transcript-panel" aria-labelledby="transcript-title">
              <div className="panel-heading">
                <div>
                  <h2 id="transcript-title">Transcript</h2>
                </div>
                <div className={`recognition-state ${recognitionState}`}>
                  <span /> {recognitionState}
                </div>
              </div>

              <div className="candidate-bar" aria-live="polite">
                <div>
                  <span className="candidate-label">Current sequence</span>
                  <strong>{candidate ? candidate : bufferSize < 10 ? "Building movement context…" : "No confident match"}</strong>
                </div>
                <div className="confidence-ring" title="Match score, not a measured probability of correct translation" style={{ "--confidence": `${Math.round(confidence * 100)}%` } as React.CSSProperties}>
                  <span>{Math.round(confidence * 100)}%</span>
                </div>
              </div>

              {recognitionFeedback && <p className="calibration-message" role="status">{recognitionFeedback}</p>}
              {recognitionUnavailable && (
                <button className="button secondary small" onClick={() => workerRef.current?.restart()}>
                  <RefreshCw size={16} /> Restart recognition
                </button>
              )}
              <div className="transcript-body" aria-live="polite" aria-label="Confirmed translation">
                {!entries.length ? (
                  <div className="transcript-empty">
                    <Mic2 size={28} aria-hidden="true" />
                    <h3>Your words, here.</h3>
                    <p>Complete each sign. Confident matches appear here.</p>
                  </div>
                ) : (
                  <div className="transcript-list">
                    {entries.map((entry) => (
                      <article className="transcript-entry" key={entry.id}>
                        <div className="entry-time">
                          <Check size={14} /> {new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </div>
                        {editingId === entry.id ? (
                          <input
                            className="entry-editor"
                            maxLength={500}
                            value={entry.text}
                            autoFocus
                            onChange={(event) => setEntries((current) => current.map((item) => item.id === entry.id ? { ...item, text: event.target.value } : item))}
                            onBlur={() => setEditingId(null)}
                            onKeyDown={(event) => event.key === "Enter" && setEditingId(null)}
                            aria-label={`Edit ${entry.text}`}
                          />
                        ) : (
                          <p>{entry.text}</p>
                        )}
                        <div className="entry-actions">
                          <span>{Math.round(entry.confidence * 100)}% · {entry.gloss}</span>
                          <button onClick={() => setEditingId(entry.id)} aria-label={`Edit ${entry.text}`}><Edit3 size={15} /></button>
                          <button onClick={() => setEntries((current) => current.filter((item) => item.id !== entry.id))} aria-label={`Remove ${entry.text}`}><X size={16} /></button>
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
                    <Volume2 size={16} /> Speak
                  </button>
                  <button className="button ghost small" onClick={() => window.speechSynthesis?.cancel()}>
                    <VolumeX size={16} /> Stop
                  </button>
                </div>
              </div>
              <details className="workspace-disclosure voice-options">
                <summary>Voice settings <ChevronDown size={16} aria-hidden="true" /></summary>
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
                  <History size={16} /> History ({history.length})
                </button>
                <button className="button danger small" disabled={!entries.length} onClick={clearTranscript}>
                  <Trash2 size={16} /> Save & clear
                </button>
              </div>

              {storageMessage && <p className="calibration-message" role="status">{storageMessage}</p>}
              {showHistory && (
                <div className="history-drawer">
                  <div className="history-heading"><strong>Local history</strong><button onClick={() => setShowHistory(false)} aria-label="Close history"><X size={17} /></button></div>
                  {!history.length ? <p>No saved sessions on this device.</p> : history.map((session) => (
                    <div className="history-session" key={session.id}>
                      <span><Clock3 size={14} /> {new Date(session.createdAt).toLocaleString()}</span>
                      <p>{session.entries.map((entry) => entry.text).join(" ")}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <details className="calibration-panel workspace-disclosure vocabulary-disclosure" id="personal-vocabulary" ref={vocabularyRef}>
            <summary><span>Personal vocabulary <small>{activeCustomCount} signs taught</small></span><ChevronDown size={18} aria-hidden="true" /></summary>
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
                    <Camera size={16} /> {cameraState === "active" ? "Record example" : "Start camera & record"}
                  </button>
                  {trainedGlosses.has(calibrationWord.gloss) && (
                    <button className="button ghost small" onClick={() => void removeCalibration(calibrationWord.gloss)}>
                      <Trash2 size={15} /> Remove
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
                  <ArrowRight size={16} /> Select word
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
                    {exampleCount > 0 && <Check size={14} aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
            {filteredCalibrationVocabulary.length > visibleCalibrationVocabulary.length && (
              <p className="calibration-message">Showing {visibleCalibrationVocabulary.length} of {filteredCalibrationVocabulary.length.toLocaleString()} words. Search to narrow the library.</p>
            )}
          </details>

          <details className="workspace-disclosure privacy-disclosure">
            <summary>Privacy &amp; model details <ChevronDown size={18} aria-hidden="true" /></summary>
            <p className="model-detail-copy">{model.status === "experimental" ? `${model.automaticVocabularyCount.toLocaleString()} automatic ${model.shortName} test signs · ${model.version}. This is an isolated-sign research model, not a validated continuous sign-language interpreter.` : model.status === "preparing" ? `No shared automatic ${model.shortName} model is installed. Recognition uses only the private signs you teach.` : `${model.vocabulary.length.toLocaleString()} ${model.shortName} starter labels are available to teach. Labels are not pre-trained translations.`} Personal examples store normalised landmarks, never camera video.</p>
          <section className="privacy-strip" aria-labelledby="privacy-heading">
            <ShieldCheck size={25} aria-hidden="true" />
            <div>
              <h2 id="privacy-heading">Your camera stays private</h2>
              <p>Frames are analysed in this browser. Raw video is not uploaded or stored. Settings and saved transcripts stay in local browser storage.</p>
            </div>
            <button className="button ghost small" onClick={clearAllLocalData}>Clear local data</button>
          </section>
          </details>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <SurfaceMotion scene="welcome" />
      <SiteHeader />
      <main>
        <section className="cinematic-hero" aria-labelledby="hero-title">
          <div className="product-preview" role="img" aria-label="Illustrative SignRelay interface preview. Camera is off. Example transcript: Hello. Nice to meet you.">
            <div className="preview-toolbar" aria-hidden="true">
              <span>SignRelay</span><span>Interface preview</span>
            </div>
            <div className="preview-surface" aria-hidden="true">
              <div className="preview-camera">
                <span className="preview-label"><CameraOff size={14} /> Camera off</span>
                <Image src="/signrelay-mark.webp" width={220} height={220} alt="" priority unoptimized />
                <span className="preview-camera-note">Your space to sign.</span>
              </div>
              <div className="preview-transcript">
                <span className="preview-label">Example transcript</span>
                <p>Hello.<br /><span>Nice to meet you.</span></p>
                <span className="preview-privacy"><ShieldCheck size={15} /> On your device</span>
              </div>
            </div>
          </div>
          <div className="cinematic-copy">
            <p className="cinematic-label">A little closer. A little clearer.</p>
            <h1 id="hero-title">Sign freely.<br />Connect naturally.</h1>
            <p className="cinematic-description">Explore sign recognition in your browser.<br />Your camera stays yours.</p>
          </div>
          <div className="cinematic-actions">
            <a className="button cinematic-cta" href="#choose-language">Start translating <ArrowRight size={17} aria-hidden="true" /></a>
            <a className="cinematic-learn" href="/how-it-works">How it works</a>
          </div>
          <p className="cinematic-footnote">Private by default <span aria-hidden="true">/</span> Research preview</p>
        </section>

        <section className="language-section" id="choose-language" tabIndex={-1} aria-labelledby="language-title">
          <div className="section-heading" data-reveal>
            <h2 id="language-title">Your language.<br />Your conversation.</h2>
            <p>Every language stays separate, so its signing is treated with the respect it deserves.</p>
          </div>
          <div className="language-grid" role="radiogroup" aria-label="Sign language">
            {LANGUAGE_LIST.map((language, index) => (
              <button
                key={language.id}
                data-reveal
                className={`language-card ${selected === language.id ? "selected" : ""}`}
                onClick={() => selectLanguage(language.id)}
                role="radio"
                aria-checked={selected === language.id}
                tabIndex={selected === language.id ? 0 : -1}
                onKeyDown={(event) => {
                  const direction = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
                  if (direction === undefined && event.key !== "Home" && event.key !== "End") return;
                  event.preventDefault();
                  const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? LANGUAGE_LIST.length - 1
                    : (index + direction! + LANGUAGE_LIST.length) % LANGUAGE_LIST.length;
                  selectLanguage(LANGUAGE_LIST[nextIndex].id);
                  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[nextIndex]?.focus();
                }}
              >
                <span className="language-code">{language.shortName}</span>
                <h3>{language.language}</h3>
                <p>{language.summary}</p>
                <span className={`model-pill ${language.status === "experimental" ? "available" : language.status === "preparing" ? "preparing" : "personal"}`}>
                  <span className="mini-dot" aria-hidden="true" />
                  {language.status === "experimental" ? `${language.automaticVocabularyCount.toLocaleString()}-sign research model + personal vocabulary` : language.status === "preparing" ? "Shared model preparing · private vocabulary available" : `${language.vocabulary.length}+ word starter library`}
                </span>
              </button>
            ))}
          </div>
          <div className="language-continue" aria-live="polite" data-reveal>
            <p>{model.status === "experimental"
              ? `Selected: ${model.language} · ${model.automaticVocabularyCount.toLocaleString()} automatic research signs + your own personal signs`
              : model.status === "preparing"
                ? `Selected: ${model.language} · no shared automatic model installed yet + your own private signs`
                : `Selected: ${model.language} · ${model.vocabulary.length.toLocaleString()} starter labels + unlimited private vocabulary`}</p>
            <button className="button primary" onClick={beginTranslation}>
              Continue to camera <ArrowRight size={18} aria-hidden="true" />
            </button>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function StatusBadge({ active, label }: { active: boolean; label: string }) {
  return <span className={`status-badge ${active ? "active" : ""}`} title={label}><span />{active ? "Active" : label}</span>;
}

function DetectionItem({ icon, label, active }: { icon: React.ReactNode; label: string; active: boolean }) {
  return <div className={`detection-item ${active ? "active" : ""}`}>{icon}<span>{label}</span><strong>{active ? "Detected" : "Waiting"}</strong></div>;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
