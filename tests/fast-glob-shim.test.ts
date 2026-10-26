import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ESLint } from "eslint";

const require = createRequire(import.meta.url);
type GlobSync = (source: string | string[], options?: Record<string, unknown>) => string[];
const shim = require("../tooling/fast-glob-shim/index.cjs") as { globSync: GlobSync; sync: GlobSync };

let root = "";
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "signrelay-glob-"));
  for (const dir of ["apps/web/pages", "apps/admin/pages", "apps/.hidden/pages", "packages/ui"]) mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, "apps/web/pages/about.js"), "export default function About() { return null; }\n");
  writeFileSync(join(root, "apps/readme.md"), "not a directory\n");
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("reviewed fast-glob replacement", () => {
  it("is what @next/eslint-plugin-next resolves, so braces is never installed", () => {
    const plugin = createRequire(require.resolve("@next/eslint-plugin-next"));
    expect(realpathSync(plugin.resolve("fast-glob"))).toBe(realpathSync(require.resolve("../tooling/fast-glob-shim/index.cjs")));
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
    for (const name of ["braces", "micromatch"]) expect(lock.packages[`node_modules/${name}`]).toBeUndefined();
    expect(lock.packages["node_modules/fast-glob"]).toMatchObject({ link: true, resolved: "tooling/fast-glob-shim" });
  });

  it("matches the plugin's onlyDirectories call like fast-glob (posix paths, no dot directories)", () => {
    const posixRoot = root.replaceAll("\\", "/");
    expect(shim.globSync(`${root}/apps/*`, { onlyDirectories: true }).sort()).toEqual([`${posixRoot}/apps/admin`, `${posixRoot}/apps/web`]);
    expect(shim.globSync("apps/*/pages", { cwd: root, onlyDirectories: true }).sort()).toEqual(["apps/admin/pages", "apps/web/pages"]);
  });

  it("defaults to files only, like fast-glob", () => {
    expect(shim.sync("apps/*", { cwd: root })).toEqual(["apps/readme.md"]);
  });

  it("returns no matches for a missing directory and rejects options it does not implement", () => {
    expect(shim.globSync(`${root}/missing/*`, { onlyDirectories: true })).toEqual([]);
    expect(() => shim.globSync("*", { ignore: ["x"] })).toThrow(/unsupported option "ignore"/);
    expect(() => shim.globSync("*", { dot: true })).toThrow(/unsupported option "dot"/);
  });

  it("keeps @next/next/no-html-link-for-pages working with a configured rootDir", async () => {
    const plugin = require("@next/eslint-plugin-next");
    const eslint = new ESLint({
      cwd: root,
      overrideConfigFile: true,
      overrideConfig: [{
        files: ["**/*.js"],
        languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
        plugins: { "@next/next": plugin },
        settings: { next: { rootDir: `${root}/apps/*/` } },
        rules: { "@next/next/no-html-link-for-pages": "error" },
      }],
    });
    const [result] = await eslint.lintText("export default function Home() { return <a href=\"/about\">About</a>; }\n", { filePath: join(root, "apps/web/pages/index.js") });
    expect(result.messages.map(message => message.ruleId)).toEqual(["@next/next/no-html-link-for-pages"]);
  });
});
