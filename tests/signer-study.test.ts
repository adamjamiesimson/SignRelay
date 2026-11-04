import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  CONSENT_VERSION, NO_CONSENT, STUDY_EXPORT_SCHEMA, STUDY_PLAN, assignSplit, buildSession, canExport, canRecord, classifyTrial, observe,
  sessionConditions, summariseSessions, suppressSmallCells, validateStudySession, type StudySessionExport, type StudyTrial,
} from "../lib/signer-study";
import { PRIVATE_ROUTES } from "../scripts/exclude-private-routes.mjs";
import { assertPrivate, enrol, loadStudy, summarise, validateFiles, withdraw } from "../scripts/signer-study.mjs";

const nodeDigest = async (text: string) => new Uint8Array(createHash("sha256").update(text).digest());

describe("study plan", () => {
  it("covers the six starter signs, the requested confusable signs, everyday movements, unsupported signs and sequences", () => {
    const { starter_signs, confusable_signs, everyday_movements, unsupported_signs, sequences } = STUDY_PLAN.tasks;
    expect(starter_signs.glosses).toEqual(["HELLO", "THANK YOU", "PLEASE", "SORRY", "YES", "NO"]);
    for (const gloss of ["HAPPY", "BAD", "SAD", "PLAY", "PARTY"]) expect(confusable_signs.glosses).toContain(gloss);
    expect(confusable_signs.glosses.filter(g => starter_signs.glosses.includes(g))).toEqual([]);
    expect(everyday_movements.items.length).toBeGreaterThanOrEqual(6);
    expect(unsupported_signs.slots).toBeGreaterThan(0);
    for (const item of sequences.items) for (const gloss of item.glosses) expect(starter_signs.glosses).toContain(gloss);
    expect(STUDY_PLAN.status).toBe("planned-no-participants");
  });
  it("defines left/right hands, camera positions and lighting, and only valid session condition pairs", () => {
    const cams = STUDY_PLAN.conditions.camera_position.map(c => c.id), lights = STUDY_PLAN.conditions.lighting.map(c => c.id);
    expect(cams.length).toBeGreaterThanOrEqual(3); expect(lights.length).toBeGreaterThanOrEqual(3);
    for (const [cam, light] of STUDY_PLAN.conditions.session_conditions[1].pairs as string[][]) { expect(cams).toContain(cam); expect(lights).toContain(light); }
    expect(STUDY_PLAN.participants.require_both_dominant_hands_per_split).toBe(true);
    expect(sessionConditions(0, 1)).toEqual({ camera_position: "front-eye-level", lighting: "even-bright" });
    expect(new Set([0, 1, 2, 3, 4, 5].map(i => JSON.stringify(sessionConditions(i, 2)))).size).toBe(6);
  });
});

describe("sessions and splits", () => {
  it("builds a reproducible, counterbalanced session from a pseudonym only", () => {
    const a = buildSession("ss-2026-11-p01", 1), again = buildSession("ss-2026-11-p01", 1), b = buildSession("ss-2026-11-p02", 1);
    expect(a).toEqual(again);
    expect(a).toHaveLength(18 + 8 + 10 + 2 + 3);
    expect(a.map(t => t.id)).not.toEqual(b.map(t => t.id));
    expect(new Set(a.map(t => t.id)).size).toBe(a.length);
    expect(a.slice(0, 18).every(t => t.kind === "starter")).toBe(true); // block order fixed, order inside shuffled
    expect(() => buildSession("Jane Doe", 1)).toThrow(/pseudonym/);
    expect(() => buildSession("ss-2026-11-p01", 3)).toThrow();
  });
  it("assigns a signer-disjoint split from the pseudonym alone, the same in Node and the browser", async () => {
    const splits = await Promise.all(Array.from({ length: 20 }, (_, i) => assignSplit(`ss-2026-11-p${String(i + 1).padStart(2, "0")}`, nodeDigest)));
    expect(new Set(splits)).toEqual(new Set(["development", "held_out"]));
    expect(await assignSplit("ss-2026-11-p01")).toBe(await assignSplit("ss-2026-11-p01", nodeDigest));
    await expect(assignSplit("alice")).rejects.toThrow();
  });
});

describe("consent", () => {
  it("records nothing without participation, logging consent and a consent reference; exports only with sharing consent", () => {
    expect(canRecord(NO_CONSENT)).toBe(false);
    const base = { ...NO_CONSENT, participate: true, keepLog: true, consentRef: "c-0007" };
    expect(canRecord({ ...base, keepLog: false })).toBe(false);
    expect(canRecord({ ...base, consentRef: "Jane Doe" })).toBe(false);
    expect(canRecord(base)).toBe(true);
    expect(canExport(base)).toBe(false);
    expect(canExport({ ...base, share: true })).toBe(true);
  });
});

const trial = (over: Partial<StudyTrial>): StudyTrial => ({ task_id: "starter:HELLO:1", kind: "starter", expected: ["HELLO"], started_t: 1000, ended_t: 4000,
  observations: [], report: { outcome: "correct", signed: null }, ...over });
const ob = (t: number, kind: StudyTrial["observations"][number]["kind"], gloss: string, source: "starter" | "model" | "personal" = "starter") => ({ t, kind, gloss, source });

describe("scoring keeps raw recognition separate from transcript safety", () => {
  it("scores a correct suggestion the person added", () => {
    const r = classifyTrial(trial({ observations: [ob(1900, "offered", "HELLO"), ob(2600, "accepted", "HELLO")] }));
    expect(r).toMatchObject({ raw: "correct", firstOutputMs: 900, transcript: { correctEntered: 1, wrongEntered: 0 } });
  });
  it("counts a wrong suggestion the person added as habitual acceptance, and a dismissed one as safe", () => {
    const added = classifyTrial(trial({ observations: [ob(1500, "offered", "PLEASE"), ob(2100, "accepted", "PLEASE")] }));
    expect(added).toMatchObject({ raw: "wrong", transcript: { wrongEntered: 1, wrongAccepted: 1, wrongAutomatic: 0 } });
    const dismissed = classifyTrial(trial({ observations: [ob(1500, "offered", "PLEASE"), ob(2100, "dismissed", "PLEASE")] }));
    expect(dismissed).toMatchObject({ raw: "wrong", transcript: { wrongEntered: 0 }, decisions: { dismissedWrong: 1 } });
  });
  it("scores negatives: any output is a false output; automatic insertion is a transcript error", () => {
    const everyday = trial({ task_id: "everyday:hair-aside", kind: "everyday", expected: null });
    expect(classifyTrial({ ...everyday, observations: [] }).raw).toBe("abstained");
    expect(classifyTrial({ ...everyday, observations: [ob(1800, "automatic", "HELLO")] })).toMatchObject({ raw: "false-output", transcript: { wrongAutomatic: 1 } });
    expect(classifyTrial(trial({ observations: [] })).raw).toBe("none");
  });
  it("summarises development sessions only, unless a final held-out measurement is declared, and suppresses small cells", () => {
    const session = (participant: string, split: "development" | "held_out") => ({ participant, split, trials: [trial({ observations: [ob(1500, "offered", "HELLO")] })] }) as unknown as StudySessionExport;
    expect(() => summariseSessions([session("ss-2026-11-p01", "held_out")])).toThrow(/sealed/);
    const summary = summariseSessions([session("ss-2026-11-p01", "development"), session("ss-2026-11-p02", "development")]);
    expect(summary.bySplitKind["development/starter"]).toMatchObject({ trials: 2, correct: 2, signers: 2, medianFirstCorrectMs: 500 });
    expect(suppressSmallCells(summary.byGloss)["development/HELLO"]).toBe("fewer than 3 signers");
  });
});

// Deliberately malformed exports: any shape may be written.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mutable = Record<string, any>;
describe("export: strict, PII-free", () => {
  const valid = (): StudySessionExport => {
    const tasks = buildSession("ss-2026-11-p01", 1);
    return { schema: STUDY_EXPORT_SCHEMA, plan_id: STUDY_PLAN.plan_id, participant: "ss-2026-11-p01", session: 1, split: "development",
      conditions: { dominant_hand: "left", camera_position: "front-eye-level", lighting: "even-bright", device_class: "laptop", camera_resolution: "1280x720" },
      consent: { version: CONSENT_VERSION, participate: true, keepLog: true, share: true, consent_ref: "c-0007" },
      build: { profile: "full", starter_output: "suggest", recognition_worker_sha256: "a".repeat(64) },
      trials: [{ task_id: tasks[0].id, kind: tasks[0].kind, expected: tasks[0].expected, started_t: 10, ended_t: 2000,
        observations: [ob(900, "offered", tasks[0].expected![0]), ob(950, "automatic", "PERSONAL", "personal")], report: { outcome: "correct", signed: tasks[0].expected![0] } }] };
  };
  it("accepts a valid session", () => expect(validateStudySession(valid())).toEqual([]));
  it.each([
    ["an extra field", (s: Mutable) => { s.participant_name = "Jane"; }, /unexpected field "participant_name"/],
    ["an extra trial field", (s: Mutable) => { s.trials[0].landmarks = [[0, 1]]; }, /unexpected field "landmarks"/],
    ["a name instead of a pseudonym", (s: Mutable) => { s.participant = "Jane Doe"; }, /pseudonym/],
    ["an absolute timestamp", (s: Mutable) => { s.trials[0].started_t = Date.now(); }, /relative milliseconds/],
    ["a personal sign's own text", (s: Mutable) => { s.trials[0].observations[1].gloss = "MY BROTHER SAM"; }, /PERSONAL/],
    ["free text as the signed gloss", (s: Mutable) => { s.trials[0].report.signed = "my own words"; }, /gloss list/],
    ["missing sharing consent", (s: Mutable) => { s.consent.share = false; }, /must all have been given/],
    ["a task from another participant's plan", (s: Mutable) => { s.trials[0].task_id = "starter:NOPE:1"; }, /not a task/],
  ])("refuses %s", (_name, edit, message) => {
    const session = valid() as Mutable; edit(session);
    expect(validateStudySession(session).join("\n")).toMatch(message);
  });
  it("refuses a split that differs from the enrolment roster (signer leakage)", () => {
    expect(validateStudySession(valid(), { knownSplit: "held_out" }).join()).toMatch(/signer leakage/);
  });
  it("records workspace events with relative times, keeping personal-sign text out", () => {
    expect(observe({ kind: "automatic", gloss: "My brother Sam", source: "personal" }, 1000, 2500.4)).toEqual({ t: 1500, kind: "automatic", gloss: "PERSONAL", source: "personal" });
    expect(observe({ kind: "offered", gloss: "thank you", source: "starter" }, 1000, 900)).toMatchObject({ t: 0, gloss: "THANK YOU" });
  });
});

describe("facilitator CLI (private folder only)", () => {
  const dir = join("evaluation/raw", `signer-study-test-${process.pid}`);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  it("refuses paths outside evaluation/raw/", () => {
    expect(() => assertPrivate("docs/roster.json")).toThrow(/evaluation\/raw/);
    expect(() => assertPrivate("evaluation/raw")).toThrow();
    expect(() => assertPrivate(join(dir, "roster.json"))).not.toThrow();
  });
  it("enrols, validates against the roster, summarises development only, and honours withdrawal", async () => {
    const study = await loadStudy();
    const roster = join(dir, "roster.json"), sessions = join(dir, "sessions");
    mkdirSync(sessions, { recursive: true });
    const people = [];
    for (let i = 1; i <= 8; i++) people.push(await enrol(roster, `ss-2026-11-p${String(i).padStart(2, "0")}`, study));
    await expect(enrol(roster, "ss-2026-11-p01", study)).rejects.toThrow(/already enrolled/);
    const dev = people.find(p => p.split === "development")!, held = people.find(p => p.split === "held_out")!;
    const write = (pseudonym: string, split: string) => {
      const tasks = buildSession(pseudonym, 1);
      const session = { schema: STUDY_EXPORT_SCHEMA, plan_id: STUDY_PLAN.plan_id, participant: pseudonym, session: 1, split,
        conditions: { dominant_hand: "right", camera_position: "front-eye-level", lighting: "even-bright", device_class: "laptop", camera_resolution: null },
        consent: { version: CONSENT_VERSION, participate: true, keepLog: true, share: true, consent_ref: "c-0001" },
        build: { profile: "full", starter_output: "suggest", recognition_worker_sha256: null },
        trials: [{ task_id: tasks[0].id, kind: tasks[0].kind, expected: tasks[0].expected, started_t: 0, ended_t: 3000, observations: [], report: { outcome: "missed", signed: null } }] };
      const file = join(sessions, `${pseudonym}-session1.study.json`);
      writeFileSync(file, JSON.stringify(session));
      return file;
    };
    const devFile = write(dev.pseudonym, "development");
    expect(validateFiles(roster, [devFile], study)[0]).toMatchObject({ ok: true });
    const leaked = write(held.pseudonym, "development");
    expect(validateFiles(roster, [leaked], study)[0].errors.join()).toMatch(/signer leakage/);
    expect(() => summarise(roster, sessions, study)).toThrow(/Invalid session logs/);
    write(held.pseudonym, "held_out");
    expect(() => summarise(roster, sessions, study)).toThrow(/sealed/);
    withdraw(roster, held.pseudonym);
    expect(summarise(roster, sessions, study).sessions).toBe(1);
    expect(JSON.parse(readFileSync(roster, "utf8")).withdrawn).toEqual([held.pseudonym]);
  });
});

describe("private route and workspace wiring", () => {
  it("is omitted from public exports, refused by the deploy gate, and only the study page observes the workspace", () => {
    expect(PRIVATE_ROUTES).toContain("study");
    expect(readFileSync("app/page.tsx", "utf8")).not.toMatch(/onStudyEvent/);
    const study = readFileSync("app/study/page.tsx", "utf8");
    expect(study).toMatch(/<TranslatorExperience onStudyEvent=\{phase === "running" \? onStudyEvent : undefined\} \/>/);
    expect(study).not.toMatch(/localStorage|indexedDB|fetch\([^)]*(?:POST|method)|sendBeacon|XMLHttpRequest/);
    expect(readFileSync("app/study/layout.tsx", "utf8")).toMatch(/index: false/);
  });
});
