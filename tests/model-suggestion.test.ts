import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { LANGUAGE_IDS } from "../lib/model-adapters";
import { MAX_PENDING_SUGGESTIONS, SUGGESTION_ARMING_MS, SUGGESTION_LIFETIME_MS, SUGGEST_ONLY_MODEL_LANGUAGES, modelWordsNeedAcceptance,
  starterWordsNeedAcceptance } from "../lib/model-output-policy";
import { acceptSuggestion, isExpired, offerSuggestion, suggestionFromMessage, unexpired, withoutSuggestion } from "../lib/model-suggestion";
import { RecognitionSession } from "../lib/recognition-session";
import { STARTER_OUTPUT_FLAG, resolveStarterOutput } from "../lib/release-flags.mjs";
import type { WorkerConfirmation, WorkerMessage, WorkerSuggestion } from "../lib/vision-types";

const suggested = (over: Partial<WorkerSuggestion> = {}): WorkerSuggestion => ({ type: "suggested", session: 3, id: "s1", language: "asl",
  text: "Book", gloss: "BOOK", confidence: 0.94, timestamp: 1000, source: "model", ...over });
const confirmed = (source: WorkerConfirmation["source"], gloss = "BOOK", timestamp = 1000): WorkerConfirmation => ({ type: "confirmed", session: 3, text: gloss, gloss,
  confidence: 0.94, timestamp, source });

describe("output policy", () => {
  it("routes every language's research-model words to suggestions, with no runtime override", () => {
    expect([...SUGGEST_ONLY_MODEL_LANGUAGES].sort()).toEqual([...LANGUAGE_IDS].sort());
    for (const language of ["asl", "bsl", "isl", "lse", "psl"] as const) expect(modelWordsNeedAcceptance(language)).toBe(true);
    const policy = readFileSync("lib/model-output-policy.ts", "utf8");
    expect(policy).not.toMatch(/process\.env|localStorage|location|searchParams/);
  });
  it("makes starter-rule words suggestions unless a research build opts in to automatic confirmation", () => {
    expect(starterWordsNeedAcceptance("suggest")).toBe(true);
    expect(starterWordsNeedAcceptance("auto")).toBe(false);
    expect(resolveStarterOutput({})).toBe("suggest");
    expect(resolveStarterOutput({ NEXT_PUBLIC_SIGNRELAY_PROFILE: "full" })).toBe("suggest");
    expect(resolveStarterOutput({ NEXT_PUBLIC_SIGNRELAY_PROFILE: "asl-demo" })).toBe("suggest");
    expect(resolveStarterOutput({ VERCEL_ENV: "preview" })).toBe("suggest");
    expect(resolveStarterOutput({ NEXT_PUBLIC_SIGNRELAY_PROFILE: "rehearsal" })).toBe("auto");
    expect(resolveStarterOutput({ [STARTER_OUTPUT_FLAG]: "auto" })).toBe("auto");
    expect(resolveStarterOutput({ [STARTER_OUTPUT_FLAG]: "suggest", NEXT_PUBLIC_SIGNRELAY_PROFILE: "rehearsal" })).toBe("suggest");
    for (const bad of ["on", "true", "AUTO"]) expect(() => resolveStarterOutput({ [STARTER_OUTPUT_FLAG]: bad })).toThrow();
    expect(readFileSync("next.config.ts", "utf8")).toMatch(/NEXT_PUBLIC_SIGNRELAY_STARTER_OUTPUT: resolveStarterOutput\(process\.env\)/);
    expect(readFileSync("scripts/prepare-export.mjs", "utf8")).toMatch(/STARTER_OUTPUT_FLAG/);
  });
});

describe("suggestion lifecycle", () => {
  it("offers a worker suggestion only for the language on screen", () => {
    expect(suggestionFromMessage(suggested(), "asl", 50)).toMatchObject({ key: "3:s1", text: "Book", source: "model", shownAt: 50 });
    expect(suggestionFromMessage(suggested({ language: "asl" }), "bsl", 50)).toBeNull();
  });
  it("demotes any language's model-only confirmation (e.g. an older cached worker) to a suggestion", () => {
    for (const language of ["asl", "bsl", "isl", "lse", "psl"] as const) expect(suggestionFromMessage(confirmed("model"), language, 50)).toMatchObject({ source: "model" });
  });
  it("turns starter words into suggestions under the suggest policy and leaves personal signs automatic", () => {
    expect(suggestionFromMessage(confirmed("starter", "HELLO"), "asl", 50, "suggest")).toMatchObject({ source: "starter", text: "HELLO" });
    expect(suggestionFromMessage(confirmed("starter", "HELLO"), "asl", 50, "auto")).toBeNull();
    expect(suggestionFromMessage(confirmed("personal"), "asl", 50, "suggest")).toBeNull();
    expect(suggestionFromMessage(confirmed("personal"), "bsl", 50, "suggest")).toBeNull();
  });
  it("accepts only a suggestion on screen, once it is readable and before it expires, keeping its provenance", () => {
    const model = suggestionFromMessage(suggested(), "asl", 1000)!;
    const rule = suggestionFromMessage(confirmed("starter", "HELLO", 999), "asl", 1000, "suggest")!;
    const list = offerSuggestion([model], rule);
    expect(acceptSuggestion(null, "3:s1", "asl", 5000)).toEqual({ accepted: false, reason: "none" });
    expect(acceptSuggestion(list, "3:s0", "asl", 5000)).toEqual({ accepted: false, reason: "stale" });
    expect(acceptSuggestion(list, "3:s1", "bsl", 5000)).toEqual({ accepted: false, reason: "language" });
    expect(acceptSuggestion(list, "3:s1", "asl", 1000 + SUGGESTION_ARMING_MS - 1)).toEqual({ accepted: false, reason: "too-soon" });
    expect(acceptSuggestion(list, "3:s1", "asl", 1000 + SUGGESTION_LIFETIME_MS + 1)).toEqual({ accepted: false, reason: "expired" });
    expect(acceptSuggestion(list, "3:s1", "asl", 1000 + SUGGESTION_ARMING_MS)).toMatchObject({ accepted: true, entry: { gloss: "BOOK", source: "model", acceptedBy: "user" } });
    expect(acceptSuggestion(list, rule.key, "asl", 1000 + SUGGESTION_ARMING_MS)).toMatchObject({ accepted: true, entry: { gloss: "HELLO", source: "starter", acceptedBy: "user" } });
    expect(isExpired(model, 1000 + SUGGESTION_LIFETIME_MS + 1)).toBe(true);
  });
  it("cannot accept twice: once removed, a repeated activation finds nothing", () => {
    let list = [suggestionFromMessage(suggested(), "asl", 0)!];
    expect(acceptSuggestion(list, "3:s1", "asl", 2000).accepted).toBe(true);
    list = withoutSuggestion(list, "3:s1");
    expect(acceptSuggestion(list, "3:s1", "asl", 2001)).toEqual({ accepted: false, reason: "none" });
  });
  it("keeps at most three, newest first; a repeated word replaces its own older card; expired ones drop out", () => {
    let list: ReturnType<typeof offerSuggestion> = [];
    for (const [i, gloss] of ["HELLO", "PLEASE", "SORRY", "YES"].entries()) list = offerSuggestion(list, suggestionFromMessage(confirmed("starter", gloss, i), "asl", i * 1000, "suggest")!);
    expect(list.map(item => item.gloss)).toEqual(["YES", "SORRY", "PLEASE"]);
    expect(list).toHaveLength(MAX_PENDING_SUGGESTIONS);
    list = offerSuggestion(list, suggestionFromMessage(confirmed("starter", "SORRY", 9), "asl", 9000, "suggest")!);
    expect(list.map(item => item.gloss)).toEqual(["SORRY", "YES", "PLEASE"]);
    expect(unexpired(list, 2000 + SUGGESTION_LIFETIME_MS + 1).map(item => item.gloss)).toEqual(["SORRY", "YES"]);
  });
  it("keys suggestions by session, so a restarted worker's s1 never matches an old button", () => {
    const old = suggestionFromMessage(suggested({ session: 3 }), "asl", 0)!;
    const fresh = suggestionFromMessage(suggested({ session: 4 }), "asl", 0)!;
    expect(old.key).not.toBe(fresh.key);
    expect(acceptSuggestion([fresh], old.key, "asl", 5000)).toEqual({ accepted: false, reason: "stale" });
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
  it("offers a suggestion (build policy for starter words) before the confirmed path and never speaks or inserts it there", () => {
    const offered = handler.slice(handler.indexOf("const offered"), handler.indexOf("if (message.type !== \"confirmed\") return;"));
    expect(offered).toMatch(/suggestionFromMessage\(message, selectedRef\.current, Date\.now\(\), STARTER_OUTPUT\)/);
    expect(offered).toMatch(/setPending\(offerSuggestion\(/);
    expect(offered).not.toMatch(/speak\(|setEntries|entriesRef\.current =/);
  });
  it("inserts a suggested word only through acceptSuggestion, from an explicit button press", () => {
    expect(source.match(/acceptPendingSuggestion\(/g)?.length).toBe(1); // the Add button is the only call site
    expect(source).toMatch(/onClick=\{\(\) => \{ if \(armed\) acceptPendingSuggestion\(item\.key\); \}\}/);
    expect(source).not.toMatch(/onKeyDown=\{[^}]*acceptPendingSuggestion/);
  });
  it("withdraws suggestions on language, mode, camera, worker and transcript changes, and on expiry", () => {
    expect(source).toMatch(/useEffect\(\(\) => \{ withdrawSuggestion\(\); \}, \[selected, aslMode, step, withdrawSuggestion\]\)/);
    expect(source).toMatch(/if \(cameraState !== "active"\) withdrawSuggestion\(\)/);
    expect(source).toMatch(/if \(status\.state !== "running"\) withdrawSuggestion\(\)/);
    expect(source).toMatch(/unexpired\(suggestionsRef\.current, Date\.now\(\)\)/);
    expect(source.slice(source.indexOf("const clearTranscript"), source.indexOf("const clearTranscript") + 600)).toMatch(/withdrawSuggestion\(\)/);
  });
  it("uses a new worker URL version so a cached older worker is never reused", () => {
    expect(source).toMatch(/recognition\.worker\.js\?v=output-policy-2/);
    expect(source).not.toMatch(/tracking-temporal-3|f1-suggestions-1/);
  });
  it("labels every transcript word's provenance", () => {
    expect(source).toMatch(/added by you \(research model\)/);
    expect(source).toMatch(/added by you \(sign rules\)/);
    expect(source).toMatch(/" · your sign"/);
    expect(source).toMatch(/" · sign rules"/);
  });
});
