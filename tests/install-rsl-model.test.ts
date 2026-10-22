import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExternalDownloadError, IntegrityError, installRslModel, RETRY_DELAYS_MS } from "../scripts/install-rsl-model.mjs";

const model = new Uint8Array(Array.from({ length: 4096 }, (_, i) => (i * 37) % 251));
const manifest = { url: "https://models.example.test/slovo.onnx", bytes: model.length,
  sha256: createHash("sha256").update(model).digest("hex") };
const reset = () => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }) });
/** A response whose body delivers `bytes`, optionally failing after `failAfter` bytes. */
function body(bytes: Uint8Array, { failAfter, status = 200 }: { failAfter?: number; status?: number } = {}) {
  return new Response(new ReadableStream({ start(controller) {
    if (failAfter === undefined) { controller.enqueue(bytes); controller.close(); return; }
    controller.enqueue(bytes.slice(0, failAfter)); controller.error(reset().cause);
  } }), { status });
}
let directory: string;
const setup = () => { directory = mkdtempSync(join(tmpdir(), "signrelay-rsl-")); return pathToFileURL(directory + "/"); };
const run = (fetchImpl: typeof fetch, sleep = vi.fn(async (ms: number) => { void ms; })) =>
  installRslModel({ directory: setup(), manifest, fetchImpl, sleep, log: () => {} });
const leftovers = () => readdirSync(directory).filter(name => name.endsWith(".partial"));
afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe("RSL model acquisition", () => {
  it("retries a connection reset and an interrupted transfer, then installs the verified model", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(reset())
      .mockResolvedValueOnce(body(model, { failAfter: 1000 }))
      .mockResolvedValueOnce(body(model));
    const sleep = vi.fn(async (ms: number) => { void ms; });
    await expect(run(fetchImpl, sleep)).resolves.toEqual({ installed: true, attempts: 3 });
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual(RETRY_DELAYS_MS.slice(0, 2));
    expect(readFileSync(join(directory, "model.onnx"))).toEqual(Buffer.from(model));
    expect(leftovers()).toEqual([]);
  });
  it("gives up after a bounded number of attempts with an external-download error and installs nothing", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(reset());
    const error = await run(fetchImpl).catch(caught => caught);
    expect(error).toBeInstanceOf(ExternalDownloadError);
    expect(error.message).toContain("ECONNRESET");
    expect(fetchImpl).toHaveBeenCalledTimes(RETRY_DELAYS_MS.length + 1);
    expect(existsSync(join(directory, "model.onnx"))).toBe(false);
    expect(leftovers()).toEqual([]);
  });
  it("retries a short body and server errors, but not a missing file", async () => {
    const short = vi.fn().mockResolvedValueOnce(body(model.slice(0, 100))).mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(body(model));
    await expect(run(short)).resolves.toMatchObject({ installed: true, attempts: 3 });
    rmSync(directory, { recursive: true, force: true });
    const missing = vi.fn().mockResolvedValue(new Response("gone", { status: 404 }));
    await expect(run(missing)).rejects.toBeInstanceOf(ExternalDownloadError);
    expect(missing).toHaveBeenCalledOnce();
  });
  it("fails closed on different bytes, without retrying or installing them", async () => {
    const tampered = model.slice(); tampered[10] ^= 1;
    const fetchImpl = vi.fn().mockResolvedValue(body(tampered));
    await expect(run(fetchImpl)).rejects.toBeInstanceOf(IntegrityError);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(existsSync(join(directory, "model.onnx"))).toBe(false);
    expect(leftovers()).toEqual([]);
    rmSync(directory, { recursive: true, force: true });
    const oversized = vi.fn().mockResolvedValue(body(new Uint8Array(model.length + 1)));
    await expect(run(oversized)).rejects.toBeInstanceOf(IntegrityError);
    expect(oversized).toHaveBeenCalledOnce();
  });
  it("uses a verified copy (for example from the CI cache) without downloading, and replaces a corrupted one", async () => {
    const url = setup();
    writeFileSync(join(directory, "model.onnx"), model);
    const unused = vi.fn();
    await expect(installRslModel({ directory: url, manifest, fetchImpl: unused, log: () => {} })).resolves.toEqual({ installed: false, attempts: 0 });
    expect(unused).not.toHaveBeenCalled();
    const corrupted = model.slice(); corrupted[0] ^= 1;
    writeFileSync(join(directory, "model.onnx"), corrupted);
    const fetchImpl = vi.fn().mockResolvedValue(body(model));
    await expect(installRslModel({ directory: url, manifest, fetchImpl, log: () => {} })).resolves.toMatchObject({ installed: true });
    expect(readFileSync(join(directory, "model.onnx"))).toEqual(Buffer.from(model));
  });
});
