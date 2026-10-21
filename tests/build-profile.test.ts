import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isLanguageAvailable } from "../lib/build-profile";
import { STEPS } from "../scripts/build-profile.mjs";
import { NON_ASL_WORKERS, pruneProfile } from "../scripts/prune-profile.mjs";
import { NON_ASL_MODEL_DIRS } from "../scripts/verify-runtime.mjs";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fakeExport() {
  const root = mkdtempSync(join(tmpdir(), "profile-"));
  dirs.push(root);
  for (const dir of [...NON_ASL_MODEL_DIRS, "asl2000-tgcn"]) { mkdirSync(join(root, "models", dir), { recursive: true }); writeFileSync(join(root, "models", dir, "model.json"), "{}"); writeFileSync(join(root, "models", dir, "ATTRIBUTION.md"), "notice"); }
  mkdirSync(join(root, "workers"));
  for (const file of [...NON_ASL_WORKERS, "recognition.worker.js", "template-matching.worker.js"]) writeFileSync(join(root, "workers", file), "");
  return root;
}

describe("ASL demo build profile", () => {
  it("only ASL is usable in the asl-demo profile; full keeps every language", () => {
    expect(isLanguageAvailable("asl", "asl-demo")).toBe(true);
    for (const language of ["bsl", "isl", "rsl", "bdsl", "lse", "psl"] as const) {
      expect(isLanguageAvailable(language, "asl-demo")).toBe(false);
      expect(isLanguageAvailable(language, "full")).toBe(true);
    }
  });
  it("prunes every other language model and clip worker but keeps the ASL runtime", async () => {
    const root = fakeExport();
    const { removed } = await pruneProfile(root, "asl-demo");
    expect(removed).toHaveLength(NON_ASL_MODEL_DIRS.length + NON_ASL_WORKERS.length);
    for (const dir of NON_ASL_MODEL_DIRS) {
      expect(existsSync(join(root, "models", dir, "model.json"))).toBe(false);
      expect(existsSync(join(root, "models", dir, "ATTRIBUTION.md"))).toBe(true);
    }
    expect(existsSync(join(root, "models/asl2000-tgcn/model.json"))).toBe(true);
    expect(existsSync(join(root, "workers/recognition.worker.js"))).toBe(true);
    expect(existsSync(join(root, "workers/template-matching.worker.js"))).toBe(true);
  });
  it("the full profile prunes nothing and unknown profiles are refused", async () => {
    const root = fakeExport();
    expect((await pruneProfile(root, "full")).removed).toEqual([]);
    await expect(pruneProfile(root, "everything")).rejects.toThrow("Unknown profile");
  });
  it("the asl-demo build keeps the private-route exclusion and security steps, then verifies the runtime", () => {
    const steps = STEPS["asl-demo"].map(step => step.join(" "));
    const order = ["next build", "exclude-private-routes", "prune-profile.mjs asl-demo", "secure-export", "verify-runtime.mjs --out out --profile asl-demo"]
      .map(part => steps.findIndex(step => step.includes(part)));
    expect(order.every(index => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(steps.some(step => step.includes("install-rsl-model"))).toBe(false);
  });
  // Only an invalid value is exercised: a valid one would go on to delete out/.
  it("prepare-export refuses unknown profiles before touching out/", () => {
    const run = (value: string) => spawnSync("node", ["scripts/prepare-export.mjs"],
      { env: { ...process.env, NEXT_PUBLIC_SIGNRELAY_PROFILE: value }, encoding: "utf8" });
    const bad = run("all-languages");
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain("Unknown build profile all-languages");
  });
  it("the rehearsal build is the ASL demo build plus the labelled hook, never the demo itself", async () => {
    const steps = STEPS.rehearsal.map(step => step.join(" "));
    expect(steps.some(step => step.includes("prune-profile.mjs rehearsal"))).toBe(true);
    expect(steps.at(-1)).toContain("verify-runtime.mjs --out out --profile rehearsal");
    const { demoExportProblems } = await import("../scripts/demo.mjs");
    const root = fakeExport();
    writeFileSync(join(root, "index.html"), "<html></html>");
    writeFileSync(join(root, "runtime-manifest.json"), JSON.stringify({ profile: "rehearsal" }));
    expect(demoExportProblems(root, () => ({ status: 0, stdout: "", stderr: "" }))[0]).toContain("is the rehearsal build, not the ASL demo");
  });
});

