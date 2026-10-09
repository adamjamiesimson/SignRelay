import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { readManifest, summarize, markdownReport } from "../scripts/evaluate-video-regressions.mjs";

const runner = fileURLToPath(new URL("../scripts/evaluate-video-regressions.mjs", import.meta.url));

async function fixture(t, lines) {
  const root = await mkdtemp(join(tmpdir(), "signrelay-manifest-"));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  await mkdir(join(root, "videos"));
  await writeFile(join(root, "videos", "hello.mp4"), "placeholder", "utf8");
  await writeFile(join(root, "videos", "idle.mp4"), "placeholder", "utf8");
  const manifest = join(root, "manifest.jsonl");
  await writeFile(manifest, lines.join("\n") + "\n", "utf8");
  return manifest;
}

const sign = { id: "asl-hello", language: "asl", trial_type: "sign", expected_gloss: "hello", video: "videos/hello.mp4", signer_id: "P01" };
const idle = { id: "asl-idle", language: "asl", trial_type: "no_sign", expected_gloss: null, video: "videos/idle.mp4" };
const asLines = (...items) => items.map(row => JSON.stringify(row));

test("preflight reads local sign and no-sign fixtures without a browser or build", async t => {
  const manifest = await fixture(t, ["# comment", ...asLines(sign, idle)]);
  const items = await readManifest(manifest, {});
  assert.equal(items.length, 2);
  assert.equal(items[0].expectedGloss, "HELLO");
  assert.equal(items[1].trialType, "no_sign");
  assert.equal(items[0].signerId, "P01");
  const result = spawnSync(process.execPath, [runner, manifest, "--preflight"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS: 2 unique/);
  assert.match(result.stdout, /1 sign, 1 no-sign/);
});

test("duplicate fixture IDs fail clearly rather than silently mixing results", async t => {
  const manifest = await fixture(t, asLines(sign, { ...idle, id: sign.id }));
  await assert.rejects(() => readManifest(manifest, {}), /duplicate fixture id "asl-hello"/);
  const result = spawnSync(process.execPath, [runner, manifest, "--preflight"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /duplicate fixture id/);
});

test("invalid JSON values produce line-specific errors", async t => {
  const manifest = await fixture(t, ["null"]);
  await assert.rejects(() => readManifest(manifest, {}), /line 1: each row must be a JSON object/);
});

test("missing videos, remote URLs, and malformed trials fail preflight", async t => {
  for (const [row, pattern] of [
    [{ ...sign, video: "https://example.com/video.mp4" }, /remote video URLs/],
    [{ ...sign, video: "videos/missing.mp4" }, /video file not found/],
    [{ ...sign, trial_type: "no_sign" }, /no_sign trials must use expected_gloss: null/],
    [{ ...idle, trial_type: "sign" }, /sign trials require expected_gloss/],
  ]) {
    const manifest = await fixture(t, asLines(row));
    await assert.rejects(() => readManifest(manifest, {}), pattern);
  }
});

test("language and limit filtering keep intended fixture order", async t => {
  const bsl = { ...sign, id: "bsl-hello", language: "bsl" };
  const manifest = await fixture(t, asLines(sign, bsl, idle));
  const items = await readManifest(manifest, { language: "asl", limit: 1 });
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "asl-hello");
});

test("reports distinguish timeouts and accepted errors from correct predictions", () => {
  const base = { language: "asl", trial_type: "sign", expected_gloss: "HELLO", predicted_gloss: "HELLO", accepted: true,
    confidence: 0.8, tracker: { hand_coverage: 1 }, fixture_id: "sign-1", cold_start: false };
  const records = [
    { ...base, outcome: "correct" },
    { ...base, fixture_id: "sign-2", outcome: "wrong", predicted_gloss: "YES" },
    { ...base, fixture_id: "sign-3", outcome: "timeout", accepted: false, predicted_gloss: null },
    { ...base, fixture_id: "idle-1", trial_type: "no_sign", expected_gloss: null, predicted_gloss: null, accepted: false, outcome: "correct_reject" },
    { ...base, fixture_id: "idle-2", trial_type: "no_sign", expected_gloss: null, outcome: "false_accept" },
  ];
  const result = summarize(records).languages[0];
  assert.equal(result.signed, 3);
  assert.equal(result.accuracy, 1 / 3);
  assert.equal(result.coverage, 2 / 3);
  assert.equal(result.noSign, 2);
  assert.equal(result.falseAcceptRate, 0.5);
  const markdown = markdownReport(records, { languages: [result] }, { manifestBasename: "test.jsonl" });
  assert.match(markdown, /sign-3 \| ASL \| HELLO \| — \| timeout/);
  assert.match(markdown, /idle-2 \| ASL \| NO_SIGN \| HELLO \| false_accept/);
});
