import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { excludePrivateRoutes } from "../scripts/exclude-private-routes.mjs";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });
async function exportFixture(publicHtml: string) {
  root = await mkdtemp(join(tmpdir(), "signrelay-export-"));
  await mkdir(join(root, "_next/static/chunks"), { recursive: true });
  await mkdir(join(root, "field-test"), { recursive: true });
  for (const chunk of ["shared.js", "capture.js"]) await writeFile(join(root, "_next/static/chunks", chunk), "//");
  await writeFile(join(root, "index.html"), publicHtml);
  await writeFile(join(root, "field-test.html"), '<script src="/_next/static/chunks/shared.js"></script><script src="/_next/static/chunks/capture.js"></script>');
  await writeFile(join(root, "field-test.txt"), "capture rsc");
  await writeFile(join(root, "field-test/__next._tree.txt"), "tree");
}

describe("public export privacy boundary", () => {
  it("removes the capture route and assets only it uses, keeping shared chunks", async () => {
    await exportFixture('<a href="/about">About</a><script src="/_next/static/chunks/shared.js"></script>');
    const result = await excludePrivateRoutes(root);
    expect(result.removedAssets).toEqual(["/_next/static/chunks/capture.js"]);
    expect((await readdir(root)).sort()).toEqual(["_next", "index.html"]);
    expect(await readdir(join(root, "_next/static/chunks"))).toEqual(["shared.js"]);
  });
  it("fails when a public page still links the private route", async () => {
    await exportFixture('<a href="/field-test">Record</a>');
    await expect(excludePrivateRoutes(root)).rejects.toThrow("index.html references /field-test");
  });
});
