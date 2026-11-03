import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { FINGERSPELLING_ASSETS, FINGERSPELLING_FLAG, resolveFingerspelling } from "../lib/release-flags.mjs";
import { pruneResearch } from "../scripts/prune-research.mjs";
import { expectedFingerspelling } from "../scripts/verify-runtime.mjs";

describe("fingerspelling release flag", () => {
  it("is off for production exports unless a build opts in", () => {
    expect(resolveFingerspelling({})).toBe("off");
    expect(resolveFingerspelling({ NEXT_PUBLIC_SIGNRELAY_PROFILE: "full" })).toBe("off");
    expect(resolveFingerspelling({ NEXT_PUBLIC_SIGNRELAY_PROFILE: "asl-demo" })).toBe("off");
    expect(resolveFingerspelling({ VERCEL_ENV: "production" })).toBe("off");
    expect(resolveFingerspelling({ NODE_ENV: "production" })).toBe("off");
  });
  it("is on in research builds: rehearsal, Vercel preview and next dev", () => {
    expect(resolveFingerspelling({ NEXT_PUBLIC_SIGNRELAY_PROFILE: "rehearsal" })).toBe("on");
    expect(resolveFingerspelling({ VERCEL_ENV: "preview" })).toBe("on");
    expect(resolveFingerspelling({ NODE_ENV: "development" })).toBe("on");
  });
  it("lets an explicit value override both ways and rejects anything else", () => {
    expect(resolveFingerspelling({ [FINGERSPELLING_FLAG]: "on" })).toBe("on");
    expect(resolveFingerspelling({ [FINGERSPELLING_FLAG]: "off", NEXT_PUBLIC_SIGNRELAY_PROFILE: "rehearsal", VERCEL_ENV: "preview" })).toBe("off");
    for (const bad of ["true", "1", "ON", "yes"]) expect(() => resolveFingerspelling({ [FINGERSPELLING_FLAG]: bad })).toThrow(/"on" or "off"/);
  });
  it("is inlined by next.config.ts and accepted by the export environment check", () => {
    expect(readFileSync("next.config.ts", "utf8")).toMatch(/NEXT_PUBLIC_SIGNRELAY_FINGERSPELLING: resolveFingerspelling\(\)/);
    expect(readFileSync("scripts/prepare-export.mjs", "utf8")).toMatch(/FINGERSPELLING_FLAG/);
    expect(readFileSync("lib/release.ts", "utf8")).toMatch(/=== "on"/);
  });
  it("gates every workspace entry point", () => {
    const source = readFileSync("components/translator-experience.tsx", "utf8");
    // Selector, panel, CTC session, mode change and both tracker-profile choices.
    expect(source.match(/FINGERSPELLING_ENABLED/g)?.length).toBeGreaterThanOrEqual(7);
    expect(source).toMatch(/selected === "asl" && FINGERSPELLING_ENABLED && \(/);
    expect(source).toMatch(/mode === "fingerspelling" && !FINGERSPELLING_ENABLED\)\) return;/);
    expect(source).toMatch(/if \(!FINGERSPELLING_ENABLED \|\| aslMode !== "fingerspelling"/);
  });
});

describe("export verifier", () => {
  it("expects the profile's own default when run standalone, and honours explicit values", () => {
    expect(expectedFingerspelling("rehearsal", {})).toBe("on");
    expect(expectedFingerspelling("full", {})).toBe("off");
    expect(expectedFingerspelling("asl-demo", {})).toBe("off");
    expect(expectedFingerspelling("rehearsal", { NEXT_PUBLIC_SIGNRELAY_FINGERSPELLING: "off" })).toBe("off");
    expect(expectedFingerspelling("full", {}, "on")).toBe("on");
    expect(() => expectedFingerspelling("full", {}, "yes")).toThrow();
  });
});

describe("stored data across flag toggles", () => {
  it("no storage module, schema or migration reads the flag, so toggling cannot change what is stored or loaded", () => {
    for (const file of ["lib/browser-storage.ts", "lib/calibration-storage.ts", "lib/analytics-consent.ts", "lib/personalized-recognition.ts"]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/FINGERSPELLING_ENABLED|release-flags|lib\/release|NEXT_PUBLIC_SIGNRELAY_FINGERSPELLING/);
    }
    // The fingerspelling mode itself is never persisted, so an OFF build has nothing to restore into.
    expect(readFileSync("components/translator-experience.tsx", "utf8")).not.toMatch(/localStorage[^\n]*aslMode|saveSettings\([^)]*aslMode/);
  });
});

describe("research asset pruning", () => {
  const make = () => {
    const root = mkdtempSync(join(tmpdir(), "signrelay-prune-"));
    mkdirSync(join(root, FINGERSPELLING_ASSETS.modelDir), { recursive: true });
    mkdirSync(join(root, "workers"), { recursive: true });
    for (const name of ["fsboard-accuracy-v2.onnx", "fsboard-upright-v1.onnx", ...FINGERSPELLING_ASSETS.keptNotices]) writeFileSync(join(root, FINGERSPELLING_ASSETS.modelDir, name), "x");
    for (const name of [...FINGERSPELLING_ASSETS.workers, "recognition.worker.js", "vision.worker.js", "ort-wasm-simd-threaded.jsep.wasm"]) writeFileSync(join(root, "workers", name), "x");
    return root;
  };
  it("removes only fingerspelling models and workers when off, keeping notices and shared runtime", async () => {
    const root = make();
    try {
      const { removed } = await pruneResearch(root, "off");
      expect(removed.sort()).toEqual([`${FINGERSPELLING_ASSETS.modelDir}/fsboard-accuracy-v2.onnx`, `${FINGERSPELLING_ASSETS.modelDir}/fsboard-upright-v1.onnx`, "workers/fingerspelling-vision.worker.js", "workers/fingerspelling.worker.js"]);
      for (const name of FINGERSPELLING_ASSETS.keptNotices) expect(existsSync(join(root, FINGERSPELLING_ASSETS.modelDir, name))).toBe(true);
      for (const name of ["recognition.worker.js", "vision.worker.js", "ort-wasm-simd-threaded.jsep.wasm"]) expect(existsSync(join(root, "workers", name))).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("removes nothing when on", async () => {
    const root = make();
    try { expect((await pruneResearch(root, "on")).removed).toEqual([]); }
    finally { rmSync(root, { recursive: true, force: true }); }
  });
});
