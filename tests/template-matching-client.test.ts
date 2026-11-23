import { afterEach, describe, expect, it, vi } from "vitest";
import { TemplateMatchingClient, type MatchInput, type MatchOutput } from "../lib/template-matching-client";
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
