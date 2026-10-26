import { describe, expect, it } from "vitest";
import { browserInternal } from "./helpers/browser-internal.mjs";

describe("strict offline check: what the browser process itself may open", () => {
  it("excuses only the measured browser-internal tunnels and Chrome's own update check", () => {
    expect(browserInternal("CONNECT update.googleapis.com:443")).toBe(true);
    expect(browserInternal("CONNECT accounts.google.com:443")).toBe(true);
    expect(browserInternal("POST http://update.googleapis.com/service/update2/json?cup2key=ML-DSA-44-16:abc&cup2hreq=0acd")).toBe(true);
    expect(browserInternal("POST http://update.googleapis.com/service/update2/json")).toBe(true);
  });
  it("still flags everything else, including look-alike hosts, other paths and other methods", () => {
    for (const line of [
      "CONNECT example.org:443", "CONNECT cdn.jsdelivr.net:443", "CONNECT update.googleapis.com:80",
      "GET http://update.googleapis.com/service/update2/json", "POST http://update.googleapis.com/service/other",
      "POST http://update.googleapis.com.example.org/service/update2/json", "POST http://example.org/service/update2/json",
      "GET http://example.org/", "POST https://update.googleapis.com/service/update2/json",
    ]) expect(browserInternal(line), line).toBe(false);
  });
});
