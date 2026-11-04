// Starter-rule output policy fails closed: automatic insertion of unvalidated
// sign-rule words is possible only in a deliberate, non-public research export.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FINGERSPELLING_FLAG, RESEARCH_EXPORT_MARKER, STARTER_AUTO_UI_MARKER, STARTER_OUTPUT_FLAG, assertReleaseSafe, isResearchExport,
  resolveStarterOutput } from "../lib/release-flags.mjs";
import { effectiveStarterOutput, isPrivateHost } from "../lib/release";
import { publicExportProblems } from "../scripts/assert-public-export.mjs";
import { markResearchExport, researchReasons } from "../scripts/prune-research.mjs";

const AUTO = { [STARTER_OUTPUT_FLAG]: "auto" };

describe("build-time resolution", () => {
  it("defaults to suggestions everywhere except the local rehearsal research profile", () => {
    for (const env of [{}, { NEXT_PUBLIC_SIGNRELAY_PROFILE: "full" }, { NEXT_PUBLIC_SIGNRELAY_PROFILE: "asl-demo" }, { VERCEL_ENV: "preview" },
      { VERCEL_ENV: "production" }, { SIGNRELAY_RESEARCH_EXPORT: "1" }, { NEXT_PUBLIC_SIGNRELAY_PROFILE: "rehearsal", VERCEL_ENV: "preview" }])
      expect(resolveStarterOutput(env)).toBe("suggest");
    expect(resolveStarterOutput({ NEXT_PUBLIC_SIGNRELAY_PROFILE: "rehearsal" })).toBe("auto");
  });
  it("refuses an explicit auto in production, asl-demo and every hosted build", () => {
    for (const env of [AUTO, { ...AUTO, NEXT_PUBLIC_SIGNRELAY_PROFILE: "full" }, { ...AUTO, NEXT_PUBLIC_SIGNRELAY_PROFILE: "asl-demo" },
      { ...AUTO, VERCEL_ENV: "production" }, { ...AUTO, VERCEL_ENV: "preview" }, { ...AUTO, VERCEL_ENV: "preview", SIGNRELAY_RESEARCH_EXPORT: "1" },
      { ...AUTO, NEXT_PUBLIC_SIGNRELAY_PROFILE: "rehearsal", VERCEL_ENV: "production" }]) {
      expect(() => resolveStarterOutput(env)).toThrow(/refused/);
      expect(() => assertReleaseSafe(env)).toThrow(/refused/);
    }
  });
  it("allows auto only when both switches are set deliberately, or in the rehearsal profile", () => {
    expect(resolveStarterOutput({ ...AUTO, SIGNRELAY_RESEARCH_EXPORT: "1" })).toBe("auto");
    expect(resolveStarterOutput({ ...AUTO, NEXT_PUBLIC_SIGNRELAY_PROFILE: "rehearsal" })).toBe("auto");
    expect(resolveStarterOutput({ [STARTER_OUTPUT_FLAG]: "suggest", NEXT_PUBLIC_SIGNRELAY_PROFILE: "rehearsal" })).toBe("suggest");
    for (const bad of ["on", "true", "AUTO", "1"]) expect(() => resolveStarterOutput({ [STARTER_OUTPUT_FLAG]: bad })).toThrow(/must be/);
    expect(isResearchExport({ SIGNRELAY_RESEARCH_EXPORT: "1", VERCEL_ENV: "preview" })).toBe(false);
  });
  it("is resolved by next.config.ts, so the Vercel build command (which skips prepare-export) is covered too", () => {
    expect(readFileSync("next.config.ts", "utf8")).toMatch(/NEXT_PUBLIC_SIGNRELAY_STARTER_OUTPUT: resolveStarterOutput\(process\.env\)/);
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")).buildCommand as string;
    expect(vercel).toMatch(/next build/);
    expect(vercel).toMatch(/prune-research\.mjs/); // asserts release safety and marks research exports
  });
  it("prepare-export rejects research switches in .env files and an unacknowledged auto", () => {
    const dir = mkdtempSync(join(tmpdir(), "signrelay-starter-env-"));
    const run = (env: Record<string, string>) => spawnSync(process.execPath, [resolve("scripts/prepare-export.mjs")], { cwd: dir, encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", NODE_ENV: "production", ...env } });
    try {
      expect(run({}).status).toBe(0);
      for (const line of [`${STARTER_OUTPUT_FLAG}=auto`, "SIGNRELAY_RESEARCH_EXPORT=1"]) {
        writeFileSync(join(dir, ".env.production"), `${line}\n`);
        expect(run({}).stderr).toMatch(/never in a \.env file/);
        rmSync(join(dir, ".env.production"));
      }
      expect(run(AUTO).stderr).toMatch(/inserts unvalidated sign-rule words automatically/);
      expect(run({ ...AUTO, VERCEL_ENV: "preview", SIGNRELAY_RESEARCH_EXPORT: "1" }).status).not.toBe(0);
      expect(run({ ...AUTO, SIGNRELAY_RESEARCH_EXPORT: "1" }).status).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("browser-side guard", () => {
  it("applies auto only on this device or a private network, so an uploaded research export still suggests", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]", "::1", "10.0.0.4", "192.168.1.20", "172.20.0.2", "lab-laptop.local", "app.localhost"])
      expect(isPrivateHost(host)).toBe(true);
    for (const host of ["signrelay.web.app", "signrelay.vercel.app", "example.com", "172.32.0.1", "8.8.8.8", "", "192.169.0.1"])
      expect(isPrivateHost(host)).toBe(false);
    expect(effectiveStarterOutput("auto", "127.0.0.1")).toBe("auto");
    expect(effectiveStarterOutput("auto", "signrelay.web.app")).toBe("suggest");
    expect(effectiveStarterOutput("suggest", "127.0.0.1")).toBe("suggest");
  });
  it("the workspace fails closed until the host is known and shows a research banner only in auto builds", () => {
    const source = readFileSync("components/translator-experience.tsx", "utf8");
    expect(source).toMatch(/const starterOutputRef = useRef<"auto" \| "suggest">\("suggest"\)/);
    expect(source).toMatch(/suggestionFromMessage\(message, selectedRef\.current, Date\.now\(\), starterOutputRef\.current\)/);
    expect(source).toMatch(/\{STARTER_OUTPUT === "auto" && \(/);
    expect(source).toContain(STARTER_AUTO_UI_MARKER); // the literal the artifact checks search for
  });
});

describe("research-export marker and the public-deploy gate", () => {
  it("lists why an export is research-only", () => {
    expect(researchReasons({})).toEqual([]);
    expect(researchReasons({ ...AUTO, SIGNRELAY_RESEARCH_EXPORT: "1" })).toEqual(["starter-rule words are inserted automatically (unvalidated)"]);
    expect(researchReasons({ NEXT_PUBLIC_SIGNRELAY_PROFILE: "rehearsal" })).toHaveLength(3);
    expect(researchReasons({ [FINGERSPELLING_FLAG]: "on", SIGNRELAY_RESEARCH_EXPORT: "1" })).toEqual(["research fingerspelling is included"]);
  });
  function exportDir(manifest: Record<string, unknown> | null, script = "console.log('app')") {
    const root = mkdtempSync(join(tmpdir(), "signrelay-public-"));
    mkdirSync(join(root, "_next/static/chunks"), { recursive: true });
    writeFileSync(join(root, "index.html"), "<html></html>");
    writeFileSync(join(root, "_next/static/chunks/app.js"), script);
    if (manifest) writeFileSync(join(root, "runtime-manifest.json"), JSON.stringify(manifest));
    return root;
  }
  const PUBLIC = { profile: "full", starter_output: "suggest", fingerspelling: "off", rehearsal_hook: false };
  it("accepts a production export and refuses research markers, private routes, auto manifests and auto code", async () => {
    const ok = exportDir(PUBLIC);
    expect(publicExportProblems(ok)).toEqual([]);
    await markResearchExport(ok, { ...AUTO, SIGNRELAY_RESEARCH_EXPORT: "1" });
    expect(existsSync(join(ok, RESEARCH_EXPORT_MARKER))).toBe(true);
    expect(publicExportProblems(ok).join()).toMatch(/research export marker present/);
    await markResearchExport(ok, {});
    expect(existsSync(join(ok, RESEARCH_EXPORT_MARKER))).toBe(false);
    mkdirSync(join(ok, "field-test"));
    expect(publicExportProblems(ok).join()).toMatch(/private route \/field-test/);
    expect(publicExportProblems(exportDir({ ...PUBLIC, starter_output: "auto" })).join()).toMatch(/starter_output is "auto"/);
    expect(publicExportProblems(exportDir({ ...PUBLIC, profile: "rehearsal", rehearsal_hook: true })).length).toBe(2);
    expect(publicExportProblems(exportDir(null)).join()).toMatch(/runtime-manifest\.json is missing/);
    expect(publicExportProblems(exportDir(PUBLIC, `x="${STARTER_AUTO_UI_MARKER}. Not for public use."`)).join()).toMatch(/inserts starter-rule words automatically/);
  });
  it("the Firebase deploy script runs the gate before deploying", () => {
    const script = readFileSync("scripts/deploy-firebase.sh", "utf8");
    expect(script.indexOf("node scripts/assert-public-export.mjs out")).toBeGreaterThan(0);
    expect(script.indexOf("node scripts/assert-public-export.mjs out")).toBeLessThan(script.indexOf("firebase deploy"));
  });
});
