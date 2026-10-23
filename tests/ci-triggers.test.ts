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
  it.each(["ci.yml", "firebase-build-check.yml", "asl-video-pilot.yml", "field-test-browser.yml", "asl-demo.yml", "consent-check.yml"])(
    "%s does not restrict pull_request base branches", name => {
      expect(pullRequestBlock(workflow(name))).not.toMatch(/^\s+branches:/m);
    });
  it("re-runs the real-video pilot when segmentation, confirmation or the ASL model change", () => {
    const paths = pullRequestBlock(workflow("asl-video-pilot.yml"));
    for (const file of ["lib/sign-motion.ts", "lib/frame-timing.ts", "lib/decoder.ts", "lib/asl1000-runtime.ts",
      "lib/asl-starter-recognition.ts", "workers/recognition.worker.ts"]) expect(paths).toContain(`'${file}'`);
  });
  it("re-runs the pilot whenever the committed recognition-worker bundle changes, whichever source changed it", () => {
    // e.g. lib/template-transport.ts is bundled into the worker but is not in the source list.
    expect(pullRequestBlock(workflow("asl-video-pilot.yml"))).toContain("'public/workers/recognition.worker.js'");
  });
  it.each(["firebase-build-check.yml", "field-test-browser.yml"])("%s cancels superseded pull-request runs but never main", name => {
    const text = workflow(name);
    expect(text).toContain("group: ${{ github.workflow }}-${{ github.ref }}");
    expect(text).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
  });
});

describe("the offline demo profiles are checked on every pull request", () => {
  it("builds both demo profiles and runs every demo, rehearsal and fault-injection smoke", () => {
    const demo = workflow("asl-demo.yml");
    for (const step of ["npm run build:rehearsal", "npm run build:asl-demo", "npm run demo:check", "--self-test",
      "tests/gitex-rehearsal-smoke.mjs", "tests/transcript-a11y-smoke.mjs", "tests/user-feedback-fault-smoke.mjs", "tests/personal-vocabulary-scale-smoke.mjs", "tests/onboarding-smoke.mjs", "tests/offline-vision-smoke.mjs",
      "tests/lifecycle-stress-smoke.mjs", "tests/fault-injection-smoke.mjs", "--profile rehearsal", "--profile asl-demo"]) expect(demo).toContain(step);
    expect(demo.indexOf("npm run build:asl-demo")).toBeGreaterThan(demo.indexOf("npm run build:rehearsal"));
    expect(demo).not.toMatch(/continue-on-error|\|\| true/);
  });
});

describe("strict dependency audit stays a release gate", () => {
  const firebase = workflow("firebase-build-check.yml");
  it("runs the unchanged audit:security script in its own job against the built export", () => {
    const job = firebase.slice(firebase.indexOf("  strict-dependency-audit:"));
    expect(job).toContain("needs: build");
    expect(job).toContain("run: npm run audit:security");
    expect(job).toContain("name: signrelay-firebase-out");
    expect(job).not.toMatch(/continue-on-error|\|\| true/);
  });
  it("never lets audit:security become optional or silently skipped", () => {
    expect(firebase).not.toMatch(/continue-on-error/);
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts["audit:security"]).toBe("npm audit --audit-level=moderate && npm run audit:secrets && npm run test:rendered");
  });
  it("still runs the fail-closed dependency gate in the build job and Core CI", () => {
    expect(firebase.slice(0, firebase.indexOf("  strict-dependency-audit:"))).toContain("npm run audit:deps");
    expect(workflow("ci.yml")).toContain("npm run audit:deps");
  });
});

describe("the external RSL model download is cached, verified and reported apart from code failures", () => {
  it.each([["firebase-build-check.yml", "npm run build:firebase"], ["asl-video-pilot.yml", "npm run build:firebase"],
    ["field-test-browser.yml", "npm run build:firebase"]])("%s restores, verifies and saves the model before building", (name, build) => {
    const text = workflow(name);
    const restore = text.indexOf("uses: actions/cache/restore@v4"), acquire = text.indexOf("run: npm run install:rsl-model");
    const save = text.indexOf("uses: actions/cache/save@v4");
    expect(restore).toBeGreaterThan(0);
    expect(acquire).toBeGreaterThan(restore);
    expect(save).toBeGreaterThan(acquire);
    expect(text.indexOf(`run: ${build}`)).toBeGreaterThan(save);
    expect(text).toContain("key: rsl-model-${{ hashFiles('public/models/rsl1000-slovo/manifest.json') }}");
    // A cache hit is verified like a download: the acquire step never depends on the cache result.
    const acquireStep = text.slice(text.lastIndexOf("- name:", acquire), acquire);
    expect(acquireStep).not.toMatch(/\bif:/);
    expect(text).not.toMatch(/continue-on-error|install:rsl-model \|\| true/);
  });
  it("still installs and verifies the model inside build:firebase itself", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts["build:firebase"]).toContain("npm run install:rsl-model &&");
    expect(pkg.scripts["install:rsl-model"]).toBe("node scripts/install-rsl-model.mjs");
  });
});

describe("optional analytics consent is checked in a browser on every pull request", () => {
  it("builds with a placeholder measurement ID that is never deployed and runs the consent smoke", () => {
    const text = workflow("consent-check.yml");
    expect(text).toContain("NEXT_PUBLIC_GA_MEASUREMENT_ID: G-SMOKETEST1");
    expect(text).toContain("node tests/consent-smoke.mjs");
    expect(text).not.toMatch(/firebase deploy|hosting:channel|upload-artifact|continue-on-error|\|\| true/);
  });
});
