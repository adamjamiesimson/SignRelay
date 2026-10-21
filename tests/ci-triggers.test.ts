import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = (name: string) => readFileSync(`.github/workflows/${name}`, "utf8");
/** The `on.pull_request` block, up to the next top-level trigger key. */
function pullRequestBlock(text: string) {
  const lines = text.split("\n");
  const start = lines.findIndex(line => line === "  pull_request:");
  expect(start, "workflow must run on pull_request").toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((line, index) => index > start && /^ {2}\S/.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

describe("stacked pull requests receive checks", () => {
  it.each(["ci.yml", "firebase-build-check.yml", "asl-video-pilot.yml", "field-test-browser.yml"])(
    "%s does not restrict pull_request base branches", name => {
      expect(pullRequestBlock(workflow(name))).not.toMatch(/^\s+branches:/m);
    });
  it("re-runs the real-video pilot when segmentation, confirmation or the ASL model change", () => {
    const paths = pullRequestBlock(workflow("asl-video-pilot.yml"));
    for (const file of ["lib/sign-motion.ts", "lib/frame-timing.ts", "lib/decoder.ts", "lib/asl1000-runtime.ts",
      "lib/asl-starter-recognition.ts", "workers/recognition.worker.ts"]) expect(paths).toContain(`'${file}'`);
  });
});
