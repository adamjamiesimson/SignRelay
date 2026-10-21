import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { demoExportProblems } from "../scripts/demo.mjs";

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
