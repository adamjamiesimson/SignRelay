import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { servePreview } from "./serve-preview.mjs";

test("the static preview publishes only the lab and its verified recognition assets", async () => {
  const files = await readdir(new URL("./dist-preview/", import.meta.url), { recursive: true, withFileTypes: true });
  assert.equal(files.filter(file => file.isFile()).length, 13);
  assert(files.every(file => !file.isSymbolicLink()));
  const model = await readFile(new URL("./dist-preview/model.json", import.meta.url));
  assert.equal(createHash("sha256").update(model).digest("hex"),
    "48399c6e811c9340b59d86fe49ae1ddbbdf196a33dc38ef5f24b25ae73159603");
  const server = await servePreview();
  try {
    const origin = "http://127.0.0.1:" + server.address().port;
    for (const [path, type] of [["/", "text/html"], ["/app.mjs", "text/javascript"], ["/tracker.js", "text/javascript"],
      ["/pose.js", "text/javascript"], ["/model.json", "application/json"], ["/vision/wasm/vision_wasm_internal.wasm", "application/wasm"]]) {
      const response = await fetch(origin + path);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), type);
      assert(response.headers.get("content-security-policy").includes("connect-src 'self'"));
      assert.equal(response.headers.get("permissions-policy"), "camera=(self), microphone=(), geolocation=()");
      await response.arrayBuffer();
    }
    for (const path of ["/evaluation/raw/hand_landmarker.task", "/.env", "/models/rgb.json", "/experiment-ledger.json", "/worker.mjs"]) {
      assert.equal((await fetch(origin + path)).status, 404);
    }
    const page = await (await fetch(origin + "/")).text();
    assert(page.includes("<body data-preview>"));
    assert.match(page, /<code id="commit">[a-f0-9]{40}<\/code>/);
    const profile = await (await fetch(origin + "/profile.json")).json();
    assert.equal(profile.poseMode, "split");
    assert.equal(profile.allowPolicySelection, true);
    assert.equal(profile.auto, true);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
