import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { demoExportProblems, portProblem, serveBanner } from "../scripts/demo.mjs";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const exportDir = (manifest?: object) => {
  const root = mkdtempSync(join(tmpdir(), "demo-"));
  dirs.push(root);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "index.html"), "<html></html>");
  if (manifest) writeFileSync(join(root, "runtime-manifest.json"), JSON.stringify(manifest));
  return root;
};
const ok = () => ({ status: 0, stdout: "", stderr: "" });

describe("offline demo command", () => {
  it("prints the recorded evidence from the manifest verify-runtime writes", () => {
    const manifest = { recognition_worker_sha256: "ccce84c876f95caf", matches_committed_worker: true,
      real_video_evidence: { outcome: { signed_trials: 11, correct: 5, wrong_accepted: 0, abstained: 6, errors: 0 }, evidence: ["x"] } };
    const banner = serveBanner(manifest, "3000");
    expect(banner).toContain("http://127.0.0.1:3000/");
    expect(banner).toContain("Recorded development evidence: 5 of 11 previously inspected publisher clips correct, 0 wrong, 6 no match.");
    expect(banner).not.toContain("undefined");
    expect(serveBanner({ ...manifest, real_video_evidence: null }, "3000")).toContain("No real-video development evidence");
  });
  it("refuses to serve without an export or manifest", () => {
    expect(demoExportProblems(join(tmpdir(), "does-not-exist-signrelay"), ok)[0]).toContain("demo:prepare");
    expect(demoExportProblems(exportDir(), ok)[0]).toContain("runtime-manifest.json is missing");
  });
  it("refuses the full multilingual export", () => {
    expect(demoExportProblems(exportDir({ profile: "full" }), ok)[0]).toContain("is the full build, not the ASL demo");
  });
  it("refuses an ASL demo export whose runtime no longer verifies", () => {
    const failed = () => ({ status: 1, stdout: "models/asl2000-tgcn/model.json does not match sha256.txt", stderr: "" });
    expect(demoExportProblems(exportDir({ profile: "asl-demo" }), failed)[0]).toContain("does not match sha256.txt");
  });
  it("accepts a verified ASL demo export", () => {
    expect(demoExportProblems(exportDir({ profile: "asl-demo" }), ok)).toEqual([]);
  });
});

describe("demo port already in use", () => {
  const occupy = async () => {
    const server = createServer();
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    return { server, port: String((server.address() as AddressInfo).port) };
  };
  it("refuses a port another program holds, before any banner, and accepts a free one", async () => {
    const { server, port } = await occupy();
    try {
      const problem = await portProblem(port);
      expect(problem).toContain(`Port ${port} on 127.0.0.1 is already in use`);
      expect(problem).toContain("would not show this verified demo build");
      expect(problem).toContain("--port 3001");
    } finally { await new Promise(resolve => server.close(resolve)); }
    expect(await portProblem(port)).toBeNull();
    expect(await portProblem("not-a-port")).toContain("Cannot serve on 127.0.0.1:not-a-port");
  });
  it("serve-export exits with a plain message instead of a stack trace", async () => {
    const { server, port } = await occupy();
    try {
      const root = exportDir();
      mkdirSync(join(root, "out"));
      writeFileSync(join(root, "out", "index.html"), "<html></html>");
      const result = spawnSync(process.execPath, [join(process.cwd(), "scripts/serve-export.mjs"), "--host", "127.0.0.1", "--port", port], { cwd: root, encoding: "utf8", timeout: 10000 });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`Port ${port} on 127.0.0.1 is already in use by another program. Nothing was served`);
      expect(result.stderr).not.toContain("node:events");
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
});
