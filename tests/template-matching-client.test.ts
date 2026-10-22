import { afterEach, describe, expect, it, vi } from "vitest";
import { packTemplates, TemplateMatchingClient, unpackTemplates, type MatchInput, type MatchOutput } from "../lib/template-matching-client";
import { prepareCalibrationSequence, recognizePersonalTemplate } from "../lib/personalized-recognition";
import type { CalibrationTemplate } from "../lib/vision-types";
import { makeSign } from "./fixtures/asl-motion";

function harness() {
  const ports: Array<ReturnType<typeof port>> = [];
  function port() { return { postMessage: vi.fn(), terminate: vi.fn(),
    onmessage: null as ((event: MessageEvent) => void) | null, onerror: null as ((event: ErrorEvent) => void) | null, onmessageerror: null as ((event: MessageEvent) => void) | null }; }
  const result = vi.fn(), error = vi.fn();
  const client = new TemplateMatchingClient("psl", result, error, () => {
    const worker = port(); ports.push(worker); return worker;
  });
  const frames = (timestamp: number) => makeSign("HELLO").map(f => ({ ...f, timestamp: f.timestamp + timestamp }));
  const requests = (index = 0) => ports[index].postMessage.mock.calls.map(([m]) => m as MatchInput).filter(m => m.type === "match");
  const finish = (request = requests().at(-1)!, index = 0) => ports[index].onmessage?.({ data: {
    id: request.id, generation: request.generation, prediction: { label: "BOOK", text: "Book", confidence: 0.9 },
  } satisfies MatchOutput } as MessageEvent<MatchOutput>);
  return { client, ports, result, error, frames, requests, finish };
}
afterEach(() => vi.useRealTimers());
describe("bounded template matching lane", () => {
  it("posts one scan, replaces intermediate frames, and posts only the newest queued snapshot", () => {
    const h = harness();
    for (let i = 0; i < 200; i++) h.client.submit(h.frames(i * 50));
    expect(h.requests()).toHaveLength(1);
    h.finish();
    expect(h.result).not.toHaveBeenCalled(); // first result is >2.5s old
    expect(h.requests()).toHaveLength(2);
    expect(h.requests()[1].frames.at(-1)?.timestamp).toBe(h.frames(9950).at(-1)?.timestamp);
    h.finish(); expect(h.result).toHaveBeenCalledOnce();
    h.client.terminate();
  });
  it("cancels old sessions and does not free their active slot prematurely", () => {
    const h = harness(); h.client.submit(h.frames(0)); const old = h.requests()[0];
    h.client.reset(); h.client.submit(h.frames(500));
    expect(h.requests()).toHaveLength(1);
    h.finish(old); expect(h.result).not.toHaveBeenCalled();
    expect(h.requests()).toHaveLength(2);
    h.finish(); expect(h.result).toHaveBeenCalledOnce();
    h.client.terminate();
  });
  it("ignores duplicate completions and results after termination", () => {
    const h = harness(); h.client.submit(h.frames(0)); const first = h.requests()[0];
    h.finish(first); h.finish(first); expect(h.result).toHaveBeenCalledOnce();
    const callback = h.ports[0].onmessage;
    h.client.terminate(); callback?.({ data: { id: first.id, generation: first.generation, prediction: null } } as MessageEvent);
    expect(h.result).toHaveBeenCalledOnce(); expect(h.ports[0].terminate).toHaveBeenCalledOnce();
  });
  it("times out only the matching worker, backs off, and rejects its late result", async () => {
    vi.useFakeTimers();
    const h = harness(); h.client.submit(h.frames(0)); const callback = h.ports[0].onmessage;
    const first = h.requests()[0];
    await vi.advanceTimersByTimeAsync(120001);
    expect(h.ports[0].terminate).toHaveBeenCalledOnce(); expect(h.error).toHaveBeenCalledOnce();
    h.client.submit(h.frames(120000)); expect(h.ports).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5001);
    h.client.submit(h.frames(125000)); expect(h.ports).toHaveLength(2);
    callback?.({ data: { id: first.id, generation: first.generation, prediction: { label: "OLD" } } } as MessageEvent);
    expect(h.result).not.toHaveBeenCalled();
    h.finish(h.requests(1)[0], 1); expect(h.result).toHaveBeenCalledOnce();
    h.client.terminate();
  });
  it("does not launch a personal worker when there are no saved examples", () => {
    const create = vi.fn(); const client = new TemplateMatchingClient("personal", vi.fn(), vi.fn(), create);
    client.submit(makeSign("HELLO")); expect(create).not.toHaveBeenCalled(); client.terminate();
  });
  it("gives loading a longer deadline and starts a fresh matching deadline after download", async () => {
    vi.useFakeTimers(); const h = harness(); h.client.submit(h.frames(0)); const request = h.requests()[0];
    const phase = (value: "loading" | "matching") => h.ports[0].onmessage?.({ data: {
      id: request.id, generation: request.generation, prediction: null, phase: value,
    } } as MessageEvent<MatchOutput>);
    phase("loading"); await vi.advanceTimersByTimeAsync(180000);
    expect(h.error).not.toHaveBeenCalled();
    phase("matching"); await vi.advanceTimersByTimeAsync(20001);
    expect(h.error).toHaveBeenCalledOnce(); h.client.terminate();
  });
  it("rejects a delayed result even when no newer camera timestamp has arrived", async () => {
    vi.useFakeTimers(); const h = harness(); h.client.submit(h.frames(0));
    await vi.advanceTimersByTimeAsync(2501); h.finish();
    expect(h.result).not.toHaveBeenCalled(); h.client.terminate();
  });
  it("drops an expired queued snapshot instead of scanning it after a slow load", async () => {
    vi.useFakeTimers(); const h = harness(); h.client.submit(h.frames(0));
    h.client.submit(h.frames(50));
    await vi.advanceTimersByTimeAsync(2501); h.finish();
    expect(h.requests()).toHaveLength(1); expect(h.result).not.toHaveBeenCalled();
    h.client.submit(h.frames(3000)); expect(h.requests()).toHaveLength(2);
    h.finish(); expect(h.result).toHaveBeenCalledOnce(); h.client.terminate();
  });
});

describe("template transport to the matcher", () => {
  const example = (id: string, gloss: string, offset: number, width = 240): CalibrationTemplate => ({
    id, gloss, text: gloss.toLowerCase(), language: "csl", createdAt: offset,
    frames: prepareCalibrationSequence(makeSign("HELLO")).map((row, r) =>
      row.slice(0, width).map((value, k) => k % 7 === 0 ? value : value + offset * 0.013 + r * 1e-9)),
  });
  it("round-trips every value exactly, including legacy 208-feature rows, -0 and non-finite values", () => {
    const legacy = example("legacy", "OLD", 2, 208);
    legacy.frames[3][5] = -0; legacy.frames[4][6] = Number.NaN;
    const templates = [example("a", "BOOK", 1), legacy, { ...example("b", "BOOK", 3), language: undefined }];
    const packed = packTemplates(templates);
    expect(packed.values).toBeInstanceOf(Float64Array);
    const restored = unpackTemplates(structuredClone(packed));
    expect(restored).toEqual(templates);
    expect(Object.is(restored[1].frames[3][5], -0)).toBe(true);
    expect(restored.map(t => "language" in t)).toEqual(templates.map(t => "language" in t));
  });
  it("gives the same personal decision from transported templates", () => {
    const templates = [example("a", "BOOK", 0), example("b", "BOOK", 1), example("c", "TREE", 9), example("d", "LAMP", 30)];
    const restored = unpackTemplates(packTemplates(templates));
    for (const sign of ["HELLO", "THANK YOU", "PLEASE", "SORRY", "YES", "NO"] as const) {
      const frames = makeSign(sign);
      expect(recognizePersonalTemplate(frames, restored)).toEqual(recognizePersonalTemplate(frames, templates));
    }
    expect(recognizePersonalTemplate(makeSign("HELLO"), restored)?.label).toBe("BOOK");
  });
  it("transfers one buffer instead of cloning nested arrays, and starts a personal matcher when templates arrive", () => {
    const ports: Array<{ postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn>; onmessage: null; onerror: null; onmessageerror: null }> = [];
    const create = vi.fn(() => { const port = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null, onmessageerror: null }; ports.push(port); return port; });
    const client = new TemplateMatchingClient("personal", vi.fn(), vi.fn(), create);
    client.configure([]);
    expect(create).not.toHaveBeenCalled();
    client.configure([example("a", "BOOK", 1)]);
    expect(create).toHaveBeenCalledOnce();
    const [message, transfer] = ports[0].postMessage.mock.calls.find(([m]) => m.type === "configure")!;
    expect(transfer).toEqual([message.templates.values.buffer]);
    expect(unpackTemplates(message.templates)[0].gloss).toBe("BOOK");
    client.configure([example("b", "TREE", 2)]);
    expect(create).toHaveBeenCalledOnce();
    expect(ports[0].postMessage.mock.calls.filter(([m]) => m.type === "configure")).toHaveLength(2);
    client.terminate();
  });
  it("keeps the PSL matcher lazy, so its references download only when PSL is used", () => {
    const create = vi.fn(); const client = new TemplateMatchingClient("psl", vi.fn(), vi.fn(), create);
    client.configure([]); expect(create).not.toHaveBeenCalled(); client.terminate();
  });
});

describe("matcher crash recovery", () => {
  it("disposes a crashed matcher, backs off, ignores its late result, and re-sends templates to the replacement", async () => {
    vi.useFakeTimers();
    const ports: Array<{ postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn>; onmessage: ((event: MessageEvent<MatchOutput>) => void) | null; onerror: (() => void) | null; onmessageerror: null }> = [];
    const result = vi.fn(), error = vi.fn();
    const client = new TemplateMatchingClient("personal", result, error, () => {
      const port = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null, onmessageerror: null }; ports.push(port); return port;
    });
    const saved = [{ id: "a", gloss: "BOOK", text: "Book", createdAt: 1, language: "csl" as const, frames: prepareCalibrationSequence(makeSign("HELLO")) }];
    client.configure(saved);
    client.submit(makeSign("HELLO"));
    const crashed = ports[0], handler = crashed.onmessage;
    const request = crashed.postMessage.mock.calls.map(([m]) => m as MatchInput).find(m => m.type === "match") as Extract<MatchInput, { type: "match" }>;
    crashed.onerror?.();
    expect(error).toHaveBeenCalledOnce();
    expect(crashed.terminate).toHaveBeenCalledOnce();
    handler?.({ data: { id: request.id, generation: request.generation, prediction: { label: "BOOK", text: "Book", confidence: 0.9 } } } as MessageEvent<MatchOutput>);
    expect(result).not.toHaveBeenCalled();
    client.submit(makeSign("HELLO"));
    expect(ports).toHaveLength(1); // still backing off
    await vi.advanceTimersByTimeAsync(5001);
    client.submit(makeSign("HELLO"));
    expect(ports).toHaveLength(2);
    const configure = ports[1].postMessage.mock.calls.map(([m]) => m as MatchInput).find(m => m.type === "configure") as Extract<MatchInput, { type: "configure" }>;
    expect(unpackTemplates(configure.templates)).toEqual(saved);
    client.terminate();
  });
});
