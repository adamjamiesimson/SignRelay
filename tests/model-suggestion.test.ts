import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { LANGUAGE_IDS } from "../lib/model-adapters";
import { MAX_MISSED_NOTES, MAX_PENDING_SUGGESTIONS, MISSED_NOTE_LIFETIME_MS, SUGGESTION_ARMING_MS, SUGGESTION_LIFETIME_MS, SUGGESTION_RELEASE_GRACE_MS,
  SUGGEST_ONLY_MODEL_LANGUAGES, canConfirmAutomatically, modelWordsNeedAcceptance, starterWordsNeedAcceptance } from "../lib/model-output-policy";
import { EMPTY_SUGGESTIONS, acceptSuggestion, announceSuggestion, holdSuggestions, insertBySigningTime, isArmed, nextSuggestionDeadline, offerSuggestion,
  removeSuggestion, suggestionFromMessage, tickSuggestions, type PendingSuggestion, type SuggestionState } from "../lib/model-suggestion";
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
  it("makes starter-rule words suggestions unless a research export makes them automatic (tests/starter-output-policy.test.ts)", () => {
    expect(starterWordsNeedAcceptance("suggest")).toBe(true);
    expect(starterWordsNeedAcceptance("auto")).toBe(false);
    expect(resolveStarterOutput({})).toBe("suggest");
    expect(resolveStarterOutput({ NEXT_PUBLIC_SIGNRELAY_PROFILE: "rehearsal" })).toBe("auto");
    expect(() => resolveStarterOutput({ [STARTER_OUTPUT_FLAG]: "auto" })).toThrow();
    expect(readFileSync("scripts/prepare-export.mjs", "utf8")).toMatch(/STARTER_OUTPUT_FLAG/);
  });
  it("allows only attributed personal signs or locally authorized ASL starter rules to enter automatically", () => {
    for (const language of LANGUAGE_IDS) {
      expect(canConfirmAutomatically("personal", language, "suggest")).toBe(true);
      expect(canConfirmAutomatically("starter", language, "suggest")).toBe(false);
      expect(canConfirmAutomatically("starter", language, "auto")).toBe(language === "asl");
      expect(canConfirmAutomatically("model", language, "auto")).toBe(false);
      expect(canConfirmAutomatically(undefined, language, "auto")).toBe(false);
    }
  });
});

const starter = (gloss: string, signedAt: number, now: number) => suggestionFromMessage(confirmed("starter", gloss, signedAt), "asl", now, "suggest")!;
const offer = (state: SuggestionState, item: PendingSuggestion, now = item.receivedAt) => offerSuggestion(state, item, now).state;
const glosses = (state: SuggestionState) => state.visible.map(item => item.gloss);

describe("suggestion lifecycle", () => {
  it("offers a worker suggestion only for the language on screen, timed on the recognition clock", () => {
    expect(suggestionFromMessage(suggested(), "asl", 50)).toMatchObject({ key: "3:s1", text: "Book", source: "model", signedAt: 1000, shownAt: 50,
      armedAt: 50 + SUGGESTION_ARMING_MS, expiresAt: 50 + SUGGESTION_LIFETIME_MS, repeats: 1 });
    expect(suggestionFromMessage(suggested({ language: "asl" }), "bsl", 50)).toBeNull();
  });
  it("demotes any language's model-only confirmation (e.g. an older cached worker) to a suggestion", () => {
    for (const language of ["asl", "bsl", "isl", "lse", "psl"] as const) expect(suggestionFromMessage(confirmed("model"), language, 50)).toMatchObject({ source: "model" });
  });
  it("turns starter words into suggestions under the suggest policy and leaves personal signs automatic", () => {
    expect(suggestionFromMessage(confirmed("starter", "HELLO"), "asl", 50, "suggest")).toMatchObject({ source: "starter", text: "HELLO" });
    expect(suggestionFromMessage(confirmed("starter", "HELLO"), "asl", 50, "auto")).toBeNull();
    expect(suggestionFromMessage(confirmed("starter", "HELLO"), "bsl", 50, "suggest")).toBeNull();
    expect(suggestionFromMessage(confirmed("personal"), "asl", 50, "suggest")).toBeNull();
    expect(suggestionFromMessage(confirmed("personal"), "bsl", 50, "suggest")).toBeNull();
  });
  it("accepts only a card on screen, once armed and before it expires, keeping provenance and the signing time", () => {
    const model = suggestionFromMessage(suggested(), "asl", 1000)!;
    const rule = starter("HELLO", 999, 1000);
    const state = offer(offer(EMPTY_SUGGESTIONS, model), rule);
    expect(acceptSuggestion(EMPTY_SUGGESTIONS, "3:s1", "asl", 5000)).toEqual({ accepted: false, reason: "none" });
    expect(acceptSuggestion(state, "3:s0", "asl", 5000)).toEqual({ accepted: false, reason: "stale" });
    expect(acceptSuggestion(state, "3:s1", "bsl", 5000)).toEqual({ accepted: false, reason: "language" });
    expect(acceptSuggestion(state, "3:s1", "asl", 1000 + SUGGESTION_ARMING_MS - 1)).toEqual({ accepted: false, reason: "too-soon" });
    expect(acceptSuggestion(state, "3:s1", "asl", 1000 + SUGGESTION_LIFETIME_MS + 1)).toEqual({ accepted: false, reason: "expired" });
    expect(acceptSuggestion(state, "3:s1", "asl", 1000 + SUGGESTION_ARMING_MS)).toMatchObject({ accepted: true, entry: { gloss: "BOOK", source: "model", acceptedBy: "user", timestamp: 1000 } });
    expect(acceptSuggestion(state, rule.key, "asl", 1000 + SUGGESTION_ARMING_MS)).toMatchObject({ accepted: true, entry: { gloss: "HELLO", source: "starter", acceptedBy: "user", timestamp: 999 } });
  });
  it("cannot accept twice: once removed, a repeated activation finds nothing", () => {
    const item = suggestionFromMessage(suggested(), "asl", 0)!;
    let state = offer(EMPTY_SUGGESTIONS, item);
    expect(acceptSuggestion(state, "3:s1", "asl", 2000).accepted).toBe(true);
    state = removeSuggestion(state, "3:s1", 2000);
    expect(acceptSuggestion(state, "3:s1", "asl", 2001)).toEqual({ accepted: false, reason: "none" });
  });
  it("keys suggestions by session, so a restarted worker's s1 never matches an old button", () => {
    const old = suggestionFromMessage(suggested({ session: 3 }), "asl", 0)!;
    const fresh = suggestionFromMessage(suggested({ session: 4 }), "asl", 0)!;
    expect(old.key).not.toBe(fresh.key);
    expect(acceptSuggestion(offer(EMPTY_SUGGESTIONS, fresh), old.key, "asl", 5000)).toEqual({ accepted: false, reason: "stale" });
  });
});

describe("rapid signing: order, eviction, repeats, layout shift, holds", () => {
  it("keeps cards in signing order, adding new ones below so nothing shifts under a finger", () => {
    let state = offer(EMPTY_SUGGESTIONS, starter("HELLO", 10, 0));
    const firstArmed = state.visible[0].armedAt;
    state = offer(state, starter("PLEASE", 20, 1000));
    expect(glosses(state)).toEqual(["HELLO", "PLEASE"]);
    expect(state.visible[0].armedAt).toBe(firstArmed); // unmoved card keeps its arming
  });
  it("never drops a card silently: a fourth word replaces the oldest and lists it as not added", () => {
    let state = EMPTY_SUGGESTIONS;
    for (const [i, gloss] of ["HELLO", "PLEASE", "SORRY"].entries()) state = offer(state, starter(gloss, i, i * 1000));
    const result = offerSuggestion(state, starter("YES", 3, 3000), 3000);
    expect(glosses(result.state)).toEqual(["PLEASE", "SORRY", "YES"]);
    expect(result.state.visible).toHaveLength(MAX_PENDING_SUGGESTIONS);
    expect(result.state.missed).toMatchObject([{ gloss: "HELLO", reason: "replaced" }]);
    expect(announceSuggestion(result.event)).toMatch(/Possible sign: YES\. Not added\. HELLO was not added and has been replaced\./);
    // Every card moved up, so none can be activated by a tap aimed at its old place.
    for (const item of result.state.visible) expect(isArmed(item, 3000 + SUGGESTION_ARMING_MS - 1)).toBe(false);
  });
  it("while the person is pointing at or focused in the cards, new words wait and nothing expires", () => {
    let state = EMPTY_SUGGESTIONS;
    for (const [i, gloss] of ["HELLO", "PLEASE", "SORRY"].entries()) state = offer(state, starter(gloss, i, i * 1000));
    state = holdSuggestions(state, true, 2500);
    const waiting = offerSuggestion(state, starter("YES", 3, 3000), 3000);
    expect(waiting.event).toMatchObject({ kind: "waiting", waiting: 1 });
    expect(glosses(waiting.state)).toEqual(["HELLO", "PLEASE", "SORRY"]);
    const late = tickSuggestions(waiting.state, 3000 + SUGGESTION_LIFETIME_MS + 1);
    expect(glosses(late.state)).toEqual(["HELLO", "PLEASE", "SORRY"]); // held: no card expires
    expect(acceptSuggestion(late.state, late.state.visible[0].key, "asl", 3000 + SUGGESTION_LIFETIME_MS + 1).accepted).toBe(true);
    // The waiting word was never shown within its lifetime: reported, not shown late.
    expect(late.expired.map(item => item.gloss)).toEqual(["YES"]);
    expect(late.state.missed).toMatchObject([{ gloss: "YES", reason: "expired" }]);
  });
  it("answering a card lets a waiting word in at the bottom and re-arms the cards that moved up", () => {
    let state = EMPTY_SUGGESTIONS;
    for (const [i, gloss] of ["HELLO", "PLEASE", "SORRY"].entries()) state = offer(state, starter(gloss, i, i * 1000));
    state = offerSuggestion(holdSuggestions(state, true, 2500), starter("YES", 3, 3000), 3000).state;
    state = removeSuggestion(state, state.visible[0].key, 4000);
    expect(glosses(state)).toEqual(["PLEASE", "SORRY", "YES"]);
    expect(state.waiting).toHaveLength(0);
    for (const item of state.visible) expect(isArmed(item, 4000 + SUGGESTION_ARMING_MS - 1)).toBe(false);
    expect(state.visible[2].shownAt).toBe(4000);
  });
  it("on release each card keeps a grace period, then expires and is listed as not added", () => {
    let state = offer(EMPTY_SUGGESTIONS, starter("HELLO", 1, 0));
    state = holdSuggestions(holdSuggestions(state, true, 100), false, 20000);
    expect(state.visible[0].expiresAt).toBe(20000 + SUGGESTION_RELEASE_GRACE_MS);
    expect(glosses(tickSuggestions(state, 20000 + SUGGESTION_RELEASE_GRACE_MS).state)).toEqual(["HELLO"]);
    const gone = tickSuggestions(state, 20001 + SUGGESTION_RELEASE_GRACE_MS);
    expect(gone.state.visible).toHaveLength(0);
    expect(announceSuggestion({ kind: "expired", items: gone.expired })).toBe("Not added, timed out: HELLO.");
  });
  it("counts a repeated word on its own card in place, without moving or re-arming it", () => {
    let state = offer(offer(EMPTY_SUGGESTIONS, starter("NO", 1, 0)), starter("YES", 2, 500));
    const before = state.visible[0];
    const repeated = offerSuggestion(state, starter("NO", 3, 3000), 3000);
    state = repeated.state;
    expect(glosses(state)).toEqual(["NO", "YES"]);
    expect(state.visible[0]).toMatchObject({ key: before.key, armedAt: before.armedAt, signedAt: 1, repeats: 2, expiresAt: 3000 + SUGGESTION_LIFETIME_MS });
    expect(announceSuggestion(repeated.event)).toBe("Possible sign again: NO. Still not added.");
    // A model word and a rule word with the same gloss stay separate (different provenance).
    state = offer(state, suggestionFromMessage(suggested({ gloss: "NO", text: "No", id: "m" }), "asl", 3500)!);
    expect(state.visible.map(item => `${item.source}:${item.gloss}`)).toEqual(["starter:NO", "starter:YES", "model:NO"]);
  });
  it("notes are capped and fade, and never become addable", () => {
    let state = EMPTY_SUGGESTIONS;
    for (let i = 0; i < 8; i++) state = offer(state, starter(`W${i}`, i, i * 100));
    expect(state.missed.map(item => item.gloss)).toEqual(["W2", "W3", "W4"]);
    expect(state.missed).toHaveLength(MAX_MISSED_NOTES);
    expect(acceptSuggestion(state, "3:t0:W0", "asl", 5000)).toEqual({ accepted: false, reason: "stale" });
    const faded = tickSuggestions(holdSuggestions(state, true, 800), 700 + MISSED_NOTE_LIFETIME_MS + 1).state;
    expect(faded.missed).toHaveLength(0);
  });
  it("places an accepted word by its recognition time on the transcript's clock", () => {
    // Confirmed words carry the camera frame clock (performance.now-based),
    // not Date.now(); the accepted word must be compared on the same clock.
    const entries = [{ id: "a", text: "My sign", gloss: "MY SIGN", confidence: 1, timestamp: 4200, source: "personal" as const }];
    const state = offer(EMPTY_SUGGESTIONS, starter("HELLO", 3100, Date.now()));
    const outcome = acceptSuggestion(state, state.visible[0].key, "asl", Date.now() + SUGGESTION_ARMING_MS);
    if (!outcome.accepted) throw new Error("not accepted");
    expect(insertBySigningTime(entries, outcome.entry).map(item => item.gloss)).toEqual(["HELLO", "MY SIGN"]);
  });
  it("schedules the next re-render at the earliest arming, expiry or note deadline, none while idle", () => {
    expect(nextSuggestionDeadline(EMPTY_SUGGESTIONS, 0)).toBeNull();
    const state = offer(EMPTY_SUGGESTIONS, starter("HELLO", 1, 0));
    expect(nextSuggestionDeadline(state, 0)).toBe(SUGGESTION_ARMING_MS);
    expect(nextSuggestionDeadline(state, SUGGESTION_ARMING_MS)).toBe(SUGGESTION_LIFETIME_MS + 1);
    expect(nextSuggestionDeadline(holdSuggestions(state, true, SUGGESTION_ARMING_MS), SUGGESTION_ARMING_MS)).toBeNull();
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
  it("offers a suggestion (build policy for starter words) before the confirmed path and never speaks or inserts it there", () => {
    const handler = source.slice(source.indexOf("const handleWorkerMessage"));
    const offered = handler.slice(handler.indexOf("const offered"), handler.indexOf("const entry: TranscriptEntry"));
    expect(offered).toMatch(/suggestionFromMessage\(message, selectedRef\.current, performance\.now\(\), starterOutputRef\.current\)/);
    expect(offered).toMatch(/offerSuggestion\(suggestionsRef\.current, offered\)/);
    expect(offered).toMatch(/setAnnouncement\(announceSuggestion\(event\)\)/);
    expect(offered).not.toMatch(/speak\(|setEntries|entriesRef\.current =/);
  });
  it("inserts a suggested word only through acceptSuggestion, from an explicit button press", () => {
    expect(source.match(/acceptPendingSuggestion\(/g)?.length).toBe(1); // the Add button is the only call site
    expect(source).toMatch(/onClick=\{\(\) => acceptPendingSuggestion\(item\.key\)\}/);
    const accept = source.slice(source.indexOf("const acceptPendingSuggestion"), source.indexOf("const dismissPendingSuggestion"));
    expect(accept).toMatch(/acceptSuggestion\(suggestionsRef\.current, key, selectedRef\.current, now\)/);
    expect(accept).toMatch(/if \(!outcome\.accepted\) \{/);
    expect(accept).toMatch(/insertBySigningTime\(entriesRef\.current, outcome\.entry\)/);
    expect(source).not.toMatch(/onKeyDown=\{[^}]*acceptPendingSuggestion/);
  });
  it("withdraws suggestions on language, mode, camera, worker and transcript changes, and on expiry", () => {
    expect(source).toMatch(/useEffect\(\(\) => \{ withdrawSuggestion\(\); \}, \[selected, aslMode, step, withdrawSuggestion\]\)/);
    expect(source).toMatch(/if \(cameraState !== "active"\) withdrawSuggestion\(\)/);
    expect(source).toMatch(/if \(status\.state !== "running"\) withdrawSuggestion\(\)/);
    expect(source).toMatch(/tickSuggestions\(suggestionsRef\.current, performance\.now\(\)\)/);
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
