import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { SUGGESTION_ARMING_MS, SUGGESTION_LIFETIME_MS, SUGGEST_ONLY_MODEL_LANGUAGES, modelWordsNeedAcceptance } from "../lib/model-output-policy";
import { acceptSuggestion, isExpired, suggestionFromMessage } from "../lib/model-suggestion";
import { RecognitionSession } from "../lib/recognition-session";
import type { WorkerConfirmation, WorkerMessage, WorkerSuggestion } from "../lib/vision-types";

const suggested = (over: Partial<WorkerSuggestion> = {}): WorkerSuggestion => ({ type: "suggested", session: 3, id: "s1", language: "asl",
  text: "Book", gloss: "BOOK", confidence: 0.94, timestamp: 1000, source: "model", ...over });
const confirmed = (source: WorkerConfirmation["source"]): WorkerConfirmation => ({ type: "confirmed", session: 3, text: "Book", gloss: "BOOK",
  confidence: 0.94, timestamp: 1000, source });

describe("F1 policy", () => {
  it("routes ASL research-model words to suggestions and has no runtime override", () => {
    expect(modelWordsNeedAcceptance("asl")).toBe(true);
    expect([...SUGGEST_ONLY_MODEL_LANGUAGES]).toEqual(["asl"]);
    // Other languages are unchanged in this change (documented as an owner decision).
    for (const language of ["bsl", "isl", "lse", "psl"] as const) expect(modelWordsNeedAcceptance(language)).toBe(false);
    const policy = readFileSync("lib/model-output-policy.ts", "utf8");
    expect(policy).not.toMatch(/process\.env|localStorage|location|searchParams/);
  });
});

describe("suggestion lifecycle", () => {
  it("offers a worker suggestion only for the language on screen", () => {
    expect(suggestionFromMessage(suggested(), "asl", 50)).toMatchObject({ key: "3:s1", text: "Book", shownAt: 50 });
    expect(suggestionFromMessage(suggested({ language: "asl" }), "bsl", 50)).toBeNull();
  });
  it("demotes a model-only ASL confirmation (for example from an older cached worker) to a suggestion", () => {
    expect(suggestionFromMessage(confirmed("model"), "asl", 50)).toMatchObject({ text: "Book" });
    expect(suggestionFromMessage(confirmed("starter"), "asl", 50)).toBeNull();
    expect(suggestionFromMessage(confirmed("personal"), "asl", 50)).toBeNull();
    expect(suggestionFromMessage(confirmed("model"), "bsl", 50)).toBeNull();
  });
  it("accepts only the suggestion on screen, once it is readable and before it expires", () => {
    const current = suggestionFromMessage(suggested(), "asl", 1000)!;
    expect(acceptSuggestion(null, "3:s1", "asl", 5000)).toEqual({ accepted: false, reason: "none" });
    expect(acceptSuggestion(current, "3:s0", "asl", 5000)).toEqual({ accepted: false, reason: "stale" });
    expect(acceptSuggestion(current, "3:s1", "bsl", 5000)).toEqual({ accepted: false, reason: "language" });
    expect(acceptSuggestion(current, "3:s1", "asl", 1000 + SUGGESTION_ARMING_MS - 1)).toEqual({ accepted: false, reason: "too-soon" });
    expect(acceptSuggestion(current, "3:s1", "asl", 1000 + SUGGESTION_LIFETIME_MS + 1)).toEqual({ accepted: false, reason: "expired" });
    const outcome = acceptSuggestion(current, "3:s1", "asl", 1000 + SUGGESTION_ARMING_MS);
    expect(outcome).toMatchObject({ accepted: true, entry: { text: "Book", gloss: "BOOK", source: "model", acceptedBy: "user" } });
    expect(isExpired(current, 1000 + SUGGESTION_LIFETIME_MS + 1)).toBe(true);
  });
  it("cannot accept twice: once the caller clears the suggestion, a repeated activation finds nothing", () => {
    let current: ReturnType<typeof suggestionFromMessage> = suggestionFromMessage(suggested(), "asl", 0);
    const first = acceptSuggestion(current, "3:s1", "asl", 2000);
    expect(first.accepted).toBe(true);
    current = null; // what the workspace does on acceptance
    expect(acceptSuggestion(current, "3:s1", "asl", 2001)).toEqual({ accepted: false, reason: "none" });
  });
  it("keys suggestions by session, so a restarted worker's s1 never matches an old button", () => {
    const old = suggestionFromMessage(suggested({ session: 3 }), "asl", 0)!;
    const fresh = suggestionFromMessage(suggested({ session: 4 }), "asl", 0)!;
    expect(old.key).not.toBe(fresh.key);
    expect(acceptSuggestion(fresh, old.key, "asl", 5000)).toEqual({ accepted: false, reason: "stale" });
  });
});

describe("RecognitionSession forwards suggestions only from the live session", () => {
  it("drops a suggestion from a replaced session and delivers the current one", () => {
    const received: WorkerMessage[] = [];
    const workers: { onmessage: ((event: { data: WorkerMessage }) => void) | null; onerror: null; onmessageerror: null; postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn> }[] = [];
    const session = new RecognitionSession(() => {
      const worker = { onmessage: null, onerror: null, onmessageerror: null, postMessage: vi.fn(), terminate: vi.fn() };
      workers.push(worker);
      return worker as unknown as Worker;
    }, message => received.push(message), () => {});
    session.postMessage({ type: "templates", language: "asl", templates: [] });
    const first = workers[0].postMessage.mock.calls.at(-1)![0].session as number;
    session.postMessage({ type: "reset" });
    const current = workers[0].postMessage.mock.calls.at(-1)![0].session as number;
    expect(current).not.toBe(first);
    workers[0].onmessage!({ data: suggested({ session: first, id: "old" }) });
    workers[0].onmessage!({ data: suggested({ session: current, id: "live" }) });
    expect(received.map(m => (m as WorkerSuggestion).id)).toEqual(["live"]);
    session.terminate();
  });
});

describe("workspace wiring (source review)", () => {
  const source = readFileSync("components/translator-experience.tsx", "utf8");
  const handler = source.slice(source.indexOf("const handleWorkerMessage"), source.indexOf("const handleWorkerMessage") + 2600);
  it("offers a suggestion before the confirmed path and never speaks or inserts it there", () => {
    const offered = handler.slice(handler.indexOf("const offered"), handler.indexOf("if (message.type !== \"confirmed\") return;"));
    expect(offered).toMatch(/setSuggestion\(offered\)/);
    expect(offered).not.toMatch(/speak\(|setEntries|entriesRef\.current =/);
  });
  it("inserts a model word only through acceptSuggestion, from an explicit button press", () => {
    expect(source.match(/acceptPendingSuggestion\(/g)?.length).toBe(1); // the Add button is the only call site
    expect(source).toMatch(/onClick=\{\(\) => \{ if \(suggestionArmed\) acceptPendingSuggestion\(suggestion\.key\); \}\}/);
    expect(source).not.toMatch(/onKeyDown=\{[^}]*acceptPendingSuggestion/);
  });
  it("withdraws suggestions on language, mode, camera, worker and transcript changes, and on expiry", () => {
    expect(source).toMatch(/useEffect\(\(\) => \{ withdrawSuggestion\(\); \}, \[selected, aslMode, step, withdrawSuggestion\]\)/);
    expect(source).toMatch(/if \(cameraState !== "active"\) withdrawSuggestion\(\)/);
    expect(source).toMatch(/if \(status\.state !== "running"\) withdrawSuggestion\(\)/);
    expect(source).toMatch(/SUGGESTION_LIFETIME_MS\);/);
    expect(source.slice(source.indexOf("const clearTranscript"), source.indexOf("const clearTranscript") + 600)).toMatch(/withdrawSuggestion\(\)/);
  });
  it("uses a new worker URL version so a cached pre-safeguard worker is never reused", () => {
    expect(source).toMatch(/recognition\.worker\.js\?v=f1-suggestions-1/);
    expect(source).not.toMatch(/tracking-temporal-3/);
  });
});
