import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import lockfile from "../package-lock.json";

const requireFromRoot = createRequire(import.meta.url);

describe("build glob dependency security", () => {
  it("ships a single development-only replacement for the vulnerable package", () => {
    const copies = Object.keys(lockfile.packages).filter(path => path.endsWith("/picomatch"));
    expect(copies).toEqual(["node_modules/picomatch"]);
    expect(lockfile.packages["node_modules/picomatch"].resolved).toBe("tooling/picomatch-no-repeat");
    expect(lockfile.packages["tooling/picomatch-no-repeat"].dev).toBe(true);
  });

  it.each(["vite", "vitest", "tinyglobby"])("blocks repeated extglobs in %s", consumer => {
    const requireFromConsumer = createRequire(requireFromRoot.resolve(`${consumer}/package.json`));
    const matcher = requireFromConsumer("picomatch");
    expect(requireFromConsumer.resolve("picomatch")).toBe(requireFromRoot.resolve("picomatch"));
    for (const pattern of ["+(*)", "+(*a)b", "**/!(x|*(a?))", "src/+(a|aa).ts"]) {
      expect(() => matcher.makeRe(pattern)).toThrow("Repeated extglobs are disabled");
    }
    expect(matcher("src/(*)+", { regex: true })("src/abc")).toBe(false);
    expect(matcher("src/(*)+", { regex: true })("src/abc+")).toBe(true);
    expect(matcher("src/**/!(*.test).{ts,tsx}")("src/nested/main.tsx")).toBe(true);
    expect(matcher("src/**/!(*.test).{ts,tsx}")("src/nested/main.test.tsx")).toBe(false);
  });

  it("covers fdir, POSIX, arrays and explicit parser entry points", () => {
    const requireFromTinyglobby = createRequire(requireFromRoot.resolve("tinyglobby/package.json"));
    const requireFromFdir = createRequire(requireFromTinyglobby.resolve("fdir"));
    expect(requireFromFdir.resolve("picomatch")).toBe(requireFromRoot.resolve("picomatch"));
    const matcher = requireFromFdir("picomatch/posix.js");
    const patterns = ["**/*.ts", "**/!(@(safe|+(*a)))"];
    expect(() => matcher(patterns)).toThrow(/Repeated extglobs/);
    expect(() => matcher.parse(patterns)).toThrow(/Repeated extglobs/);
    expect(() => matcher.makeRe("x/@(literal|*(*a))", { fastpaths: false })).toThrow(/Repeated extglobs/);
    expect(matcher("**/@(read|write).ts")("src/api/read.ts")).toBe(true);
    expect(matcher("literal/\\+value.ts")("literal/+value.ts")).toBe(true);
  });

  it("keeps a suffix question mark after a group a glob wildcard", () => {
    const matcher = requireFromRoot("picomatch");
    expect(matcher("@(a|aa)?")("a")).toBe(false);
    expect(matcher("@(a|aa)?")("az")).toBe(true);
    // Run the historical exponential input in a disposable subprocess.
    const runner = `const matcher = require('picomatch');
      process.stdout.write(String(matcher.makeRe('@(a)?'.repeat(38) + '[0-9]').test('a'.repeat(19) + 'z')));`;
    expect(execFileSync(process.execPath, ["-e", runner], { encoding: "utf8", timeout: 4000 })).toBe("false");
  });
});
