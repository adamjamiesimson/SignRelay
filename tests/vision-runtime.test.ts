import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { TASKS_VERSION, TASKS_WASM_PATH } from "../lib/vision-runtime.mjs";
import { verifyVisionRuntime } from "../scripts/verify-vision-runtime.mjs";
import { documentPolicy } from "../scripts/security-policy.mjs";

const manifest = () => ({ dependencies: { "@mediapipe/tasks-vision": TASKS_VERSION } });
const lock = () => ({ packages: { "": manifest(), "node_modules/@mediapipe/tasks-vision": { version: TASKS_VERSION } } });
describe("one exact MediaPipe runtime release", () => {
  it("checks the real manifest, lockfile and installed package", () => {
    const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
    expect(verifyVisionRuntime(read("package.json"), read("package-lock.json"),
      read("node_modules/@mediapipe/tasks-vision/package.json"))).toBe(TASKS_VERSION);
  });
  it("rejects range drift, stale locks and stale installs", () => {
    expect(() => verifyVisionRuntime({ dependencies: { "@mediapipe/tasks-vision": `^${TASKS_VERSION}` } },
      lock(), { version: TASKS_VERSION })).toThrow("must all pin");
    const stale = lock(); stale.packages["node_modules/@mediapipe/tasks-vision"].version = "0.10.21";
    expect(() => verifyVisionRuntime(manifest(), stale, { version: TASKS_VERSION })).toThrow("must all pin");
    expect(() => verifyVisionRuntime(manifest(), lock(), { version: "0.10.21" })).toThrow("must all pin");
  });
  it("restricts script and fetch permissions to that exact WASM path", () => {
    const policy = documentPolicy([]);
    for (const directive of ["script-src", "connect-src"]) {
      const allowed = policy.split("; ").find(part => part.startsWith(directive + " "))!;
      expect(allowed).toContain(TASKS_WASM_PATH + "/");
      expect(allowed.match(/https:\/\/cdn\.jsdelivr\.net[^ ]*/g)).toEqual([TASKS_WASM_PATH + "/"]);
    }
  });
});
