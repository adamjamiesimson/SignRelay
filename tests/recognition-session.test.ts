import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecognitionSession } from "../lib/recognition-session";
import type { WorkerInput, WorkerMessage } from "../lib/vision-types";

class FakeWorker {
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn<(message: WorkerInput) => void>();
  terminate = vi.fn();
  frames() { return this.postMessage.mock.calls.map(([message]) => message).filter(message => message.type === "frame"); }
  acknowledge(frame = this.frames().at(-1)!) {
    this.onmessage?.({ data: { type: "analysis", session: frame.session, frameId: frame.frameId,
      state: "listening", candidate: null, confidence: 0, bufferSize: 1,
    } } as MessageEvent<WorkerMessage>);
  }
}

let workers: FakeWorker[], session: RecognitionSession;
const onMessage = vi.fn(), onStatus = vi.fn();
const send = (timestamp: number) => session.postMessage({ type: "frame", frame: { timestamp, hands: [], face: [], pose: [] } });
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  workers = [];
  session = new RecognitionSession(() => { const worker = new FakeWorker(); workers.push(worker); return worker; }, onMessage, onStatus);
});
afterEach(() => { session.terminate(); vi.useRealTimers(); });

describe("ongoing recognition sessions", () => {
  it("bounds a stalled camera queue and resumes using the latest frame", () => {
    for (let index = 0; index < 1000; index++) send(index * 50);
    expect(workers[0].frames()).toHaveLength(1);
    workers[0].acknowledge();
    expect(workers[0].frames()).toHaveLength(2);
    expect(workers[0].frames()[1].frame.timestamp).toBe(49950);
    workers[0].acknowledge();
    send(50000);
    expect(workers[0].frames()).toHaveLength(3);
  });
  it("restarts a hung worker with the selected language and saved templates", () => {
    const templates = [{ id: "saved", language: "bsl" as const, gloss: "HELLO", text: "Hello", createdAt: 1, frames: [[1]] }];
    session.postMessage({ type: "templates", language: "bsl", templates });
    send(1);
    vi.advanceTimersByTime(8000);
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(workers).toHaveLength(2);
    expect(workers[1].postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "templates", language: "bsl", templates }));
    send(9000);
    workers[1].acknowledge();
    expect(onMessage).toHaveBeenCalledOnce();
    expect(onStatus).toHaveBeenLastCalledWith({ state: "running", message: "" });
  });
  it.each(["onerror", "onmessageerror"] as const)("recovers after %s without clearing previous transcript messages", event => {
    send(1); workers[0].acknowledge();
    workers[0][event]?.();
    expect(workers).toHaveLength(2);
    send(50); workers[1].acknowledge();
    expect(onMessage).toHaveBeenCalledTimes(2);
  });
  it("drops late output from an old worker and old language session", () => {
    send(1);
    const oldWorkerMessage = workers[0].onmessage!;
    const oldFrame = workers[0].frames()[0];
    session.postMessage({ type: "templates", language: "isl", templates: [] });
    oldWorkerMessage({ data: { type: "confirmed", session: oldFrame.session, text: "Old", gloss: "OLD", confidence: 0.9, timestamp: 1 } } as MessageEvent<WorkerMessage>);
    expect(onMessage).not.toHaveBeenCalled();
    workers[0].onerror?.();
    oldWorkerMessage({ data: { type: "confirmed", session: oldFrame.session, text: "Old", gloss: "OLD", confidence: 0.9, timestamp: 1 } } as MessageEvent<WorkerMessage>);
    expect(onMessage).not.toHaveBeenCalled();
  });
  it("resets queued frames when the camera pauses, without false watchdog restarts", () => {
    send(1); send(50);
    session.postMessage({ type: "reset" });
    vi.advanceTimersByTime(60000);
    expect(workers).toHaveLength(1);
    send(60050);
    workers[0].acknowledge();
    expect(onMessage).toHaveBeenCalledOnce();
  });
  it("recovers a model timeout even when the worker still responds to frames", () => {
    send(1);
    workers[0].onmessage?.({ data: { type: "fault", session: workers[0].frames()[0].session, message: "Model timed out" } } as MessageEvent<WorkerMessage>);
    expect(workers).toHaveLength(2);
    expect(workers[0].terminate).toHaveBeenCalledOnce();
  });
  it("limits automatic restarts and allows an explicit retry", () => {
    for (let attempt = 0; attempt < 3; attempt++) workers.at(-1)!.onerror?.();
    expect(workers).toHaveLength(3);
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ state: "failed" }));
    send(1);
    vi.advanceTimersByTime(20000);
    expect(workers).toHaveLength(3);
    session.restart();
    expect(workers).toHaveLength(4);
    send(21000); workers[3].acknowledge();
    expect(onMessage).toHaveBeenCalledOnce();
  });
  it("does not restart or post after the session is closed", () => {
    send(1);
    session.terminate();
    vi.advanceTimersByTime(60000);
    send(61000); session.restart();
    expect(workers).toHaveLength(1);
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(workers[0].frames()).toHaveLength(1);
  });
});
