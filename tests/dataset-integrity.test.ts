import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { signerKey } from "../scripts/signer-identity.mjs";
import { validateManifest } from "../scripts/evaluation-manifest.mjs";

const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const lock = read("docs/evaluation/cohort-lock-2026-10-16.json");
const sealedFile = lock.manifests.find((entry: { role: string }) => entry.role === "sealed-holdout").file;

describe("signer identity cannot leak through aliases", () => {
  it.each(["popsign-4a.8018", "PopSign-4A.8018", " popsign-4a.8018 ", "gtsignstudy4a.8018", "GTSignStudy4A.8018", "popsign-gtsignstudy4a.8018"])(
    "%j is the same signer", alias => expect(signerKey(alias)).toBe("popsign-4a.8018"));
  it("treats separators and case as the same new participant", () => {
    expect(signerKey("DEV 20261017_P01")).toBe(signerKey("dev-20261017-p01"));
    expect(signerKey("dev-20261017-p01")).not.toBe(signerKey("dev-20261017-p02"));
  });
  it("rejects a development row whose signer is a reserved holdout signer under a different alias", () => {
    const holdout = read(sealedFile);
    const leaked = { ...read("docs/evaluation/popsign-development-2026-10-16.json")[0], trial_id: "leak-check",
      participant_id: holdout[0].participant_id.toUpperCase(), recording_sha256: "f".repeat(64), archive_member: "leak-check" };
    expect(() => validateManifest([leaked], { related: [holdout], allowHoldout: true })).toThrow("signer leakage");
  });
  it("keeps every frozen development, historical and sealed signer disjoint", () => {
    const splits = new Map<string, Set<string>>();
    for (const entry of lock.manifests) for (const row of read(entry.file)) {
      const role = entry.role === "sealed-holdout" ? "sealed" : "development";
      splits.set(signerKey(row.participant_id), new Set([...(splits.get(signerKey(row.participant_id)) ?? []), role]));
    }
    expect([...splits.values()].filter(roles => roles.size > 1)).toEqual([]);
  });
});

describe("sealed holdout stays unseen", () => {
  const fetch = (manifest: string, ...flags: string[]) => spawnSync("python3", ["training/fetch_evaluation_clips.py", manifest, ...flags], { encoding: "utf8" });
  it("refuses to fetch the sealed manifest before network access", () => {
    const result = fetch(sealedFile);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Refusing to fetch 5 sealed holdout clip(s)");
  });
  it("refuses sealed clips copied into a renamed development manifest", () => {
    const copy = join(mkdtempSync(join(tmpdir(), "signrelay-holdout-")), "innocent-development.json");
    writeFileSync(copy, JSON.stringify(read(sealedFile).slice(0, 1).map((row: object) => ({ ...row, evaluation_split: "development" }))));
    expect(fetch(copy).stderr).toContain("Refusing to fetch 1 sealed holdout clip(s)");
  });
  it("never references the sealed cohort or final-holdout mode from CI", () => {
    for (const file of execFileSync("git", ["ls-files", ".github/workflows"], { encoding: "utf8" }).trim().split("\n")) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toContain("reserved-holdout");
      expect(text, file).not.toContain("--final-holdout");
    }
  });
});
