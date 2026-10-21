import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { containerOf, importCaptures, MAX_SIDECAR_BYTES, readCaptureDirectory, writeIntakeAtomically } from "../scripts/capture-intake.mjs";
import { makeDevelopmentIntake } from "../scripts/reviewed-development.mjs";
import { captureMetadata, captureTrial } from "../lib/field-test-capture";

const plan = JSON.parse(readFileSync("docs/evaluation/development-collection-plan-2026-10-17.json", "utf8"));
// Synthetic container headers only; these bytes are not recordings of anyone.
const webm = (seed: number) => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, seed)]);
const mp4 = () => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(32, 1)]);
function capture(participant: number, slot: number, take: number, video: Buffer, mime = "video/webm;codecs=vp8", overrides = {}) {
  const sidecar = { ...captureMetadata({ trial: captureTrial(participant, "sign", slot, take), mime, bytes: video.length,
    sha256: createHash("sha256").update(video).digest("hex"), recordedAt: "2026-10-22T09:00:00Z", durationMs: 2600,
    stopReason: "manual", dominantHand: "Right", physicalHands: ["Right"], device: "Laptop / Chrome", oovGloss: null,
    camera: { width: 1280, height: 720, frameRate: 30, facingMode: "user" } }), ...overrides };
  return { sidecar, sidecarName: `${sidecar.trial_id}.capture.json`, videoName: sidecar.original_recording_file, video };
}

describe("private capture intake", () => {
  it("detects real container headers rather than trusting the extension", () => {
    expect(containerOf(webm(1))).toBe("webm");
    expect(containerOf(mp4())).toBe("mp4");
    expect(containerOf(Buffer.from("not a video"))).toBeNull();
  });
  it("imports a checksum-paired WebM into its exact planned slot while review stays pending", () => {
    const intake = makeDevelopmentIntake(plan);
    const { intake: updated, report } = importCaptures({ plan, intake, captures: [capture(0, 1, 1, webm(1))] });
    const row = updated.trials.find((trial: { trial_id: string }) => trial.trial_id === "dev-20261017-p01-sign-1-1");
    expect(row).toMatchObject({ file: "evaluation/videos/asl-development-2026-10-17/dev-20261017-p01-sign-1-1.webm",
      original_unmodified_take: true, physical_hands: ["Right"], review: { status: "pending", fluent_asl: false } });
    expect(updated.participants[0].dominant_hand).toBe("Right");
    expect(report).toMatchObject({ imported: 1, captured_trials: 1, pending_reviews: 1, approved_reviews: 0,
      still_required: { consent_reference: 1, recording_group: 1, source: 1, license: 1 } });
    expect(intake.trials[0].capture).toBeUndefined();
  });
  it.each([
    ["a sidecar claiming approval", capture(0, 1, 1, webm(1), undefined, { review: { status: "approved", reviewer_id: "r1", fluent_asl: true } }), "claims review"],
    ["a trial outside the plan", capture(0, 1, 1, webm(1), undefined, { trial_id: "dev-20261017-p09-sign-1-1" }), "not one of the 144"],
    ["a changed expected gloss", capture(0, 1, 1, webm(1), undefined, { expected_gloss: "PLEASE" }), "planned expected_gloss changed"],
    ["MP4 bytes named as WebM", { ...capture(0, 1, 1, mp4()), video: mp4() }, "not WEBM"],
    ["an edited recording", { ...capture(0, 1, 1, webm(1)), video: webm(2) }, "SHA-256 differs"],
    ["a missing video", { ...capture(0, 1, 1, webm(1)), video: null, videoName: null }, "is missing"],
    ["a too-short take", capture(0, 1, 1, webm(1), undefined, { duration_ms: 400 }), "outside 1–30 seconds"],
  ])("rejects %s", (_name, item, reason) => {
    expect(() => importCaptures({ plan, intake: makeDevelopmentIntake(plan), captures: [item] })).toThrow(reason);
  });
  it("rejects one recording reused for two trials and contradictory dominant hands", () => {
    const intake = makeDevelopmentIntake(plan);
    const reused = capture(0, 1, 2, webm(1));
    expect(() => importCaptures({ plan, intake, captures: [capture(0, 1, 1, webm(1)), reused] })).toThrow("identical recording");
    const left = capture(0, 2, 1, webm(3), undefined, { dominant_hand: "Left" });
    expect(() => importCaptures({ plan, intake, captures: [capture(0, 1, 1, webm(1)), left] })).toThrow("contradicts Right");
  });
  it("refuses to silently replace an imported recording or detach a review decision", () => {
    const { intake } = importCaptures({ plan, intake: makeDevelopmentIntake(plan), captures: [capture(0, 1, 1, webm(1))] });
    expect(() => importCaptures({ plan, intake, captures: [capture(0, 1, 1, webm(4))] })).toThrow("already imported");
    const reviewed = structuredClone(intake);
    reviewed.trials[0].review.status = "approved";
    expect(() => importCaptures({ plan, intake: reviewed, captures: [capture(0, 1, 1, webm(1))] })).toThrow("review decision");
  });
});

describe("capture folder and intake file hardening", () => {
  const folder = (files: Record<string, string | Buffer>) => {
    const dir = mkdtempSync(join(tmpdir(), "intake-"));
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
    return dir;
  };
  it("reports malformed sidecar JSON by file name", async () => {
    const dir = folder({ "dev-20261017-p01-sign-1-1.capture.json": "{ not json" });
    await expect(readCaptureDirectory(dir)).rejects.toThrow("dev-20261017-p01-sign-1-1.capture.json: malformed JSON");
    rmSync(dir, { recursive: true });
  });
  it("refuses links, folders, hidden and unexpected files, and oversized sidecars before reading them", async () => {
    const outside = folder({ "secret.webm": webm(9) });
    const linked = folder({});
    symlinkSync(join(outside, "secret.webm"), join(linked, "dev-20261017-p01-sign-1-1.webm"));
    await expect(readCaptureDirectory(linked)).rejects.toThrow("not a regular file");
    const nested = folder({}); mkdirSync(join(nested, "sub"));
    await expect(readCaptureDirectory(nested)).rejects.toThrow("not a regular file");
    await expect(readCaptureDirectory(folder({ ".hidden.webm": webm(1) }))).rejects.toThrow("unexpected file");
    await expect(readCaptureDirectory(folder({ "notes.txt": "x" }))).rejects.toThrow("unexpected file");
    await expect(readCaptureDirectory(folder({ "a.capture.json": " ".repeat(MAX_SIDECAR_BYTES + 1) }))).rejects.toThrow("sidecar exceeds");
    await expect(readCaptureDirectory(folder({ "orphan.webm": webm(1) }))).rejects.toThrow("Recordings without sidecars: orphan.webm");
  });
  it("rejects traversal in trial or plan IDs and non-object sidecars", () => {
    const traversal = capture(0, 1, 1, webm(1), undefined, { trial_id: "../../etc/passwd" });
    expect(() => importCaptures({ plan, intake: makeDevelopmentIntake(plan), captures: [traversal] })).toThrow("safe single path segment");
    expect(() => importCaptures({ plan: { ...plan, plan_id: "../x" }, intake: makeDevelopmentIntake(plan), captures: [] })).toThrow("Plan ID is not a safe");
    expect(() => importCaptures({ plan, intake: makeDevelopmentIntake(plan), captures: [{ ...capture(0, 1, 1, webm(1)), sidecar: [] as never }] })).toThrow("not a JSON object");
  });
  it("rejects an oversized recording even when its sidecar agrees", () => {
    const big = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(100 * 1024 * 1024)]);
    const item = capture(0, 1, 1, big);
    expect(() => importCaptures({ plan, intake: makeDevelopmentIntake(plan), captures: [item] })).toThrow("exceeds 100 MB");
  });
  it("writes the intake atomically and refuses if it changed during the import", async () => {
    const dir = folder({ "intake.json": "{\"v\":1}\n" });
    const file = join(dir, "intake.json");
    await writeIntakeAtomically(file, { v: 2 }, Buffer.from("{\"v\":1}\n"));
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ v: 2 });
    await expect(writeIntakeAtomically(file, { v: 3 }, Buffer.from("{\"v\":1}\n"))).rejects.toThrow("changed while importing");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ v: 2 });
    expect(readdirSync(dir).filter(name => name.endsWith(".tmp"))).toEqual([]);
    expect(existsSync(file)).toBe(true);
    rmSync(dir, { recursive: true });
  });
});
