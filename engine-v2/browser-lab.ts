import { VisionEngine } from "../lib/vision-engine";
import { describeAslTemporal } from "../lib/asl-temporal-features";
import { parseAslTemporalModel, predictAslTemporal } from "../lib/asl-temporal-model";
import { seekDecodedFrame, loadVideoData } from "../scripts/diagnostics/video-frame-step";
import { type observation, parseModel, predict, Stream, tensor } from "./core.mjs";
import { tracker } from "./vision.mjs";

async function run(url: string, timestamps: number[], modelUrl: string) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.width = 240;
  document.body.append(video);
  const v1 = await VisionEngine.create();
  const oldModel = parseAslTemporalModel(await (await fetch("/legacy.json")).json());
  const model = modelUrl ? parseModel(await (await fetch(modelUrl)).json()) : null;
  const v2 = model ? await tracker(model.mode) : null;
  const stream = model ? new Stream(model) : null;
  const old = [], independent = [], v2Timings = [], sourceTimes = [], events: string[] = [];
  let last = -Infinity;
  try {
    await loadVideoData(video, url, { timeoutMs: 15000 });
    const aspect = video.videoWidth / video.videoHeight;
    const started = performance.now();
    for (const timestamp of timestamps) {
      if (timestamp <= 0 || timestamp / 1000 >= video.duration) continue;
      // Target the interior of the native decoded frame and use actual browser PTS.
      const sourceMs = 1000 * await seekDecodedFrame(video, (timestamp + 6) / 1000);
      if (sourceMs <= last) continue;
      sourceTimes.push({ requested: timestamp, actual: sourceMs });
      last = sourceMs;
      old.push(v1.process(video, sourceMs));
      if (v2 && stream) {
        const bitmap = await createImageBitmap(video);
        try {
          const { sample, ms } = v2.run(bitmap, sourceMs);
          independent.push(sample);
          const before = performance.now();
          const result = stream.push(sample);
          v2Timings.push({ ...ms, recognize: performance.now() - before });
          if (result?.event) events.push(result.event);
        } finally { bitmap.close(); }
      }
    }
    const description = describeAslTemporal(old);
    return { old, sourceTimes, elapsed: performance.now() - started, aspect, dimensions: [video.videoWidth, video.videoHeight],
      description, oldScore: description ? predictAslTemporal(oldModel, description.features) : null,
      independent: independent.map(sample => ({ h: sample.h, x: sample.x })), v2Timings, events,
      result: model ? predict(model, tensor(independent, model.mode)) : null };
  } finally {
    v1.close();
    v2?.close();
    video.remove();
  }
}

function scoreNative(frames: Parameters<typeof describeAslTemporal>[0], unparsed: unknown) {
  const model = parseAslTemporalModel(unparsed);
  const descriptor = describeAslTemporal(frames);
  return { descriptor, score: descriptor ? predictAslTemporal(model, descriptor.features) : null };
}

function scoreV2(samples: ReturnType<typeof observation>[], unparsed: unknown) {
  const model = parseModel(unparsed);
  const input = tensor(samples, model.mode);
  const stream = new Stream(model);
  const events = samples.flatMap(sample => stream.push(sample)?.event ?? []);
  const reference = new Stream(model, { calibrationReplay: true });
  const calibrationEvents = samples.flatMap(sample => reference.push(sample)?.event ?? []);
  return { input: input && Array.from(input), score: predict(model, input), events, calibrationEvents };
}

Object.assign(window, { replayDevelopmentClip: run, scoreNative, scoreV2 });
