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
});
