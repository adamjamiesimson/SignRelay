// Local evaluation only. A presentation callback and a completed seek are
// separate browser events; neither on its own establishes a usable sample.
type WaitOptions = { signal?: AbortSignal; timeoutMs?: number };

export function loadVideoData(video: HTMLVideoElement, source: string, { signal, timeoutMs = 10000 }: WaitOptions = {}) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("loadeddata", loaded);
      video.removeEventListener("error", failed);
      signal?.removeEventListener("abort", aborted);
    };
    const fail = (error: unknown) => { cleanup(); reject(error); };
    const loaded = () => { cleanup(); resolve(); };
    const failed = () => fail(new Error(`Video could not decode: ${video.error?.message ?? "unknown media error"}`));
    const aborted = () => fail(signal?.reason ?? new Error("Diagnostic stopped"));
    const timer = setTimeout(() => fail(new Error("Video data loading timed out")), timeoutMs);
    video.addEventListener("loadeddata", loaded);
    video.addEventListener("error", failed);
    signal?.addEventListener("abort", aborted, { once: true });
    try { video.src = source; video.load(); } catch (error) { fail(error); }
  });
}

export function seekDecodedFrame(video: HTMLVideoElement, target: number, { signal, timeoutMs = 3000 }: WaitOptions = {}) {
  return new Promise<number>((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    let callbackId: number | undefined, mediaTime: number | undefined, seeked = false, settled = false;
    const started = performance.now();
    const cleanup = () => {
      settled = true;
      clearTimeout(timer);
      if (callbackId !== undefined) video.cancelVideoFrameCallback(callbackId);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", failed);
      video.removeEventListener("emptied", emptied);
      signal?.removeEventListener("abort", aborted);
    };
    const fail = (error: unknown) => { cleanup(); reject(error); };
    const finish = () => {
      if (!seeked || video.seeking || video.readyState < 2 || mediaTime === undefined) return;
      cleanup(); resolve(mediaTime);
    };
    const onSeeked = () => { seeked = true; finish(); };
    const onFrame: VideoFrameRequestCallback = (_now, info) => {
      if (settled) return;
      callbackId = undefined;
      if (!Number.isFinite(info.mediaTime) || !Number.isFinite(info.presentationTime)) {
        fail(new Error("Video callback has invalid source-frame metadata")); return;
      }
      // A previously queued presentation can arrive after a new seek starts.
      // Keep waiting within the original deadline; never assign target as PTS.
      if (info.presentationTime >= started) mediaTime = info.mediaTime;
      if (mediaTime === undefined || !seeked || video.seeking || video.readyState < 2) {
        try { callbackId = video.requestVideoFrameCallback(onFrame); } catch (error) { fail(error); return; }
      }
      finish();
    };
    const failed = () => fail(new Error(`Video could not decode: ${video.error?.message ?? "unknown media error"}`));
    const emptied = () => fail(new Error("Video source was released during frame delivery"));
    const aborted = () => fail(signal?.reason ?? new Error("Diagnostic stopped"));
    const timer = setTimeout(() => fail(new Error(`Video frame delivery timed out (target=${target.toFixed(6)}s; current=${video.currentTime.toFixed(6)}s; seeked=${seeked}; callback=${mediaTime !== undefined}; readyState=${video.readyState})`)), timeoutMs);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", failed);
    video.addEventListener("emptied", emptied);
    signal?.addEventListener("abort", aborted, { once: true });
    try {
      callbackId = video.requestVideoFrameCallback(onFrame);
      video.currentTime = target;
    } catch (error) { fail(error); }
  });
}
