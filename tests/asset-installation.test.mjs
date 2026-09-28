import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { installVerifiedAsset } from "../scripts/verified-download.mjs";

test("verified downloads retry server failures, cache only verified bytes, and repair a corrupt cache", async () => {
  const folder = await mkdtemp(join(tmpdir(), "signrelay-assets-"));
  const bytes = Buffer.from("verified model fixture");
  let requests = 0;
  const server = createServer((request, response) => {
    requests++;
    if (requests === 1) { response.writeHead(503); response.end("unavailable"); }
    else response.end(bytes);
  }).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const target = join(folder, "model.bin");
  const asset = { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
    url: `http://127.0.0.1:${server.address().port}/model` };
  try {
    assert.equal(await installVerifiedAsset(target, asset, { retryMs: 0 }), "installed");
    assert.equal(requests, 2);
    assert.equal(await installVerifiedAsset(target, asset), "cached");
    assert.equal(requests, 2);
    await writeFile(target, Buffer.alloc(bytes.length));
    assert.equal(await installVerifiedAsset(target, asset), "installed");
    assert.deepEqual(await readFile(target), bytes);
    assert.deepEqual(await readdir(folder), ["model.bin"]);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(folder, { recursive: true, force: true });
  }
});

test("truncated, oversized or incorrect downloads never replace the existing asset", async () => {
  const folder = await mkdtemp(join(tmpdir(), "signrelay-assets-"));
  const original = Buffer.from("existing");
  let incoming = Buffer.from("wrong!!!");
  const server = createServer((request, response) => response.end(incoming)).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const target = join(folder, "model.bin");
  await writeFile(target, original);
  const asset = { bytes: 8, sha256: createHash("sha256").update("expected").digest("hex"),
    url: `http://127.0.0.1:${server.address().port}/model` };
  try {
    for (const bad of ["wrong!!!", "tiny", "much too many bytes"]) {
      incoming = Buffer.from(bad);
      await assert.rejects(installVerifiedAsset(target, asset, { attempts: 1 }), /integrity|exceeds/);
      assert.deepEqual(await readFile(target), original);
      assert.deepEqual(await readdir(folder), ["model.bin"]);
    }
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(folder, { recursive: true, force: true });
  }
});
