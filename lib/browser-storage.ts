import { isLanguageId, type LanguageId } from "./model-adapters";

export type TranscriptEntry = {
  id: string;
  text: string;
  gloss: string;
  confidence: number;
  timestamp: number;
  source?: "personal" | "starter" | "model";
};

export type TranscriptSession = {
  id: string;
  language: LanguageId;
  createdAt: number;
  entries: TranscriptEntry[];
};

export type SpeechSettings = {
  autoSpeak: boolean;
  volume: number;
  rate: number;
  showOverlay: boolean;
};

const SETTINGS_KEY = "signrelay.settings.v1";
const HISTORY_KEY = "signrelay.history.v1";

export const DEFAULT_SETTINGS: SpeechSettings = {
  autoSpeak: false,
  volume: 0.9,
  rate: 0.95,
  showOverlay: true,
};

export function loadSettings(): SpeechSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const value = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    return {
      autoSpeak: typeof value?.autoSpeak === "boolean" ? value.autoSpeak : false,
      showOverlay: typeof value?.showOverlay === "boolean" ? value.showOverlay : true,
      volume: Number.isFinite(value?.volume) ? Math.max(0, Math.min(1, value.volume)) : DEFAULT_SETTINGS.volume,
      rate: Number.isFinite(value?.rate) ? Math.max(0.5, Math.min(2, value.rate)) : DEFAULT_SETTINGS.rate,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: SpeechSettings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* Device storage may be unavailable. */ }
}

export function loadHistory(): TranscriptSession[] {
  if (typeof window === "undefined") return [];
  try {
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(history) ? history.filter(validSession).slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function saveSession(session: TranscriptSession) {
  if (!validSession(session) || !session.entries.length) return false;
  const history = loadHistory();
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify([session, ...history].slice(0, 8)));
    return true;
  } catch { return false; }
}

function validSession(value: unknown): value is TranscriptSession {
  if (!value || typeof value !== "object") return false;
  const s = value as TranscriptSession;
  return typeof s.id === "string" && s.id.length <= 100 && isLanguageId(s.language)
    && Number.isFinite(s.createdAt) && Array.isArray(s.entries) && s.entries.length <= 5000
    && s.entries.every(e => e && typeof e.id === "string" && e.id.length <= 100
      && typeof e.text === "string" && e.text.length <= 500 && typeof e.gloss === "string" && e.gloss.length <= 500
      && Number.isFinite(e.timestamp) && Number.isFinite(e.confidence) && e.confidence >= 0 && e.confidence <= 1);
}

/** First-run tour progress. The version is in the key, so a substantially new
 * tour can be shown once more by moving to a new key. */
export const ONBOARDING_KEY = "signrelay.onboarding.v1";
export type OnboardingStatus = "completed" | "dismissed";

/** "due" only when storage can be read and holds no valid record. If storage
 * is blocked the choice could not be remembered, so the tour is not forced on
 * every visit; it stays available from "Take a tour". */
export function onboardingState(): OnboardingStatus | "due" | "unavailable" {
  if (typeof window === "undefined") return "unavailable";
  let stored: string | null;
  try { stored = localStorage.getItem(ONBOARDING_KEY); } catch { return "unavailable"; }
  try {
    const value = JSON.parse(stored ?? "null");
    return value && (value.status === "completed" || value.status === "dismissed") && Number.isFinite(value.at) ? value.status : "due";
  } catch {
    return "due";
  }
}

export function saveOnboarding(status: OnboardingStatus) {
  try { localStorage.setItem(ONBOARDING_KEY, JSON.stringify({ status, at: Date.now() })); return true; } catch { return false; }
}

/** False when browser storage refused; clearing site data in the browser remains available. */
export function clearLocalSignRelayData() {
  try {
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(HISTORY_KEY);
    localStorage.removeItem(ONBOARDING_KEY);
    return true;
  } catch {
    return false;
  }
}
