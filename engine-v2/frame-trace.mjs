// The diagnostic ring contains timing and state transitions only.
export class FrameTrace {
  constructor(capacity = 600) {
    this.capacity = capacity;
    this.frames = [];
    this.next = 0;
    this.sequence = 0;
    this.counters = {
      presented: 0, cameraFramesRead: 0, callbackGaps: 0, accepted: 0, queued: 0, busy: 0, replaced: 0,
      stale: 0, invalidTimestamp: 0,
      captured: 0, sent: 0, processed: 0, handDetected: 0, handMissing: 0, usableHand: 0,
      malformedHands: 0, offscreenHands: 0, segmentationAdmitted: 0, segmentationResets: 0,
      resetSamples: 0, capacityEvictedSamples: 0, modelWindows: 0, rejectedWindows: 0, modelSlots: 0, modelSourceFrames: 0,
      suggestions: 0, cancelled: 0, workerError: 0, captureError: 0, maxOccupancy: 0,
    };
  }
  present(sourceMs, at, sourceIndex = null, gaps = 0, presented = true) {
    if (presented) this.counters.presented += 1 + gaps;
    else this.counters.cameraFramesRead++;
    this.counters.callbackGaps += gaps;
    const record = { id: ++this.sequence, sourceMs, sourceIndex, at, stage: presented ? "presented" : "camera-read",
      ...(gaps ? { gaps } : {}) };
    if (this.capacity) {
      this.frames[this.next] = record;
      this.next = (this.next + 1) % this.capacity;
    }
    return record;
  }
  mark(frame, stage) {
    this.counters[stage]++;
    frame.stage = stage;
  }
  occupy(count) {
    this.counters.maxOccupancy = Math.max(this.counters.maxOccupancy, count);
  }
  complete(frame, data, receivedAt = performance.now()) {
    this.mark(frame, "processed");
    const { hand, detected, detection, segmentation } = data;
    this.counters[detected ? "handDetected" : "handMissing"]++;
    this.counters.usableHand += Number(hand);
    this.counters.malformedHands += detection.malformed;
    this.counters.offscreenHands += detection.offscreen;
    this.counters.segmentationAdmitted++;
    this.counters.segmentationResets += Number(segmentation.reset);
    this.counters.resetSamples += segmentation.resetSamples;
    this.counters.capacityEvictedSamples += segmentation.capacityEvicted;
    this.counters.modelWindows += segmentation.windows.length;
    this.counters.rejectedWindows += segmentation.rejected;
    this.counters.suggestions += Number(!!data.result?.event);
    for (const window of segmentation.windows) {
      this.counters.modelSlots += window.ids.length;
      this.counters.modelSourceFrames += new Set(window.ids).size;
    }
    Object.assign(frame, { receivedAt, workerReceivedAt: data.workerReceivedAt,
      workerFinishedAt: data.workerFinishedAt, ms: data.ms, hand, detected, detection, pose: data.pose, segmentation,
      event: data.result?.event ?? null });
  }
  snapshot() {
    const frames = this.frames.length === this.capacity
      ? [...this.frames.slice(this.next), ...this.frames.slice(0, this.next)] : this.frames;
    return { counters: { ...this.counters }, frames, ...(this.isolatedInput ? { isolatedInput: this.isolatedInput } : {}) };
  }
}
