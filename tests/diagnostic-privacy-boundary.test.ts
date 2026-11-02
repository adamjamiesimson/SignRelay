import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Landmark traces and run fingerprints are local diagnostics. Production code
// must not route them toward the UI, storage, analytics or exports. This is a
// static guard: a new call site fails here and needs an explicit privacy review.
const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx|mjs|js)$/.test(name) ? [path] : [];
});
const production = [...files("app"), ...files("components"), ...files("lib"), ...files("workers")];
const source = (path: string) => readFileSync(path, "utf8");

describe("diagnostic privacy boundary", () => {
  it("never calls the landmark trace export from production code", () => {
    const callers = production.filter(path => path !== join("lib", "fingerspelling-capture.ts") && /\.trace\(\)|fromTrace\(/.test(source(path)));
    expect(callers).toEqual([]);
  });
  it("keeps run fingerprints out of components, storage, analytics and the research export", () => {
    const allowed = new Set(["lib/pipeline-fingerprint.ts", "lib/fingerspelling-capture.ts", "lib/fingerspelling-ctc-runtime.ts"].map(p => join(...p.split("/"))));
    const users = production.filter(path => !allowed.has(path) && /fingerprint/i.test(source(path)));
    expect(users).toEqual([]);
  });
  it("sends analytics page views only, with no recognition or capture payload", () => {
    const events = [...source("lib/analytics-consent.ts").matchAll(/gtag\("event",\s*"([^"]+)"/g)].map(m => m[1]);
    expect(events).toEqual(["page_view"]);
    for (const path of production) expect(source(path).includes("gtag(") ? path : null, path).toSatisfy((p: string | null) => p === null || p.endsWith("analytics-consent.ts"));
  });
});
