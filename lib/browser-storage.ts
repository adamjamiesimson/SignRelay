import type { LanguageId } from "./model-adapters";

export type TranscriptEntry = {
  id: string;
  text: string;
  gloss: string;
  confidence: number;
  timestamp: number;
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

const SETTINGS_KEY = "signbridge.settings.v1";
const HISTORY_KEY = "signbridge.history.v1";

export const DEFAULT_SETTINGS: SpeechSettings = {
  autoSpeak: false,
  volume: 0.9,
  rate: 0.95,
  showOverlay: true,
};

export function loadSettings(): SpeechSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: SpeechSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadHistory(): TranscriptSession[] {
  if (typeof window === "undefined") return [];
  try {
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(history) ? history : [];
  } catch {
    return [];
  }
}

export function saveSession(session: TranscriptSession) {
  if (!session.entries.length) return;
  const history = loadHistory();
  localStorage.setItem(HISTORY_KEY, JSON.stringify([session, ...history].slice(0, 8)));
}

export function clearLocalSignBridgeData() {
  localStorage.removeItem(SETTINGS_KEY);
  localStorage.removeItem(HISTORY_KEY);
}
