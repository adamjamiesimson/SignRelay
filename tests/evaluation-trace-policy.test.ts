import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";

it("rejects development landmark tracing before opening a final holdout manifest", () => {
  let failure: { status?: number; stderr?: string } | undefined;
  try {
    execFileSync(process.execPath, ["scripts/run-recognition-video-evaluation.mjs", "unused-chrome",
      "missing-manifest.json", "missing-output.jsonl", "--final-holdout", "--capture-frames"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) { failure = error as typeof failure; }
  expect(failure?.status).toBe(1);
  expect(failure?.stderr).toContain("Development frame tracing cannot be combined with a final holdout run");
});
