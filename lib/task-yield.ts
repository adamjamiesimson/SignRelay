/** Yield one macrotask so queued messages (camera frames, resets, cancels)
 * and due timers run before the caller continues.
 *
 * setTimeout(0) is clamped to at least 4 ms once timers nest five deep, which
 * every cooperative loop reaches after its fifth yield; an ASL-2000 inference
 * yields about 25 times. In browsers a MessageChannel message is an ordinary
 * task, scheduled fairly with worker input and timers, without the clamp.
 * Node delivers a stream of port messages ahead of its timers, so it uses
 * setImmediate, which runs after each timers phase. Verified in Chromium by
 * tests/cooperative-yield-browser-smoke.mjs and in Node by the unit tests.
 */
let channel: MessageChannel | null = null;
const waiting: Array<() => void> = [];

export function yieldToTasks(): Promise<void> {
  if (typeof setImmediate === "function") return new Promise(resolve => setImmediate(resolve));
  if (typeof MessageChannel === "undefined") return new Promise(resolve => setTimeout(resolve, 0));
  if (!channel) {
    channel = new MessageChannel();
    channel.port1.onmessage = () => waiting.shift()?.();
  }
  return new Promise(resolve => { waiting.push(resolve); channel!.port2.postMessage(null); });
}
