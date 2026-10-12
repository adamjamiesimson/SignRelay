import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preparePilot, pilotCoverage } from "../scripts/prepare-asl-pilot.mjs";

type Intake = {
  id: string; signer_id: string; trial_type: "sign" | "no_sign"; expected_gloss: string | null;
  video: string; permission_confirmed: boolean; label_reviewed_by_fluent: boolean;
  device: string; condition: string;
};

function sample(root: string, signer: string, gloss: string | null, sequence: number): Intake {
  const slug = gloss?.toLowerCase().replaceAll(" ", "") ?? "nosign";
  const file = signer.toLowerCase() + "-" + slug + "-" + String(sequence).padStart(2, "0") + ".mp4";
  writeFileSync(join(root, file), "fake video bytes " + file);
  return {
    id: "clip-" + signer.toLowerCase() + "-" + slug + "-" + sequence,
    signer_id: signer, trial_type: gloss ? "sign" : "no_sign", expected_gloss: gloss,
    video: file, permission_confirmed: true, label_reviewed_by_fluent: true,
    device: "phone", condition: "bright-front",
  };
}
function setup() {
  const root = mkdtempSync(join(tmpdir(), "signrelay-pilot-"));
  mkdirSync(root, { recursive: true });
  return { root, input: join(root, "intake.jsonl"), output: join(root, "video-manifest.local.jsonl"),
    cleanup: () => rmSync(root, { force: true, recursive: true }) };
}
function intake(path: string, rows: Intake[]) {
  writeFileSync(path, rows.map(row => JSON.stringify(row)).join("\n") + "\n");
}

describe("private ASL pilot intake preparation", () => {
  it("writes anonymized evaluator-compatible records and local SHA-256 fingerprints", async () => {
    const p = setup();
    try {
      const row = sample(p.root, "S01", "HELLO", 1);
      intake(p.input, [row]);
      const result = await preparePilot(p.input, p.output);
      expect(result.count).toBe(1);
      expect(result.coverage.pilotMinimum).toBe(false);
      const generated = JSON.parse(readFileSync(p.output, "utf8").trim());
      expect(generated).toMatchObject({
        language: "asl", trial_type: "sign", expected_gloss: "HELLO",
        signer_id: "S01", video: row.video,
        split: "pilot-review-unverified",
      });
      expect(generated.notes).toMatch(/^sha256=[a-f0-9]{64}$/);
      expect(JSON.stringify(generated)).not.toContain("permission_confirmed");
      expect(JSON.stringify(generated)).not.toContain("label_reviewed_by_fluent");
    } finally { p.cleanup(); }
  });
  it("rejects incomplete strict pilot data without writing an output", async () => {
    const p = setup();
    try {
      intake(p.input, [sample(p.root, "S01", "HELLO", 1)]);
      await expect(preparePilot(p.input, p.output, { strict: true })).rejects.toThrow(/incomplete/);
      expect(existsSync(p.output)).toBe(false);
    } finally { p.cleanup(); }
  });
  it("requires two clips per target from three pseudonymous signers and ten non-sign controls", async () => {
    const p = setup();
    try {
      const rows: Intake[] = [];
      for (const signer of ["S01", "S02", "S03"]) {
        for (const gloss of ["HELLO", "THANK YOU", "PLEASE"]) {
          rows.push(sample(p.root, signer, gloss, 1), sample(p.root, signer, gloss, 2));
        }
      }
      for (let i = 1; i <= 10; i++) rows.push(sample(p.root, "S01", null, i));
      expect(pilotCoverage(rows).pilotMinimum).toBe(true);
      intake(p.input, rows);
      const result = await preparePilot(p.input, p.output, { strict: true });
      expect(result.count).toBe(28);
      expect(readFileSync(p.output, "utf8").trim().split("\n")).toHaveLength(28);
    } finally { p.cleanup(); }
  });
  it("rejects missing consent attestations, unreviewed signs, and unsupported glosses", async () => {
    const p = setup();
    try {
      const row = sample(p.root, "S01", "HELLO", 1);
      for (const bad of [
        { ...row, permission_confirmed: false },
        { ...row, label_reviewed_by_fluent: false },
        { ...row, expected_gloss: "NOT-A-TARGET" },
      ]) {
        intake(p.input, [bad]);
        await expect(preparePilot(p.input, p.output)).rejects.toThrow();
      }
    } finally { p.cleanup(); }
  });
  it("rejects duplicates by file hash and fixture ID", async () => {
    const p = setup();
    try {
      const first = sample(p.root, "S01", "HELLO", 1);
      const second = sample(p.root, "S01", "HELLO", 2);
      writeFileSync(join(p.root, second.video), readFileSync(join(p.root, first.video)));
      intake(p.input, [first, second]);
      await expect(preparePilot(p.input, p.output)).rejects.toThrow(/Duplicate video SHA-256/);
      writeFileSync(join(p.root, second.video), "unique second fixture");
      intake(p.input, [first, { ...second, id: first.id }]);
      await expect(preparePilot(p.input, p.output)).rejects.toThrow(/Duplicate fixture ID/);
    } finally { p.cleanup(); }
  });
  it("rejects URL-backed videos, personal-name filenames and unsafe output paths", async () => {
    const p = setup();
    try {
      const row = sample(p.root, "S01", "HELLO", 1);
      for (const bad of [
        { ...row, video: "https://example.com/hello.mp4" },
        { ...row, video: "Alice-HELLO-01.mp4" },
        { ...row, signer_id: "Alice" },
      ]) {
        intake(p.input, [bad]);
        await expect(preparePilot(p.input, p.output)).rejects.toThrow();
      }
      intake(p.input, [row]);
      await expect(preparePilot(p.input, join(p.root, "report.md"))).rejects.toThrow(/local.jsonl/);
    } finally { p.cleanup(); }
  });
});