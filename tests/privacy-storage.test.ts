import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, loadHistory, loadSettings, saveSession, saveSettings } from "../lib/browser-storage";
import { CONSENT_KEY, CONSENT_MAX_AGE, readConsent, startAnalytics } from "../lib/analytics-consent";
import { createCustomVocabularyEntry } from "../lib/model-adapters";
import { validCalibrationTemplate } from "../lib/calibration-storage";

afterEach(() => vi.unstubAllGlobals());
function storage(values: Record<string, string> = {}) {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: (key: string) => values[key] ?? null, setItem: vi.fn() });
}
describe("untrusted and unavailable browser storage", () => {
  it("validates settings instead of trusting stored object properties", () => {
    storage({ "signrelay.settings.v1": JSON.stringify({ autoSpeak: "true", volume: 50, rate: -1, showOverlay: null }) });
    expect(loadSettings()).toEqual({ autoSpeak: false, volume: 1, rate: 0.5, showOverlay: true });
  });
  it("rejects malformed history and invalid entries", () => {
    storage({ "signrelay.history.v1": JSON.stringify([null, {}, { entries: [{ text: {} }] }]) });
    expect(loadHistory()).toEqual([]);
  });
  it("handles browser storage denial without crashing", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } });
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(DEFAULT_SETTINGS)).not.toThrow();
    expect(saveSession({ id: "1", language: "asl", createdAt: 1, entries: [{ id: "1", text: "Hello", gloss: "HELLO", timestamp: 1, confidence: 0.9 }] })).toBe(false);
  });
  it("rejects oversized labels and invalid landmark sequences", () => {
    expect(createCustomVocabularyEntry("a".repeat(49))).toBeNull();
    expect(createCustomVocabularyEntry("<>")).toBeNull();
    const t = { id: "a", gloss: "HELLO", text: "Hello", createdAt: 1, frames: Array.from({ length: 24 }, () => Array(240).fill(0)) };
    expect(validCalibrationTemplate(t)).toBe(true);
    t.frames[0][0] = Infinity;
    expect(validCalibrationTemplate(t)).toBe(false);
  });
  it("accepts the expanded language IDs but rejects invented ones", () => {
    const frames = Array.from({ length: 24 }, () => Array(240).fill(0));
    expect(validCalibrationTemplate({ id: "uae", language: "uaesl", gloss: "HELP", text: "Help", createdAt: 1, frames })).toBe(true);
    expect(validCalibrationTemplate({ id: "bad", language: "made-up", gloss: "HELP", text: "Help", createdAt: 1, frames })).toBe(false);
  });
});
describe("privacy defaults", () => {
  it("rejects absent, malformed, future and expired consent", () => {
    for (const value of ["null", "{", JSON.stringify({ choice: "accepted", savedAt: Date.now() + 60000 }), JSON.stringify({ choice: "accepted", savedAt: Date.now() - CONSENT_MAX_AGE - 1 })]) {
      storage({ [CONSENT_KEY]: value }); expect(readConsent()).toBeNull();
    }
  });
  it("retains a valid rejection and never starts analytics without an ID", () => {
    storage({ [CONSENT_KEY]: JSON.stringify({ choice: "rejected", savedAt: Date.now() }) });
    expect(readConsent()).toBe("rejected");
    // No document or navigator is provided: no script or network work should run.
    expect(() => startAnalytics()).not.toThrow();
  });
});
