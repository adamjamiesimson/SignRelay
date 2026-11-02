import { afterEach, describe, expect, it, vi } from "vitest";
import { FingerspellingCtcSession } from "../lib/fingerspelling-ctc-session";
import { FINGERSPELLING_CTC_MODEL } from "../lib/fingerspelling-model";

function harness() {
  const ports: ReturnType<typeof port>[] = [];
  function port() { return { postMessage: vi.fn(), terminate: vi.fn(),
    onmessage: null as ((e: MessageEvent) => void) | null, onerror: null as (() => void) | null, onmessageerror: null }; }
  const result = vi.fn(), status = vi.fn();
  const session = new FingerspellingCtcSession(() => { const p = port(); ports.push(p); return p; }, FINGERSPELLING_CTC_MODEL, result, status);
  const emit = (data: object, index = 0) => ports[index].onmessage?.({ data } as MessageEvent);
  const ready = (index = 0) => emit({ type: "ready", epoch: index + 1 }, index);
  const requests = (index = 0) => ports[index].postMessage.mock.calls.map(([d]) => d).filter(d => d.type === "predict");
  const finish = (requestId: number, index = 0) => emit({type:"result",epoch:index+1,requestId,text:"ANNA",status:"uncertain",inferenceMs:1,uncalibratedScore:.8},index);
  const submit = () => session.submit(new Float32Array(20*132),20);
  return {session,ports,result,status,emit,ready,requests,finish,submit};
}
afterEach(() => vi.useRealTimers());
describe("CTC request ownership and bounded scheduling", () => {
  it("reuses an idle initialized model for repeated capture cancellations", () => {
    const h=harness();h.ready();
    for(let i=0;i<100;i++)h.session.reset();
    expect(h.ports).toHaveLength(1);expect(h.ports[0].terminate).not.toHaveBeenCalled();
    h.submit();h.finish(1);expect(h.result).toHaveBeenCalledOnce();h.session.close();
  });
  it("terminates a running WASM request on reset and initializes its replacement", () => {
    const h=harness();h.ready();h.submit();h.session.reset();
    expect(h.ports[0].terminate).toHaveBeenCalledOnce();expect(h.ports).toHaveLength(2);
    h.ready(1);h.submit();h.finish(2,1);expect(h.result).toHaveBeenCalledOnce();h.session.close();
  });
  it("ignores duplicate completions while the next request is running", () => {
    const h=harness();h.ready();h.submit();h.finish(1);h.submit();
    h.finish(1);expect(h.result).toHaveBeenCalledTimes(1);
    h.finish(2);expect(h.result).toHaveBeenCalledTimes(2);h.session.close();
  });
  it("keeps only the latest queued capture and never displays a superseded capture", () => {
    const h=harness();h.ready();for(let i=0;i<100;i++)h.submit();
    expect(h.requests()).toHaveLength(1);h.finish(1);
    expect(h.result).not.toHaveBeenCalled();
    expect(h.requests().map(d=>d.requestId)).toEqual([1,100]);
    h.finish(100);expect(h.result).toHaveBeenCalledOnce();h.session.close();
  });
  it("ignores duplicate ready messages without clearing the inference watchdog", async () => {
    vi.useFakeTimers();const h=harness();h.ready();h.submit();h.ready();
    await vi.advanceTimersByTimeAsync(30001);
    expect(h.status).toHaveBeenLastCalledWith("failed","Fingerspelling inference timed out");
    expect(h.ports[0].terminate).toHaveBeenCalledOnce();h.session.close();
  });
  it("rejects a prior generation after reset, even if its epoch and request id match", () => {
    const h=harness();h.ready();h.submit();const callback=h.ports[0].onmessage;
    h.session.reset();h.ready(1);h.submit();
    callback?.({data:{type:"result",epoch:1,requestId:1,text:"OLD"}} as MessageEvent);
    expect(h.result).not.toHaveBeenCalled();h.finish(2,1);expect(h.result).toHaveBeenCalledOnce();h.session.close();
  });
  it("cancels startup and releases pending sequences without resurrecting a closed session", () => {
    const h=harness();h.submit();h.session.close();h.ready();h.session.reset();h.submit();
    expect(h.ports).toHaveLength(1);expect(h.requests()).toHaveLength(0);expect(h.result).not.toHaveBeenCalled();
    expect(h.ports[0].terminate).toHaveBeenCalledOnce();
  });
});
