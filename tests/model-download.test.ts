import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadModelBytes } from "../lib/model-download";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("interruptible model download (separate from inference)", () => {
  it("allows a progressing slow stream beyond the inference deadline", async () => {
    vi.useFakeTimers();
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(controller) { stream = controller; } }))));
    const task = downloadModelBytes("/model", { timeoutMs: 300000, idleMs: 45000 });
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(30000); stream.enqueue(new Uint8Array([i]));
      await vi.advanceTimersByTimeAsync(0);
    }
    stream.close(); await expect(task).resolves.toEqual(new Uint8Array([0, 1, 2, 3]));
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels an idle body and clears timers instead of hanging forever", async () => {
    vi.useFakeTimers(); const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }))));
    const task = downloadModelBytes("/model", { idleMs: 100 });
    const assertion = expect(task).rejects.toThrow("stopped making progress");
    await vi.advanceTimersByTimeAsync(101); await assertion;
    expect(cancel).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it("aborts on a camera/language reset and allows a new complete download", async () => {
    const cancel = vi.fn(), controller = new AbortController();
    const fetch = vi.fn().mockResolvedValueOnce(new Response(new ReadableStream({ cancel })))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2])));
    vi.stubGlobal("fetch", fetch);
    const task = downloadModelBytes("/model", { signal: controller.signal });
    const assertion = expect(task).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve(); controller.abort(); await assertion;
    expect(cancel).toHaveBeenCalledOnce(); await expect(downloadModelBytes("/model")).resolves.toEqual(new Uint8Array([1, 2]));
  });
  it("rejects truncated, oversized, empty and interrupted downloads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([1]), { headers: { "content-length": "3" } })));
    await expect(downloadModelBytes("/model")).rejects.toThrow("incomplete");
    await expect(downloadModelBytes("/model", { maxBytes: 2 })).rejects.toThrow("size limit");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array())));
    await expect(downloadModelBytes("/model")).rejects.toThrow("incomplete");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.error(new Error("connection interrupted")); } }))));
    await expect(downloadModelBytes("/model")).rejects.toThrow("connection interrupted");
  });
});
