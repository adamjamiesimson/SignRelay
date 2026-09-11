import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });
async function setup(choice: string, signal = false) {
  vi.stubEnv("NEXT_PUBLIC_GA_MEASUREMENT_ID", "G-TEST123456");
  vi.resetModules();
  const target = { dataLayer: [] as unknown[] };
  const elements = new Map<string, unknown>();
  const appendChild = vi.fn((s: { id: string }) => elements.set(s.id, s));
  vi.stubGlobal("window", target);
  vi.stubGlobal("navigator", { doNotTrack: signal ? "1" : "0" });
  vi.stubGlobal("location", { pathname: "/privacy", search: "?transcript=private", hostname: "signrelay.web.app", reload: vi.fn() });
  let consent = JSON.stringify({ choice, savedAt: Date.now() });
  vi.stubGlobal("localStorage", { getItem: () => consent, setItem: (_: string, value: string) => { consent = value; } });
  vi.stubGlobal("document", { getElementById: (id: string) => elements.get(id), createElement: () => ({}), head: { appendChild }, cookie: "" });
  return { api: await import("../lib/analytics-consent"), target, appendChild };
}
it("does not request analytics after rejection or a browser privacy signal", async () => {
  for (const [choice, signal] of [["rejected", false], ["accepted", true]] as const) {
    const { api, appendChild } = await setup(choice, signal);
    api.startAnalytics(); expect(appendChild).not.toHaveBeenCalled();
  }
});
it("loads only once after consent and excludes search/referrer content", async () => {
  const { api, target, appendChild } = await setup("accepted");
  api.startAnalytics(); api.startAnalytics();
  expect(appendChild).toHaveBeenCalledTimes(1);
  const events = target.dataLayer.map(value => Array.from(value as ArrayLike<unknown>));
  expect(events.at(-1)).toEqual(["event", "page_view", { page_location: "https://signrelay.web.app/privacy", page_title: "/privacy", page_referrer: "" }]);
  expect(JSON.stringify(events)).not.toContain("transcript");
  api.saveConsent("rejected");
  expect(api.readConsent()).toBe("rejected");
  expect(location.reload).toHaveBeenCalledOnce();
});
