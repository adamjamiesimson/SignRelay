import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RESEARCH_EXPORT_MARKER } from "../lib/release-flags.mjs";

const server = resolve("scripts/serve-export.mjs");
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "signrelay-private-serve-"));
  await mkdir(join(directory, "out"));
  await writeFile(join(directory, "out", "index.html"), "SignRelay");
  // Even an older private export whose marker is missing must stay protected.
  await writeFile(join(directory, "out", "study.html"), "Private study");
  await writeFile(join(directory, "out", ".marker"), "Protected file");
});

afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("private study static server", () => {
  it("rejects a non-loopback HTTP bind and incomplete TLS options", () => {
    const run = (...args: string[]) => execFileSync(process.execPath, [server, ...args],
      { cwd: directory, stdio: "pipe", timeout: 5000 });
    expect(() => run("--host", "0.0.0.0", "--port", "0")).toThrow(/Private exports require loopback HTTP or trusted HTTPS/);
    expect(() => run("--tls-cert", "cert.pem", "--port", "0")).toThrow(/Specify both --tls-cert and --tls-key/);
  });

  it("protects a marked research export even without private study routes", async () => {
    await unlink(join(directory, "out", "study.html"));
    await writeFile(join(directory, "out", RESEARCH_EXPORT_MARKER), "Research only");
    expect(() => execFileSync(process.execPath, [server, "--host", "0.0.0.0", "--port", "0"],
      { cwd: directory, stdio: "pipe", timeout: 5000 })).toThrow(/Private exports require loopback HTTP or trusted HTTPS/);
  });

  it("binds to loopback by default and serves private pages with no-store", async () => {
    const child = spawn(process.execPath, [server, "--port", "0"], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
    const closed = once(child, "close");
    try {
      const [chunk] = await Promise.race([once(child.stdout, "data"), closed]);
      const port = /HTTP on 127\.0\.0\.1:(\d+)/.exec(String(chunk))?.[1];
      expect(port).toBeDefined();
      const response = await fetch(`http://127.0.0.1:${port}/study`);
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.text()).toBe("Private study");
      const metadata = await fetch(`http://127.0.0.1:${port}/study`, { method: "HEAD" });
      expect(metadata.status).toBe(200);
      expect(metadata.headers.get("Content-Length")).toBe(String(Buffer.byteLength("Private study")));
      expect(await metadata.text()).toBe("");
      const hidden = await fetch(`http://127.0.0.1:${port}/%5C.marker`);
      expect(hidden.status).toBe(404);
      expect(await hidden.text()).toBe("Not found");
    } finally {
      child.kill();
      await closed;
    }
  });
});
