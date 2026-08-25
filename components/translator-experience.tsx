"use client";

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
  ASL_BUILT_IN_VOCABULARY,
  createCustomAslVocabularyEntry,
  LANGUAGE_LIST,
  type AslVocabularyEntry,
  type LanguageId,
} from "@/lib/model-adapters";
import { isRecentDuplicate } from "@/lib/decoder";
import { prepareCalibrationSequence } from "@/lib/personalized-recognition";
import { VisionEngine } from "@/lib/vision-engine";
import type {
  CalibrationTemplate,
  DetectionStatus,
  VisionFrame,
  WorkerMessage,
} from "@/lib/vision-types";
import { SiteFooter, SiteHeader } from "./site-chrome";

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
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [history, setHistory] = useState<TranscriptSession[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [settings, setSettings] = useState<SpeechSettings>(DEFAULT_SETTINGS);
  const [calibrationTemplates, setCalibrationTemplates] = useState<CalibrationTemplate[]>([]);
  const [calibrationWord, setCalibrationWord] = useState<AslVocabularyEntry>(() => createCustomAslVocabularyEntry("Personal sign")!);
  const [customWordInput, setCustomWordInput] = useState("");
  const [calibrationState, setCalibrationState] = useState<CalibrationState>("idle");
  const [calibrationMessage, setCalibrationMessage] = useState("Type a word or short phrase, then record the complete sign one to three times.");
  const [countdown, setCountdown] = useState(3);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const engineRef = useRef<VisionEngine | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);
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
    calibrationTemplates.forEach((template) => counts.set(template.gloss, (counts.get(template.gloss) ?? 0) + 1));
    return counts;
  }, [calibrationTemplates]);

  const trainedGlosses = useMemo(() => new Set(calibrationCounts.keys()), [calibrationCounts]);

  const calibrationVocabulary = useMemo(() => {
    const knownGlosses = new Set<string>();
    const customWords: AslVocabularyEntry[] = [];

    calibrationTemplates.forEach((template) => {
      if (knownGlosses.has(template.gloss)) return;
      const word = createCustomAslVocabularyEntry(template.text || template.gloss);
      if (!word || knownGlosses.has(word.gloss)) return;
      knownGlosses.add(word.gloss);
      customWords.push(word);
    });

    return customWords;
  }, [calibrationTemplates]);

  const activeCustomCount = trainedGlosses.size;

  const filteredCalibrationVocabulary = calibrationVocabulary;

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
    workerRef.current?.postMessage({ type: "templates", templates: calibrationTemplates });
  }, [calibrationTemplates]);

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
    utterance.lang = "en-US";
    window.speechSynthesis.speak(utterance);
  }, []);

  const handleWorkerMessage = useCallback((message: WorkerMessage) => {
    if (message.type === "analysis") {
      setRecognitionState(message.state);
      setCandidate(message.candidate);
      setConfidence(message.confidence);
      setBufferSize(message.bufferSize);
      return;
    }

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
    const worker = new Worker(new URL("../workers/recognition.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => handleWorkerMessage(event.data);
    worker.postMessage({ type: "templates", templates: templatesRef.current });
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [step, handleWorkerMessage]);

  const stopCamera = useCallback(() => {
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
    captureStateRef.current = "idle";
    captureFramesRef.current = [];
    setCalibrationState("idle");
  }, []);

  useEffect(() => () => {
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
    if (!video || !engine || video.readyState < 2) {
      animationRef.current = requestAnimationFrame(frameLoopRef.current);
      return;
    }

    const now = performance.now();
    if (now - lastFrameRef.current >= 105) {
      try {
        const frame = engine.process(video, now);
        lastFrameRef.current = now;
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
      } catch (error) {
        console.warn("A video frame could not be processed", error);
      }
    }
    animationRef.current = requestAnimationFrame(frameLoopRef.current);
  }, [drawOverlay]);

  useEffect(() => {
    frameLoopRef.current = runFrameLoop;
  }, [runFrameLoop]);

  const requestCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState("error");
      setCameraMessage("This browser does not expose camera access.");
      return;
    }
    setCameraState("requesting");
    setCameraMessage("Waiting for camera permission");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (!videoRef.current) throw new Error("Camera view was not ready");
      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      setCameraState("loading");
      const engine = await VisionEngine.create(setCameraMessage);
      engineRef.current = engine;
      setCameraState("active");
      setCameraMessage("Camera and vision models active");
      animationRef.current = requestAnimationFrame(frameLoopRef.current);
    } catch (error) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      const permissionDenied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "PermissionDeniedError");
      setCameraState(permissionDenied ? "denied" : "error");
      setCameraMessage(permissionDenied
        ? "Camera permission was denied. SignRelay cannot analyse video without it."
        : "Camera or vision models could not be started. Check your connection and try again.");
    }
  }, []);

  const beginTranslation = () => {
    if (model.status !== "experimental") return;
    sessionStartedRef.current = Date.now();
    setStep("workspace");
    window.scrollTo({ top: 0, behavior: "smooth" });
    window.setTimeout(() => void requestCamera(), 0);
  };

  const recordCalibration = useCallback(async () => {
    if (captureStateRef.current !== "idle" && captureStateRef.current !== "saved" && captureStateRef.current !== "error") return;
    if (!engineRef.current) await requestCamera();
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
      if (!engineRef.current) return;
    }

    captureFramesRef.current = [];
    captureStateRef.current = "recording";
    setCalibrationState("recording");
    setCalibrationMessage(`Signing ${calibrationWord.text} — complete the full movement.`);
    await wait(3000);

    captureStateRef.current = "saving";
    setCalibrationState("saving");
    const validFrames = captureFramesRef.current.filter((frame) => frame.hands.length > 0);
    if (validFrames.length < 16) {
      captureStateRef.current = "error";
      setCalibrationState("error");
      setCalibrationMessage("Not enough hand movement was visible. Keep your hands in frame and try again.");
      return;
    }

    const createdAt = Date.now();
    const template: CalibrationTemplate = {
      id: `${calibrationWord.gloss}-${createdAt}-${Math.random().toString(36).slice(2, 7)}`,
      gloss: calibrationWord.gloss,
      text: calibrationWord.text,
      createdAt,
      frames: prepareCalibrationSequence(validFrames),
    };

    try {
      await saveCalibrationTemplate(template);
      const updated = await loadCalibrationTemplates();
      setCalibrationTemplates(updated);
      captureStateRef.current = "saved";
      setCalibrationState("saved");
      setCalibrationMessage(`${calibrationWord.text} is now active in your personal recognizer. Record two or three examples for better consistency.`);
    } catch {
      captureStateRef.current = "error";
      setCalibrationState("error");
      setCalibrationMessage("This browser could not save the example. Check private-browsing storage settings and try again.");
    }
  }, [calibrationWord, requestCamera]);

  const selectCustomWord = () => {
    const customWord = createCustomAslVocabularyEntry(customWordInput);
    if (!customWord) {
      setCalibrationState("error");
      setCalibrationMessage("Type a word or short phrase first—letters, numbers, spaces, apostrophes and hyphens are supported.");
      return;
    }

    setCalibrationWord(customWord);
    setCustomWordInput("");
    captureStateRef.current = "idle";
    setCalibrationState("idle");
    setCalibrationMessage(`${customWord.text} is selected. Record one to three examples to teach your personal recognizer.`);
  };

  const removeCalibration = useCallback(async (gloss: string) => {
    await deleteCalibrationGloss(gloss);
    setCalibrationTemplates(await loadCalibrationTemplates());
    captureStateRef.current = "idle";
    setCalibrationState("idle");
    setCalibrationMessage("Personal examples removed for this word.");
  }, []);

  const returnHome = () => {
    stopCamera();
    setStep("welcome");
  };

  const clearTranscript = () => {
    saveSession({
      id: String(sessionStartedRef.current),
      language: selected,
      createdAt: sessionStartedRef.current,
      entries,
    });
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
                <p>{model.language} · {model.version}</p>
              </div>
            </div>
            <span className="local-badge"><ShieldCheck size={16} /> On-device processing</span>
          </div>

          <div className="honesty-banner" role="note">
            <Sparkles size={18} aria-hidden="true" />
            <p><strong>{ASL_BUILT_IN_VOCABULARY.length.toLocaleString()} built-in ASL test signs:</strong> the official WLASL1000 Pose-TGCN isolated-sign model runs locally in your browser. You can separately type any word or short phrase and record your own personal sign.</p>
            <a href="#personal-vocabulary">Teach a sign</a>
          </div>

          <div className="translator-grid">
            <section className="camera-panel" aria-labelledby="camera-title">
              <div className="panel-heading">
                <div>
                  <p className="panel-kicker">Live input</p>
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
                    <h3>{cameraState === "loading" ? "Preparing private vision models" : cameraState === "requesting" ? "Allow camera access" : "Camera unavailable"}</h3>
                    <p>{cameraMessage}</p>
                    {(cameraState === "denied" || cameraState === "error" || cameraState === "idle") && (
                      <button className="button secondary small" onClick={requestCamera}>
                        <RefreshCw size={16} aria-hidden="true" /> Retry camera
                      </button>
                    )}
                  </div>
                )}
                {cameraState === "active" && (
                  <div className="camera-guidance">Keep both hands, your face and shoulders in frame · use even front lighting</div>
                )}
                {calibrationState !== "idle" && calibrationState !== "saved" && calibrationState !== "error" && (
                  <div className={`calibration-capture ${calibrationState}`} role="status" aria-live="assertive">
                    <span>{calibrationState === "countdown" ? countdown : calibrationState === "recording" ? "REC" : "···"}</span>
                    <strong>{calibrationState === "countdown" ? `Get ready: ${calibrationWord.text}` : calibrationState === "recording" ? `Sign ${calibrationWord.text}` : "Saving example"}</strong>
                  </div>
                )}
              </div>

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
                <button className="button ghost small" onClick={cameraState === "active" ? stopCamera : requestCamera}>
                  {cameraState === "active" ? <><Pause size={16} /> Pause camera</> : <><Play size={16} /> Start camera</>}
                </button>
              </div>
            </section>

            <section className="transcript-panel" aria-labelledby="transcript-title">
              <div className="panel-heading">
                <div>
                  <p className="panel-kicker">Live output</p>
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
                <div className="confidence-ring" style={{ "--confidence": `${Math.round(confidence * 100)}%` } as React.CSSProperties}>
                  <span>{Math.round(confidence * 100)}%</span>
                </div>
              </div>

              <div className="transcript-body" aria-live="polite" aria-label="Confirmed translation">
                {!entries.length ? (
                  <div className="transcript-empty">
                    <Mic2 size={28} aria-hidden="true" />
                    <h3>Your confirmed translation appears here</h3>
                    <p>Sign naturally and complete the full movement. Low-confidence sequences remain unconfirmed.</p>
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
                  <span><strong>Auto speak</strong><small>Speak only newly confirmed text</small></span>
                </label>
                <div className="speech-buttons">
                  <button className="button secondary small" disabled={!entries.length} onClick={() => speak(entries.map((entry) => entry.text).join(" "))}>
                    <Volume2 size={16} /> Speak
                  </button>
                  <button className="button ghost small" onClick={() => window.speechSynthesis?.cancel()}>
                    <VolumeX size={16} /> Stop
                  </button>
                </div>
                <label className="range-control">
                  <span>Volume <strong>{Math.round(settings.volume * 100)}%</strong></span>
                  <input type="range" min="0" max="1" step="0.05" value={settings.volume} onChange={(event) => setSettings((current) => ({ ...current, volume: Number(event.target.value) }))} />
                </label>
                <label className="range-control">
                  <span>Rate <strong>{settings.rate.toFixed(2)}×</strong></span>
                  <input type="range" min="0.6" max="1.4" step="0.05" value={settings.rate} onChange={(event) => setSettings((current) => ({ ...current, rate: Number(event.target.value) }))} />
                </label>
              </div>

              <div className="transcript-actions">
                <button className="button ghost small" onClick={() => setShowHistory((current) => !current)}>
                  <History size={16} /> History ({history.length})
                </button>
                <button className="button danger small" disabled={!entries.length} onClick={clearTranscript}>
                  <Trash2 size={16} /> Save & clear
                </button>
              </div>

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

          <section className="calibration-panel" id="personal-vocabulary" aria-labelledby="calibration-title">
            <div className="calibration-heading">
              <div>
                <p className="panel-kicker">On-device personal recognizer</p>
                <h2 id="calibration-title">Add your own personal sign</h2>
                <p>The {ASL_BUILT_IN_VOCABULARY.length.toLocaleString()} WLASL words above are already built in. For a word or short phrase outside that model, type it below and record the complete sign one to three times. SignRelay stores only normalized landmarks on this device—not camera video.</p>
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

            <p className={`calibration-message ${calibrationState}`} role="status">{calibrationMessage}</p>
            <div className="vocabulary-grid" aria-label="Personal ASL vocabulary">
              {filteredCalibrationVocabulary.map((word) => {
                const exampleCount = calibrationCounts.get(word.gloss) ?? 0;
                return (
                  <button
                    key={word.gloss}
                    className={`${calibrationWord.gloss === word.gloss ? "selected" : ""} ${exampleCount ? "trained" : ""}`}
                    onClick={() => {
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
          </section>

          <section className="privacy-strip" aria-labelledby="privacy-heading">
            <ShieldCheck size={25} aria-hidden="true" />
            <div>
              <h2 id="privacy-heading">Your camera stays private</h2>
              <p>Frames are analysed in this browser. Raw video is not uploaded or stored. Settings and saved transcripts stay in local browser storage.</p>
            </div>
            <button className="button ghost small" onClick={clearAllLocalData}>Clear local data</button>
          </section>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <SiteHeader />
      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-inner">
            <p className="eyebrow">Communication, made visible</p>
            <h1 id="hero-title">Sign freely.<br /><span>Be understood.</span></h1>
            <p className="hero-copy">
              SignRelay translates continuous sign language into text and speech by analysing hand movement, facial expression and body language — locally in your browser.
            </p>
            <div className="hero-actions">
              <button className="button primary" onClick={() => document.getElementById("choose-language")?.scrollIntoView({ behavior: "smooth" })}>
                <Play size={18} fill="currentColor" aria-hidden="true" /> Start translating
              </button>
              <a className="button secondary" href="/how-it-works"><ShieldCheck size={19} /> See how it works</a>
            </div>
          </div>
        </section>

        <section className="language-section" id="choose-language" aria-labelledby="language-title">
          <div className="section-heading">
            <h2 id="language-title">Choose your sign language</h2>
            <p>ASL, ISL and CSL are distinct languages. Each uses its own vocabulary, sequence model and decoder.</p>
          </div>
          <div className="language-grid" role="radiogroup" aria-label="Sign language">
            {LANGUAGE_LIST.map((language) => (
              <button
                key={language.id}
                className={`language-card ${selected === language.id ? "selected" : ""}`}
                onClick={() => setSelected(language.id)}
                role="radio"
                aria-checked={selected === language.id}
              >
                <span className="language-code">{language.shortName}</span>
                <h3>{language.language}</h3>
                <p>{language.summary}</p>
                <span className={`model-pill ${language.status === "experimental" ? "available" : "unavailable"}`}>
                  <span className="mini-dot" aria-hidden="true" />
                  {language.status === "experimental" ? "Experimental starter available" : "Model not installed"}
                </span>
              </button>
            ))}
          </div>
          <div className="language-continue" aria-live="polite">
            <p>{model.status === "experimental"
              ? `Selected: ${model.language} · ${ASL_BUILT_IN_VOCABULARY.length} built-in test signs + your own personal signs`
              : `${model.language} needs a trained, licensed checkpoint before translation can begin.`}</p>
            <button className="button primary" disabled={model.status !== "experimental"} onClick={beginTranslation}>
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
