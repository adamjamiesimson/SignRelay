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
  Plus, RotateCcw, Save, Square, Trash2, Volume2, X,
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
  subscribeCalibrationChanges,
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
import { canConfirmAutomatically } from "@/lib/model-output-policy";
import { EMPTY_SUGGESTIONS, acceptSuggestion, announceSuggestion, holdSuggestions, insertBySigningTime, isArmed, nextSuggestionDeadline, offerSuggestion,
  removeSuggestion, suggestionFromMessage, tickSuggestions, type SuggestionState } from "@/lib/model-suggestion";
import { ASL_ALPHABET, FINGERSPELLING_MODEL, MAX_FINGERSPELLING_TEXT, editSpelling } from "@/lib/fingerspelling";
import { FingerspellingCapture } from "@/lib/fingerspelling-capture";
import { FINGERSPELLING_ENABLED, STARTER_OUTPUT, effectiveStarterOutput } from "@/lib/release";
import type { StudyEvent } from "@/lib/signer-study";
import { FingerspellingCtcSession } from "@/lib/fingerspelling-ctc-session";
import { FINGERSPELLING_CTC_MODEL } from "@/lib/fingerspelling-model";
import { calibrationFrames, prepareCalibrationSequence } from "@/lib/personalized-recognition";
import { RESEARCH_PROMPTS,makeResearchTrial,exportResearchMetrics,researchSummary,type ResearchContext,type ResearchDraft,type ResearchPending,type ResearchTrial,type ResearchOutcome } from "@/lib/fingerspelling-research";
import { BitmapCaptureTimeout, LiveVision } from "@/lib/live-vision";
import { drawLandmarkOverlay } from "@/lib/landmark-overlay";
import { RecognitionSession } from "@/lib/recognition-session";
import { recognitionStatus } from "@/lib/recognition-status";
import { ASL_ONLY, OUT_OF_PROFILE_LABEL, isLanguageAvailable } from "@/lib/build-profile";
import { REHEARSAL, RehearsalScript } from "@/lib/rehearsal";
import { formatPerfReadout, RollingTimer, ThroughputMonitor } from "@/lib/frame-perf";
import { capabilityStatus, SIGN_LANGUAGE_NOTE } from "@/lib/capability-status";
import { ASL_VOCABULARY_COUNTS } from "@/lib/asl-vocabulary-status";
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

/** onStudyEvent: only the private /study route (excluded from public exports)
 * observes the workspace, after the participant's consent. Public pages pass
 * nothing, so nothing is reported anywhere. */
export function TranslatorExperience({ onStudyEvent }: { onStudyEvent?: (event: StudyEvent) => void } = {}) {
  const studyRef = useRef(onStudyEvent);
  useEffect(() => { studyRef.current = onStudyEvent; }, [onStudyEvent]);
  const report = useCallback((kind: StudyEvent["kind"], item: { gloss: string; source?: StudyEvent["source"] }) => {
    if (item.source) studyRef.current?.({ kind, gloss: item.gloss, source: item.source });
  }, []);
  const [step, setStep] = useState<Step>("welcome");
  const [aslMode, setAslMode] = useState<"words" | "fingerspelling">("words");
  const aslModeRef = useRef<"words" | "fingerspelling">("words");
  const [spellingText, setSpellingText] = useState("");
  const [spellingMessage, setSpellingMessage] = useState("");
  const spellingInputRef = useRef<HTMLTextAreaElement>(null);
  const spellingSessionRef = useRef<FingerspellingCtcSession | null>(null);
  const spellingCaptureRef = useRef<FingerspellingCapture | null>(null);
  const spellingTimerRef = useRef<number | null>(null);
  const [spellingPhase, setSpellingPhase] = useState<"idle" | "loading" | "ready" | "capturing" | "processing" | "candidate" | "failed">("idle");
  const [spellingCandidate, setSpellingCandidate] = useState("");
  const [researchOpen,setResearchOpen]=useState(false);
  const [researchConsent,setResearchConsent]=useState(false);
  const researchConsentRef=useRef(false);
  const researchDraftRef=useRef<ResearchDraft|null>(null);
  const [researchPrompt,setResearchPrompt]=useState("anna");
  const [researchTruth,setResearchTruth]=useState("ANNA");
  const [researchContext,setResearchContext]=useState<ResearchContext>({device:"other",hand:"Right",light:"front-lit",speed:"usual"});
  const [researchPending,setResearchPending]=useState<ResearchPending|null>(null);
  const [researchTrials,setResearchTrials]=useState<ResearchTrial[]>([]);
  const [researchConfirmed,setResearchConfirmed]=useState(false);
  const [researchIssue,setResearchIssue]=useState<ResearchTrial["issue"]>("none");
  const [researchExportConsent,setResearchExportConsent]=useState(false);
  const [researchMessage,setResearchMessage]=useState("");
  const finishResearch=useCallback((outcome:ResearchOutcome,prediction="",inferenceMs:number|null=null)=>{
    const draft=researchDraftRef.current;researchDraftRef.current=null;
    if(!draft||!researchConsentRef.current)return;
    setResearchPending({...draft,prediction,outcome,inferenceMs,finishToResultMs:draft.finishedAt?performance.now()-draft.finishedAt:null});
    setResearchConfirmed(false);
  },[]);
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
  // Words that need a person's decision (research-model words; starter-rule words
  // unless a research export makes them automatic): never in the transcript
  // until added. Cards in signing order, at most three shown (lib/model-suggestion.ts).
  // The ref is the authority for event handlers.
  const [suggestions, setSuggestions] = useState<SuggestionState>(EMPTY_SUGGESTIONS);
  const suggestionsRef = useRef<SuggestionState>(EMPTY_SUGGESTIONS);
  // Re-rendered at each arming/expiry deadline, so Add's state is current.
  const [suggestionClock, setSuggestionClock] = useState(0);
  const suggestionPanelRef = useRef<HTMLDivElement | null>(null);
  const suggestionPointerInsideRef = useRef(false);
  const selectedRef = useRef<LanguageId>("asl");
  // The compiled policy, further restricted by where the page is served from:
  // fails closed ("suggest") until the hostname is known.
  const starterOutputRef = useRef<"auto" | "suggest">("suggest");
  const [starterAutoActive, setStarterAutoActive] = useState(false);
  useEffect(() => {
    if (STARTER_OUTPUT !== "auto") return;
    starterOutputRef.current = effectiveStarterOutput(STARTER_OUTPUT, window.location.hostname);
    setStarterAutoActive(starterOutputRef.current === "auto");
  }, []);
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
  const visionAbortRef = useRef<AbortController | null>(null);
  const workerRef = useRef<RecognitionSession | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);
  const lastVideoTimeRef = useRef(-1);
  const lastObservedVideoTimeRef = useRef(-1);
  const overlayHasContentRef = useRef(false);
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
  const templateRevisionRef = useRef(0);
  const deletingTemplatesRef = useRef(false);
  const templatesStaleRef = useRef(false);
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
    overlay: new RollingTimer(), age: new RollingTimer(), longTask: new RollingTimer(), classification: new RollingTimer(), communication: new RollingTimer(),
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

  const applyTemplates = useCallback((templates: CalibrationTemplate[]) => {
    templatesRef.current = templates;
    workerRef.current?.postMessage({ type: "templates", language: selectedRef.current,
      templates: templatesStaleRef.current ? [] : templates });
    setCalibrationTemplates(templates);
  }, []);

  const applyTemplateSnapshot = useCallback((templates: CalibrationTemplate[], revision: number) => {
    if (revision !== templateRevisionRef.current) return;
    templatesStaleRef.current = false;
    applyTemplates(templates);
  }, [applyTemplates]);

  useEffect(() => {
    let active = true;
    const reload = (revision: number) => {
      void loadCalibrationTemplates().then(templates => {
        if (active) applyTemplateSnapshot(templates, revision);
      }).catch(() => {
        if (active && revision === templateRevisionRef.current)
          setCalibrationMessage("Personal vocabulary storage is unavailable in this browser.");
      });
    };
    const unsubscribe = subscribeCalibrationChanges(() => {
      templatesStaleRef.current = true;
      workerRef.current?.postMessage({ type: "templates", language: selectedRef.current, templates: [] });
      setCandidate(null);
      reload(++templateRevisionRef.current);
    });
    reload(templateRevisionRef.current);
    return () => { active = false; unsubscribe(); };
  }, [applyTemplateSnapshot]);

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
    aslModeRef.current = "words";
    setAslMode("words");
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
  useEffect(() => { selectedRef.current = selected; }, [selected]);

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

  const setPending = useCallback((input: SuggestionState) => {
    // An unmounted panel may never receive pointerleave. A panel still
    // showing missed notes can keep its pointer hold for the next card.
    const hasPanel = input.visible.length || input.waiting.length || input.missed.length;
    if (!hasPanel) suggestionPointerInsideRef.current = false;
    const next = input.held && !hasPanel ? { ...input, held: false } : input;
    // Keep keyboard focus in the transcript if it was on a card that disappears.
    const focused = suggestionPanelRef.current?.contains(document.activeElement)
      ? (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-suggestion-key]")?.dataset.suggestionKey : undefined;
    suggestionsRef.current = next;
    setSuggestions(next);
    setSuggestionClock(performance.now());
    if (focused && !next.visible.some(item => item.key === focused)) transcriptHeadingRef.current?.focus();
  }, []);
  // Withdraw every pending suggestion (session, language, mode or camera ended).
  const withdrawSuggestion = useCallback(() => {
    const current = suggestionsRef.current;
    if (current.visible.length || current.waiting.length || current.missed.length) setPending(EMPTY_SUGGESTIONS);
  }, [setPending]);

  // A suggestion belongs to one language, mode and live camera session.
  useEffect(() => { withdrawSuggestion(); }, [selected, aslMode, step, withdrawSuggestion]);
  useEffect(() => { if (cameraState !== "active") withdrawSuggestion(); }, [cameraState, withdrawSuggestion]);
  // One timer for the next arming, expiry or note deadline. Expiry pauses
  // while the person points at or focuses the suggestions (holdSuggestions).
  useEffect(() => {
    const deadline = nextSuggestionDeadline(suggestions, suggestionClock);
    if (deadline === null) return;
    const timer = window.setTimeout(() => {
      const { state, expired } = tickSuggestions(suggestionsRef.current, performance.now());
      for (const item of expired) report("expired", item);
      if (state !== suggestionsRef.current) setPending(state); else setSuggestionClock(performance.now());
      if (expired.length) setAnnouncement(announceSuggestion({ kind: "expired", items: expired }));
    }, Math.max(0, deadline - performance.now()));
    return () => window.clearTimeout(timer);
  }, [suggestions, suggestionClock, setPending, report]);
  const holdPending = useCallback((held: boolean) => {
    const next = holdSuggestions(suggestionsRef.current, held, performance.now());
    if (next !== suggestionsRef.current) setPending(next);
  }, [setPending]);

  const handleWorkerMessage = useCallback((message: WorkerMessage) => {
    if (aslModeRef.current !== "words") return;
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
    if (message.type !== "confirmed" && message.type !== "suggested") return;
    if (message.source === "personal" && (deletingTemplatesRef.current || templatesStaleRef.current)) return;

    // A research-model word for a suggest-only language is offered, never
    // inserted, announced as confirmed or spoken (lib/model-output-policy.ts).
    const offered = suggestionFromMessage(message, selectedRef.current, performance.now(), starterOutputRef.current);
    if (offered) {
      const { state, event } = offerSuggestion(suggestionsRef.current, offered);
      if (event.kind === "offered" && event.replaced) report("replaced", event.replaced);
      if (event.kind !== "expired") report(event.kind, offered);
      setPending(state);
      setAnnouncement(announceSuggestion(event));
      return;
    }
    if (message.type !== "confirmed" || !canConfirmAutomatically(message.source, selectedRef.current, starterOutputRef.current)) return;

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
    report("automatic", entry);
    if (settingsRef.current.autoSpeak) speak(message.text);
  }, [speak, perfMode, setPending, report]);

  useEffect(() => {
    if (aslMode !== "words" || step !== "workspace" || selected === "rsl" || (selected === "bdsl" && MODEL_ADAPTERS.bdsl.status === "experimental")) return;
    const worker = new RecognitionSession(
      // The version changes with the worker protocol, so a cached older worker
      // (which confirmed research-model words) is never reused.
      () => new Worker("/workers/recognition.worker.js?v=observation-boundary-4", { type: "module" }),
      handleWorkerMessage,
      status => {
        setRecognitionUnavailable(status.state === "failed");
        // A restart or failure withdraws any suggestion from the old session.
        if (status.state !== "running") withdrawSuggestion();
        if (status.message) setRecognitionFeedback(status.message);
        if (status.state !== "running") {
          setCandidate(null);
          setBufferSize(0);
          setRecognitionState("listening");
        }
      },
      perfMode,
    );
    worker.postMessage({ type: "templates", language: selected, templates: templatesStaleRef.current ? [] : templatesRef.current });
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
      withdrawSuggestion();
    };
  }, [step, selected, aslMode, handleWorkerMessage, perfMode, withdrawSuggestion]);

  const discardSpellingCapture = useCallback(() => {
    if (spellingTimerRef.current !== null) window.clearTimeout(spellingTimerRef.current);
    if(researchDraftRef.current)researchDraftRef.current.quality=spellingCaptureRef.current?.diagnostics();
    finishResearch("cancelled");
    spellingCaptureRef.current?.dispose();spellingCaptureRef.current = null; setSpellingCandidate("");
    if (spellingSessionRef.current) spellingSessionRef.current.reset();
    else setSpellingPhase("idle");
  }, [finishResearch]);

  useEffect(() => {
    // Disabled release builds never create the research CTC worker or fetch its model.
    if (!FINGERSPELLING_ENABLED || aslMode !== "fingerspelling" || selected !== "asl" || step !== "workspace" || cameraState !== "active") return;
    let active = true;
    const session = new FingerspellingCtcSession(
      () => new Worker("/workers/fingerspelling.worker.js", { type: "module" }),
      FINGERSPELLING_CTC_MODEL,
      result => {
        if (!active) return;
        finishResearch(result.status==="no-hand"||!result.text.trim()?"abstained":"candidate",result.text,result.inferenceMs);
        if (result.status === "no-hand" || !result.text.trim()) {
          setSpellingCandidate(""); setSpellingPhase("ready");
          setSpellingMessage(result.abstentionReason ?? "No text candidate. Try again with your hand clearly visible.");
          return;
        }
        setSpellingCandidate(result.text); setSpellingPhase("candidate");
        setSpellingMessage(result.abstentionReason ?? "Review the candidate before confirming. It may contain mistakes.");
      },
      state => {
        if (!active) return;
        if (state === "failed") {
          finishResearch("technical-failure");
          spellingCaptureRef.current = null; setSpellingCandidate(""); setSpellingPhase("failed");
          setSpellingMessage("Recognition is unavailable. Restart the camera to retry, or edit the draft below.");
        } else if (state === "ready") setSpellingPhase("ready");
        else if (state === "loading") { setSpellingCandidate(""); setSpellingMessage(""); setSpellingPhase("loading"); }
        else setSpellingPhase("processing");
      },
    );
    spellingSessionRef.current = session;
    const visibility = () => { if (document.hidden) discardSpellingCapture(); };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      active = false; session.close();
      if (spellingSessionRef.current === session) spellingSessionRef.current = null;
      spellingCaptureRef.current = null;
      if (spellingTimerRef.current !== null) window.clearTimeout(spellingTimerRef.current);
    };
  }, [aslMode, selected, step, cameraState, discardSpellingCapture, finishResearch]);

  const stopCamera = useCallback(() => {
    finishResearch("cancelled");spellingCaptureRef.current?.dispose();
    spellingCaptureRef.current = null;
    if (spellingTimerRef.current !== null) window.clearTimeout(spellingTimerRef.current);
    spellingSessionRef.current?.close(); spellingSessionRef.current = null;
    setSpellingCandidate(""); setSpellingPhase("idle");
    cameraGenerationRef.current++;
    visionAbortRef.current?.abort();
    visionAbortRef.current = null;
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
    lastObservedVideoTimeRef.current = -1;
    frameErrorsRef.current = 0;
    captureStateRef.current = "idle";
    captureFramesRef.current = [];
    setCalibrationState("idle");
  }, [finishResearch]);

  const changeWorkspaceLanguage = (language: LanguageId) => {
    if (language === selected) return;

    if (!selectLanguage(language)) return;

    const enteringSpecialRecognizer = language === "rsl" || language === "bdsl";
    const leavingSharedRecognizer = selected !== "rsl" && selected !== "bdsl";
    if (enteringSpecialRecognizer && leavingSharedRecognizer) stopCamera();
    else switchTrackingProfile();

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
    for (const name of ["capture", "hands", "auxiliary", "transport", "overlay", "age", "longTask", "classification", "communication", "model", "personal", "reference"] as const) perf[name].reset();
    perf.analysed = 0; perf.frames = 0; perf.handFrames = 0; perf.since = performance.now();
    workerRef.current?.resetStats();
    let observer: PerformanceObserver | undefined;
    if (typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) perf.longTask.record(entry.duration);
      });
      observer.observe({ type: "longtask" });
    }
    const timer = window.setInterval(() => {
      const session = workerRef.current;
      const engine = engineRef.current;
      perf.throughput.tick(perf.analysed, performance.now());
      setPerfWarning(perf.throughput.warning());
      setPerfReadout(formatPerfReadout({ tracking: perf.tracking.summary(), roundTrip: perf.roundTrip.summary(), queueWait: perf.queueWait.summary(),
        seconds: (performance.now() - perf.since) / 1000, analysed: perf.analysed, session: session?.stats ?? null,
        assets: engine?.assetSource ?? null,
        recognition: session ? { state: session.state, recoveries: session.stats.recoveries } : null,
        hands: { seen: perf.handFrames, frames: perf.frames },
        stages: { ...Object.fromEntries((["capture", "hands", "auxiliary", "transport", "overlay", "classification", "communication", "model", "personal", "reference"] as const)
          .map(name => [name, perf[name].summary()])), "capture to overlay": perf.age.summary(), "long task": perf.longTask.summary() },
        tracker: engine ? `${engine.mode}/${engine.delegate}, ${engine.stats.recoveries} restarts, ${engine.stats.replaced} snapshots replaced` : undefined }));
    }, 1000);
    return () => { observer?.disconnect(); window.clearInterval(timer); setPerfWarning(null); };
  }, [perfMode, cameraState]);

  useEffect(() => () => {
    cameraGenerationRef.current++;
    visionAbortRef.current?.abort();
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
      overlayHasContentRef.current = false;
    }
    const visible = settingsRef.current.showOverlay && Boolean(frame.hands.length || frame.face.length || frame.pose.length);
    if (!visible && !overlayHasContentRef.current) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    overlayHasContentRef.current = visible;
    if (!visible) return;

    drawLandmarkOverlay(context, canvas.width, canvas.height, frame);
  }, []);

  // Tracking continuity broke (worker failure, failed capture). The painted
  // hands and the recognizer's evidence describe frames that are no longer
  // current; never carry them across the gap or into the recovered tracker.
  // The epoch is left alone so the failed frame still counts toward the
  // repeated-failure stop in the frame loop.
  const interruptTracking = useCallback(() => {
    discardSpellingCapture();
    workerRef.current?.postMessage({ type: "reset" });
    withdrawSuggestion();
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    setDetection(EMPTY_DETECTION);
    setCandidate(null);
    setBufferSize(0);
    setMotionReason(null);
  }, [discardSpellingCapture, withdrawSuggestion]);

  const attachTracking = useCallback((engine: LiveVision) => {
    engine.onInterrupt = () => { if (engineRef.current === engine) interruptTracking(); };
    engine.onFailure = () => {
      if (engineRef.current !== engine) return;
      stopCamera();
      setCameraState("error");
      setCameraMessage("Hand tracking stopped. Start the camera again to reload tracking.");
    };
  }, [interruptTracking, stopCamera]);

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
      if (video.readyState >= 2 && video.currentTime !== lastObservedVideoTimeRef.current) {
        lastObservedVideoTimeRef.current = video.currentTime;
        cameraProgressRef.current = now;
      }
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

    const interval = engine.profile === "fingerspelling" ? 0 : 33;
    if (!engine.busy && engine.frameAvailable && now - lastFrameRef.current >= interval && video.currentTime !== lastVideoTimeRef.current) {
      lastFrameRef.current = now;
      lastVideoTimeRef.current = video.currentTime;
      const generation = cameraGenerationRef.current;
      const trackingEpoch = trackingEpochRef.current;
      const captureGeneration = captureGenerationRef.current;
      const trackingStarted = performance.now();
      const current = () => engineRef.current === engine && cameraGenerationRef.current === generation
        && trackingEpochRef.current === trackingEpoch && !document.hidden;
      const showHands = (frame: VisionFrame, synthetic = false) => {
        if (!current()) return;
        const drawing = performance.now();
        drawOverlay(frame);
        if (perfMode && !synthetic) {
          const drawMs = performance.now() - drawing;
          perfRef.current.overlay.record(drawMs);
          perfRef.current.age.record(engine.timings.age + drawMs);
        }
        const capture = spellingCaptureRef.current;
        if (capture && aslModeRef.current === "fingerspelling") {
          try { capture.push(frame, video.videoWidth / video.videoHeight); }
          catch {
            discardSpellingCapture();
            setSpellingMessage("Capture was interrupted. Please record the name again.");
          }
        }
      };
      void (async () => {
        // Rehearsal builds only: while a script plays, synthetic landmarks replace
        // the tracker, which is not run (its output would be discarded).
        const rehearsal = REHEARSAL ? rehearsalRef.current?.next(now) : null;
        if (rehearsal) showHands(rehearsal, true);
        const frame = rehearsal ?? await engine.process(video, now, showHands);
        if (!frame || !current() || captureGeneration !== captureGenerationRef.current) return;
        if (perfMode) {
          perfRef.current.tracking.record(performance.now() - trackingStarted);
          for (const name of ["capture", "hands", "auxiliary", "transport"] as const) perfRef.current[name].record(engine.timings[name]);
          perfRef.current.frames++;
          if (frame.hands.length) perfRef.current.handFrames++;
        }
        const nextDetection = {
          person: frame.face.length > 0 || frame.pose.length > 0 || (aslModeRef.current === "fingerspelling" && frame.hands.length > 0),
          hands: frame.hands.length > 0,
          face: frame.face.length > 0,
          pose: frame.pose.length > 0,
        };
        setDetection(previous => Object.keys(nextDetection).every(key => previous[key as keyof DetectionStatus] === nextDetection[key as keyof DetectionStatus]) ? previous : nextDetection);
        if (captureStateRef.current === "recording") captureFramesRef.current.push(frame);
        else if (aslModeRef.current === "words") workerRef.current?.postMessage({ type: "frame", frame });
        frameErrorsRef.current = 0;
      })().catch(error => {
        if (!current()) return;
        if (process.env.NODE_ENV === "development") console.warn("A video frame could not be processed", error);
        interruptTracking();
        if (error instanceof BitmapCaptureTimeout || ++frameErrorsRef.current >= 5) {
          stopCamera();
          setCameraState("error");
          setCameraMessage(error instanceof BitmapCaptureTimeout
            ? "Camera frame capture stopped responding. Start the camera again to reconnect."
            : "Hand tracking stopped. Start the camera again to reload tracking.");
          return;
        }
      }).finally(() => {
        // A CPU hand result may arrive just after the next animation tick.
        // Snapshot the next decoded frame immediately when the 15-Hz interval
        // is due, rather than losing another display tick. Word scheduling stays unchanged.
        if (engine.profile === "fingerspelling" && current() && engine.frameAvailable
          && performance.now() - lastFrameRef.current >= interval) {
          if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
          frameLoopRef.current();
        }
      });
    }
    animationRef.current = requestAnimationFrame(frameLoopRef.current);
  }, [drawOverlay, interruptTracking, stopCamera, perfMode, discardSpellingCapture]);

  useEffect(() => {
    frameLoopRef.current = runFrameLoop;
  }, [runFrameLoop]);

  const createCameraVision = useCallback(async (progress: (message: string) => void, signal: AbortSignal): Promise<LiveVision> => {
    for (;;) {
      signal.throwIfAborted();
      const profile = FINGERSPELLING_ENABLED && aslModeRef.current === "fingerspelling" ? "fingerspelling" : "words";
      const engine = await LiveVision.create(progress, profile === "words", signal, profile);
      // Diagnostics only (?perf&captureClock=capture): opt-in word-mode capture-time stamps.
      const query = new URLSearchParams(window.location.search);
      if (query.has("perf") && query.get("captureClock") === "capture") engine.wordClockPolicy = "capture-time";
      if (profile === (FINGERSPELLING_ENABLED && aslModeRef.current === "fingerspelling" ? "fingerspelling" : "words")) return engine;
      engine.close();
    }
  }, []);

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
      const visionAbort = new AbortController();
      visionAbortRef.current = visionAbort;
      const engine = await createCameraVision(message => {
        if (generation === cameraGenerationRef.current) setCameraMessage(message);
      }, visionAbort.signal);
      if (visionAbortRef.current === visionAbort) visionAbortRef.current = null;
      if (generation !== cameraGenerationRef.current) { engine.close(); return; }
      engineRef.current = engine;
      attachTracking(engine);
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
  }, [attachTracking, stopCamera, createCameraVision]);

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
    if (deletingTemplatesRef.current) return;
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
      const revision = templateRevisionRef.current;
      const { templates: updated } = await saveCalibrationTemplateAndReload(template);
      if (updated) applyTemplateSnapshot(updated, revision);
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
  }, [applyTemplateSnapshot, calibrationWord, model.shortName, requestCamera, selected]);

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
    if (deletingTemplatesRef.current) return;
    deletingTemplatesRef.current = true;
    const revision = ++templateRevisionRef.current;
    workerRef.current?.postMessage({ type: "reset" });
    captureGenerationRef.current++;
    captureStateRef.current = "idle";
    setCalibrationState("idle");
    try {
      await deleteCalibrationGloss(gloss, selected);
      // Publish the committed deletion before attempting any follow-up read.
      if (revision === templateRevisionRef.current) {
        const remaining = templatesRef.current.filter(template =>
          template.gloss !== gloss || (template.language ?? "asl") !== selected);
        applyTemplates(remaining);
      }
      await loadCalibrationTemplates().then(updated => applyTemplateSnapshot(updated, revision), () => {});
      setCalibrationMessage("Personal examples removed for this word.");
    } catch {
      // Show what is still stored rather than pretending it was deleted.
      await loadCalibrationTemplates().then(updated => applyTemplateSnapshot(updated, revision), () => {});
      captureStateRef.current = "error";
      setCalibrationState("error");
      setCalibrationMessage("These examples could not be removed from this browser. Try again, or clear this site's data in your browser settings.");
    } finally {
      deletingTemplatesRef.current = false;
    }
  }, [applyTemplates, applyTemplateSnapshot, selected]);

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
    withdrawSuggestion();
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

  // Only an explicit Add on a suggestion that is on screen inserts its word;
  // stale, too-early, expired or repeated activations do nothing.
  const acceptPendingSuggestion = (key: string) => {
    const now = performance.now();
    const outcome = acceptSuggestion(suggestionsRef.current, key, selectedRef.current, now);
    if (outcome.accepted) report("accepted", outcome.entry);
    if (!outcome.accepted) {
      if (outcome.reason === "too-soon") setAnnouncement("Not added yet. Check the word, then press Add again.");
      return;
    }
    setPending(removeSuggestion(suggestionsRef.current, key, now));
    // Placed where it was signed (the worker's recognition time, the same
    // clock as every confirmed word), not where it was accepted.
    entriesRef.current = insertBySigningTime(entriesRef.current, outcome.entry);
    setEntries(entriesRef.current);
    setAnnouncement(`Added: ${outcome.entry.text}`);
    // The person added this word, so it is spoken like any other added word.
    if (settingsRef.current.autoSpeak) speak(outcome.entry.text);
    transcriptHeadingRef.current?.focus();
  };

  const dismissPendingSuggestion = (key: string) => {
    const item = suggestionsRef.current.visible.find(entry => entry.key === key);
    if (!item) return;
    setPending(removeSuggestion(suggestionsRef.current, key, performance.now()));
    setAnnouncement(`Dismissed suggestion: ${item.text}`);
    report("dismissed", item);
    transcriptHeadingRef.current?.focus();
  };

  const removeEntry = (entry: TranscriptEntry) => {
    report("removed", entry);
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
    if (deletingTemplatesRef.current) return;
    deletingTemplatesRef.current = true;
    const revision = ++templateRevisionRef.current;
    workerRef.current?.postMessage({ type: "reset" });
    window.speechSynthesis?.cancel();
    withdrawSuggestion();
    // An example being recorded now must not be saved after everything was cleared.
    captureGenerationRef.current++;
    captureStateRef.current = "idle";
    captureFramesRef.current = [];
    setCalibrationState("idle");
    const localCleared = clearLocalSignRelayData();
    discardSpellingCapture(); setSpellingText(""); setSpellingMessage("");
    setEntries([]);
    setEditingId(null);
    setHistory([]);
    settingsRef.current = DEFAULT_SETTINGS;
    setSettings(DEFAULT_SETTINGS);
    sessionStartedRef.current = Date.now();
    try {
      await clearCalibrationTemplates();
      applyTemplateSnapshot([], revision);
      setPrivacyMessage(localCleared
        ? "Transcripts, settings, personal signs and tour progress were cleared from this browser."
        : "Personal signs were cleared, but saved transcripts and settings could not be removed from browser storage. Clear this site's data in your browser settings.");
    } catch {
      // Keep showing what is still stored rather than pretending it was deleted.
      await loadCalibrationTemplates().then(updated => applyTemplateSnapshot(updated, revision), () => {});
      setPrivacyMessage(localCleared
        ? "Transcripts and settings were cleared, but personal signs could not be deleted. Clear this site's data in your browser settings."
        : "Nothing could be removed from browser storage. Clear this site's data in your browser settings.");
    } finally { deletingTemplatesRef.current = false; }
  };

  function switchTrackingProfile() {
    const previous = engineRef.current;
    if (!previous || cameraPendingRef.current) return;
    const desired = FINGERSPELLING_ENABLED && aslModeRef.current === "fingerspelling" ? "fingerspelling" : "words";
    if (previous.profile === desired) return;
    const generation = cameraGenerationRef.current;
    trackingEpochRef.current++;
    interruptTracking(); previous.close(); engineRef.current = null;
    const controller = new AbortController(); visionAbortRef.current?.abort(); visionAbortRef.current = controller;
    setCameraState("loading"); setCameraMessage("Loading hand tracking");
    void createCameraVision(message => {
      if (generation === cameraGenerationRef.current && !controller.signal.aborted) setCameraMessage(message);
    }, controller.signal).then(engine => {
      if (generation !== cameraGenerationRef.current || controller.signal.aborted) { engine.close(); return; }
      engineRef.current = engine;
      attachTracking(engine);
      setVisionSource(engine.assetSource); cameraProgressRef.current = performance.now();
      lastVideoTimeRef.current = -1; setCameraState("active"); setCameraMessage("Camera and vision models active");
    }).catch(() => {
      if (generation !== cameraGenerationRef.current || controller.signal.aborted) return;
      stopCamera(); setCameraState("error"); setCameraMessage("Hand tracking could not restart. Start the camera again to retry.");
    }).finally(() => { if (visionAbortRef.current === controller) visionAbortRef.current = null; });
  }

  function changeAslMode(mode: "words" | "fingerspelling") {
    if (aslModeRef.current === mode || (mode === "fingerspelling" && !FINGERSPELLING_ENABLED)) return;
    // Block queued callbacks immediately; the effect terminates the worker.
    // Returning to words creates a fresh session without clearing the transcript.
    aslModeRef.current = mode;
    discardSpellingCapture();
    workerRef.current?.postMessage({ type: "reset" });
    captureGenerationRef.current++;
    captureFramesRef.current = [];
    captureStateRef.current = "idle";
    setCalibrationState("idle");
    setCandidate(null); setBufferSize(0);
    setRecognitionFeedback(""); setMotionReason(null);
    window.speechSynthesis?.cancel();
    setAslMode(mode);
    switchTrackingProfile();
  }

  async function captureSpelling() {
    setSpellingMessage("");setSpellingCandidate("");
    if(spellingPhase==="capturing"){
      if(spellingTimerRef.current!==null)window.clearTimeout(spellingTimerRef.current);
      const capture=spellingCaptureRef.current,session=spellingSessionRef.current,video=videoRef.current;
      const cutoff=performance.now();
      if(researchDraftRef.current)researchDraftRef.current.finishedAt=cutoff;
      setSpellingPhase("processing");
      try {
        if(!capture||!session||!video)throw new Error("Recognition is unavailable");
        capture.seal(cutoff);
        await engineRef.current?.drain(video,cutoff,frame=>{
          if(spellingCaptureRef.current===capture)capture.push(frame,video.videoWidth/video.videoHeight);
        });
        if(spellingCaptureRef.current!==capture||spellingSessionRef.current!==session)return;
        const telemetry=capture.diagnostics();
        if(researchDraftRef.current)researchDraftRef.current.quality=telemetry;
        const input=capture.finish();capture.dispose();spellingCaptureRef.current=null;
        session.submit(input.features,input.frames,telemetry);
      }catch(error){
        if(spellingCaptureRef.current!==capture||spellingSessionRef.current!==session){capture?.dispose();return;}
        spellingCaptureRef.current=null;
        if(researchDraftRef.current)researchDraftRef.current.quality=capture?.diagnostics();
        finishResearch("quality-rejected");capture?.dispose();setSpellingPhase("ready");
        setSpellingMessage(error instanceof Error?error.message:"Please record again.");
      }
      return;
    }
    const video=videoRef.current;
    if(!video||!video.videoWidth||!spellingSessionRef.current)return;
    if(researchConsentRef.current){researchDraftRef.current={promptId:researchPrompt,startedAt:performance.now(),context:{...researchContext}};setResearchPending(null);setResearchMessage("");setResearchConfirmed(false);setResearchIssue("none");}
    const capture=new FingerspellingCapture(video.videoWidth/video.videoHeight,FINGERSPELLING_CTC_MODEL.featureVersion??"v2",performance.now());
    spellingCaptureRef.current=capture;setSpellingPhase("capturing");
    spellingTimerRef.current=window.setTimeout(()=>{
      if(spellingCaptureRef.current!==capture)return;
      if(researchDraftRef.current)researchDraftRef.current.quality=capture.diagnostics();
      finishResearch("quality-rejected");capture.dispose();spellingCaptureRef.current=null;setSpellingPhase("ready");
      setSpellingMessage("Capture reached 16 seconds. Please record a shorter name.");
    },16000);
  }


  function endResearch() {
    researchConsentRef.current=false;researchDraftRef.current=null;setResearchConsent(false);
    setResearchPending(null);setResearchTrials([]);setResearchTruth("");setResearchExportConsent(false);setResearchMessage("");
    discardSpellingCapture();
  }
  function saveResearchResult() {
    if(!researchConsentRef.current||!researchPending||!researchConfirmed||researchTrials.length>=100)return;
    try {
      const trial=makeResearchTrial(researchPending,researchTruth,researchIssue);
      setResearchTrials(rows=>[...rows,trial]);setResearchPending(null);setResearchConfirmed(false);setResearchMessage("Saved in this tab.");
    }catch(error){setResearchMessage(error instanceof Error?error.message:"Unable to save result");}
  }
  function downloadResearch() {
    try {
      const payload=exportResearchMetrics(researchTrials,researchExportConsent,FINGERSPELLING_CTC_MODEL.sha256);
      const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:"application/json"})),a=document.createElement("a");
      a.href=url;a.download="signrelay-test-metrics.json";a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
      setResearchMessage("Downloaded text-free metrics. Review the file before sharing it.");
    }catch(error){setResearchMessage(error instanceof Error?error.message:"Export unavailable");}
  }

  function confirmSpelling() {
    if (spellingPhase !== "candidate" || !spellingCandidate.trim()) return;
    setSpellingText(text => (text + spellingCandidate).slice(0, MAX_FINGERSPELLING_TEXT));
    setSpellingCandidate(""); setSpellingPhase("ready"); setSpellingMessage("Candidate added. You can edit the draft.");
    spellingInputRef.current?.focus();
  }

  function editSpellingText(action: "backspace" | "space" | "clear") {
    if (["capturing", "processing", "candidate"].includes(spellingPhase)) discardSpellingCapture();
    setSpellingText(text => editSpelling(text, action));
    setSpellingMessage("");
    window.speechSynthesis?.cancel();
    spellingInputRef.current?.focus();
  }

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

          {selected === "asl" && FINGERSPELLING_ENABLED && (
            <div className="asl-mode-selector" role="group" aria-label="ASL recognition mode">
              <button type="button" aria-pressed={aslMode === "words"} onClick={() => changeAslMode("words")}>Word Recognition</button>
              <button type="button" aria-pressed={aslMode === "fingerspelling"} onClick={() => changeAslMode("fingerspelling")}>Fingerspelling</button>
            </div>
          )}

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

            {FINGERSPELLING_ENABLED && aslMode === "fingerspelling" && selected === "asl" && (
              <section className="transcript-panel fingerspelling-panel" aria-labelledby="fingerspelling-title">
                <div className="panel-heading"><h2 id="fingerspelling-title">Fingerspelling</h2></div>
                <div className="spelling-candidate" aria-label="Sequence candidate">
                  <strong style={{ fontSize: "1.5rem", overflowWrap: "anywhere", minWidth: 0 }}>{spellingCandidate || "—"}</strong>
                  <p role="status">{spellingPhase === "capturing" ? "Recording your fingerspelling. Finish when the name is complete."
                    : spellingPhase === "processing" ? "Recognising the captured sequence…"
                    : spellingPhase === "loading" ? "Loading sequence recognition…"
                    : FINGERSPELLING_MODEL.reason}</p>
                </div>
                <p className="calibration-message">Capture a name for 1–16 seconds, then finish and review the candidate. Keep one hand visible and include movement for J/Z and repeated letters. Research-only: every candidate is uncertain. Rare-letter and physical-handedness coverage remain limited. Check every character.</p>
                <p className="sr-only" role="status">{cameraState === "active" ? "Camera on. Hand tracking is running." : cameraMessage}</p>
                <label className="spelling-label" htmlFor="spelling-candidate-edit">Candidate for review</label>
                <input id="spelling-candidate-edit" value={spellingCandidate} maxLength={MAX_FINGERSPELLING_TEXT} disabled={spellingPhase!=="candidate"} autoComplete="off" spellCheck={false} onChange={e=>setSpellingCandidate(e.target.value)} />
                <label className="spelling-label" htmlFor="spelling-text">Composed text</label>
                <textarea id="spelling-text" ref={spellingInputRef} value={spellingText}
                  maxLength={MAX_FINGERSPELLING_TEXT} rows={4} spellCheck={false}
                  placeholder="Your word or name" aria-describedby="spelling-help"
                  onChange={event => { if (["capturing", "processing", "candidate"].includes(spellingPhase)) discardSpellingCapture(); setSpellingText(event.target.value); setSpellingMessage(""); window.speechSynthesis?.cancel(); }} />
                <p id="spelling-help" className="field-hint">Editable draft · stays here when you switch modes · not saved after reload.</p>
                <div className="spelling-actions" role="group" aria-label="Edit composed text">
                  <button type="button" className="button secondary small"
                    disabled={cameraState !== "active" || !["ready", "candidate", "capturing"].includes(spellingPhase)}
                    onClick={captureSpelling}>{spellingPhase === "capturing" ? (researchConsent ? "Finish test" : "Finish capture") : (researchConsent ? "Start test" : "Capture name")}</button>
                  <button type="button" className="button ghost small" disabled={!["capturing", "processing"].includes(spellingPhase)}
                    onClick={() => { discardSpellingCapture(); setSpellingMessage("Capture cancelled."); }}>Cancel capture</button>
                  <button type="button" className="button secondary small" disabled={spellingPhase !== "candidate" || !spellingCandidate.trim() || spellingText.length >= MAX_FINGERSPELLING_TEXT}
                    onClick={confirmSpelling}>Confirm text</button>
                  <button type="button" className="button ghost small" disabled={!spellingText} onClick={() => editSpellingText("backspace")}>Backspace</button>
                  <button type="button" className="button ghost small" disabled={spellingText.length >= MAX_FINGERSPELLING_TEXT} onClick={() => editSpellingText("space")}>Space</button>
                  <button type="button" className="button ghost small" disabled={!spellingText} onClick={() => editSpellingText("clear")}>Clear</button>
                  <button type="button" className="button secondary small" disabled={!spellingText.trim()} onClick={() => {
                    if (!("speechSynthesis" in window)) { setSpellingMessage("Speech output is unavailable in this browser."); return; }
                    speak(spellingText);
                  }}>Speak</button>
                  <button type="button" className="button ghost small" onClick={() => window.speechSynthesis?.cancel()}>Stop</button>
                </div>
                {spellingMessage && <p className="calibration-message" role="status">{spellingMessage}</p>}
                <p className="field-hint">Speech uses your existing volume and rate settings. Device voices may send spoken text to an online service.</p>

                <details className="workspace-disclosure spelling-reference" open={researchOpen} onToggle={event=>{
                  const open=event.currentTarget.open;setResearchOpen(open);
                  if(!open&&researchConsentRef.current)endResearch();
                }}>
                  <summary>Optional webcam testing</summary>
                  <div className="research-test" data-research-test>
                    <p>Research-only. Results stay in this tab. Camera images and landmarks are not uploaded or saved. Closing this panel clears the local test session.</p>
                    <label><input type="checkbox" checked={researchConsent} onChange={event=>{
                      researchConsentRef.current=event.target.checked;setResearchConsent(event.target.checked);
                      if(!event.target.checked)endResearch();
                    }} /> I choose to run local webcam tests and record their metrics in this tab.</label>
                    {researchConsent&&<>
                      <fieldset disabled={spellingPhase==="capturing"||spellingPhase==="processing"}>
                        <legend>Test setup</legend>
                        <label htmlFor="research-prompt">Action</label>
                        <select id="research-prompt" value={researchPrompt} onChange={event=>{
                          setResearchPrompt(event.target.value);setResearchTruth(RESEARCH_PROMPTS.find(p=>p.id===event.target.value)?.text??"");setResearchPending(null);setResearchConfirmed(false);
                        }}>{RESEARCH_PROMPTS.map(p=><option key={p.id} value={p.id}>{p.kind==="positive"?p.text:p.id==="rest"?"No hands":p.id==="wave"?"Wave":p.id==="wash"?"Handwashing":p.id==="clothing"?"Adjust clothing":"Other signing"}</option>)}</select>
                        <div className="research-context">
                          <label>Device<select aria-label="Test device" value={researchContext.device} onChange={e=>setResearchContext(c=>({...c,device:e.target.value as ResearchContext["device"]}))}>{["other","Windows","Mac","Android","iPhone"].map(x=><option key={x}>{x}</option>)}</select></label>
                          <label>Hand<select aria-label="Test hand" value={researchContext.hand} onChange={e=>setResearchContext(c=>({...c,hand:e.target.value as ResearchContext["hand"]}))}>{["Right","Left","both"].map(x=><option key={x}>{x}</option>)}</select></label>
                          <label>Lighting<select aria-label="Test lighting" value={researchContext.light} onChange={e=>setResearchContext(c=>({...c,light:e.target.value as ResearchContext["light"]}))}>{["front-lit","dim","back-lit"].map(x=><option key={x}>{x}</option>)}</select></label>
                          <label>Speed<select aria-label="Test speed" value={researchContext.speed} onChange={e=>setResearchContext(c=>({...c,speed:e.target.value as ResearchContext["speed"]}))}>{["usual","slow","fast"].map(x=><option key={x}>{x}</option>)}</select></label>
                        </div>
                      </fieldset>
                      <p><strong>{RESEARCH_PROMPTS.find(p=>p.id===researchPrompt)?.instruction}</strong> Use Start test and Finish test above. Keep every failed or unexpected result.</p>
                      {researchPending&&<div data-research-result>
                        <p>Raw prediction: <strong data-research-prediction>{researchPending.prediction||"No text"}</strong> · {researchPending.outcome}</p>
                        <p>{researchPending.quality?.frames??0} frames · {researchPending.quality?.observedFps.toFixed(1)??"—"} fps · {researchPending.quality?.missingFrames??0} missing hand observations · maximum gap {researchPending.quality?.maxFrameGapMs.toFixed(1)??"—"} ms · result after Finish {researchPending.finishToResultMs?.toFixed(1)??"—"} ms</p>
                        {RESEARCH_PROMPTS.find(p=>p.id===researchPending.promptId)?.kind==="positive"&&<label htmlFor="research-truth">What did you actually fingerspell?<input id="research-truth" value={researchTruth} maxLength={32} autoComplete="off" spellCheck={false} onChange={e=>{setResearchTruth(e.target.value);setResearchConfirmed(false);}} /></label>}
                        <label><input id="research-confirm-truth" type="checkbox" checked={researchConfirmed} onChange={e=>setResearchConfirmed(e.target.checked)} /> {RESEARCH_PROMPTS.find(p=>p.id===researchPending.promptId)?.kind==="positive"?"The corrected text matches what I signed.":"I performed the selected action without fingerspelling."}</label>
                        <label>Report a problem<select id="research-issue" value={researchIssue} onChange={e=>setResearchIssue(e.target.value as ResearchTrial["issue"])}>
                          <option value="none">No problem reported</option><option value="incorrect">Incorrect text</option><option value="missing">Missing recognition</option><option value="unexpected">Unexpected recognition</option><option value="tracking">Tracking or capture problem</option>
                        </select></label>
                        <button type="button" className="button secondary small" disabled={!researchConfirmed||researchTrials.length>=100} onClick={saveResearchResult}>Save local result</button>
                      </div>}
                      <p data-research-summary>{researchTrials.length}/100 local results · positives producing text {researchSummary(researchTrials).positiveCandidates}/{researchSummary(researchTrials).positive} · negative actions producing text {researchSummary(researchTrials).negativeCandidates}/{researchSummary(researchTrials).negative} · technical failures {researchSummary(researchTrials).technicalFailures}</p>
                      {!!researchTrials.length&&<details><summary>Review local results</summary><ol>{researchTrials.map((t,i)=><li key={i}>{RESEARCH_PROMPTS.find(p=>p.id===t.promptId)?.instruction} — {t.prediction||"No text"}; actual: {t.truth||"no letters expected"}; {t.outcome}; {t.issue}</li>)}</ol></details>}
                      <label><input id="research-export-consent" type="checkbox" checked={researchExportConsent} onChange={e=>setResearchExportConsent(e.target.checked)} /> Include only text-free metrics in a file I choose to download. No video, landmarks, names, device identifiers or absolute timestamps.</label>
                      <div className="spelling-actions">
                        <button type="button" className="button secondary small" disabled={!researchExportConsent||!researchTrials.length} onClick={downloadResearch}>Download test metrics</button>
                        <button type="button" className="button ghost small" onClick={endResearch}>End testing and clear results</button>
                      </div>
                    </>}
                    {researchMessage&&<p role="status">{researchMessage}</p>}
                  </div>
                </details>

                <details className="workspace-disclosure spelling-reference">
                  <summary>Alphabet &amp; first-use notes</summary>
                  <p>{ASL_ALPHABET.join(" · ")}</p>
                  <p>J and Z require movement. Similar handshapes need careful evaluation. This list is an alphabet reference, not a list of supported letters.</p>
                  <p>No text is inserted or spoken automatically. This small sequence pilot was trained independently on licensed FSboard data. Webcam accuracy and rejection of ordinary hand movement still need validation.</p>
                </details>
              </section>
            )}
            <section className="transcript-panel" hidden={aslMode === "fingerspelling"} aria-labelledby="transcript-title" data-tour="transcript">
              <div className="panel-heading">
                <h2 id="transcript-title" ref={transcriptHeadingRef} tabIndex={-1}>Transcript</h2>
                <div className={`recognition-state ${status.tone}`} data-status={status.key} data-worker-state={recognitionState}>
                  <span aria-hidden="true" /> {status.chip}
                </div>
              </div>

              {STARTER_OUTPUT === "auto" && (
                <p className="research-build-banner" data-research-build={starterAutoActive ? "auto" : "suggest"}>
                  {starterAutoActive ? "Research build: sign-rule words are added automatically. Not for public use."
                    : "Research build opened from a public address: sign-rule words are suggestions only."}
                </p>
              )}
              <div className="candidate-bar">
                {status.key === "checking-sign" && <span className="candidate-label">Possible match · not confirmed</span>}
                <strong>{status.key === "checking-sign" ? candidate : status.detail}</strong>
              </div>
              {recognitionFeedback && <p className="calibration-message">{recognitionFeedback}</p>}
              {(suggestions.visible.length > 0 || suggestions.waiting.length > 0 || suggestions.missed.length > 0) && (
                <div className="model-suggestions" ref={suggestionPanelRef} role="region" aria-label="Suggestions not yet added"
                  onPointerEnter={() => {
                    suggestionPointerInsideRef.current = true;
                    holdPending(true);
                  }}
                  onPointerLeave={event => {
                    suggestionPointerInsideRef.current = false;
                    holdPending(event.currentTarget.contains(document.activeElement));
                  }}
                  onFocus={() => holdPending(true)}
                  onBlur={event => {
                    const nextFocus = event.relatedTarget;
                    if (!(nextFocus instanceof Node) || !event.currentTarget.contains(nextFocus)) holdPending(suggestionPointerInsideRef.current);
                  }}>
                  {suggestions.visible.length > 0 && <p className="model-suggestions-note">Not in the transcript. Add a word only if it is what you signed.</p>}
                  {suggestions.visible.map(item => {
                    const armed = isArmed(item, suggestionClock);
                    const title = `suggestion-title-${item.key.replace(/[^a-z0-9]/gi, "-")}`;
                    return (
                      <div className={`model-suggestion ${item.source}`} key={item.key} role="group" aria-labelledby={title} data-suggestion-key={item.key}
                        data-suggestion-source={item.source} data-armed={armed}>
                        <p className="model-suggestion-label" id={title}>{item.source === "model" ? `Experimental suggestion · ${model.shortName} research model` : "Possible sign · built-in sign rules"}</p>
                        <strong className="model-suggestion-word">{item.text}</strong>
                        {item.repeats > 1 && <span className="model-suggestion-repeats" data-suggestion-repeats={item.repeats}>Recognised {item.repeats} times</span>}
                        <div className="model-suggestion-actions">
                          <button type="button" className="button secondary small" aria-disabled={!armed} data-suggestion-action="accept"
                            onClick={() => acceptPendingSuggestion(item.key)}>
                            <Plus aria-hidden="true" size={16} />Add “{item.text}”
                          </button>
                          <button type="button" className="button ghost small" data-suggestion-action="dismiss"
                            onClick={() => dismissPendingSuggestion(item.key)} aria-label={`Dismiss suggestion ${item.text}`}>
                            <X aria-hidden="true" size={16} />Dismiss
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {suggestions.waiting.length > 0 && <p className="model-suggestions-meta" data-suggestions-waiting={suggestions.waiting.length}>
                    {suggestions.waiting.length} more waiting</p>}
                  {suggestions.missed.length > 0 && <p className="model-suggestions-meta" data-suggestions-missed>
                    Not added: {suggestions.missed.map(item => item.text).join(", ")}</p>}
                </div>
              )}
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
                          <p>{entry.text}<span className="entry-provenance">{provenanceLabel(entry)}</span></p>
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
            <details className="calibration-panel workspace-disclosure vocabulary-disclosure" id="personal-vocabulary" ref={vocabularyRef} data-taught={trainedGlosses.size} hidden={aslMode === "fingerspelling"}>
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
                <p className="model-detail-copy">{model.status === "experimental" ? model.id === "asl"
                  ? `${ASL_VOCABULARY_COUNTS.installed.toLocaleString()} installed ASL labels; ${ASL_VOCABULARY_COUNTS.experimental.toLocaleString()} observed working at least once on unseen signers' clips; ${ASL_VOCABULARY_COUNTS.validated.toLocaleString()} independently validated · ${model.version}. An installed label is not a recognised sign. This is an isolated-sign research model, not a continuous sign-language interpreter.`
                  : `${model.automaticVocabularyCount.toLocaleString()} automatic ${model.shortName} test signs · ${model.version}. This is an isolated-sign research model, not a validated continuous sign-language interpreter.` : model.status === "preparing" ? `No shared automatic ${model.shortName} model is installed. Recognition uses only the private signs you teach.` : `${model.vocabulary.length.toLocaleString()} ${model.shortName} starter labels are available to teach. Labels are not pre-trained translations.`} Personal examples store normalised landmarks, never camera video.</p>
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

/** Where a transcript word came from, shown beside it. */
function provenanceLabel(entry: TranscriptEntry) {
  if (entry.acceptedBy === "user") return entry.source === "model" ? " · added by you (research model)" : " · added by you (sign rules)";
  if (entry.source === "personal") return " · your sign";
  if (entry.source === "starter") return " · sign rules";
  return "";
}
