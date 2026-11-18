import { parseModel, predict, Stream, tensor } from "./core.mjs";
import { tracker } from "./vision.mjs";

const size = 12;
const canvas = new OffscreenCanvas(size, size);
const ctx = canvas.getContext("2d", { willReadFrequently: true });

function imageSignature(image) {
  ctx.drawImage(image, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  return Array.from({ length: size * size }, (_, i) => (data[4 * i] + data[4 * i + 1] + data[4 * i + 2]) / 3);
}

function distance(a, b, flipX = false, flipY = false) {
  let error = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const j = (flipY ? size - 1 - y : y) * size + (flipX ? size - 1 - x : x);
    error += Math.abs(a[y * size + x] - b[j]);
  }
  return error / a.length;
}

async function analyze(frames, model, profile) {
  const vision = await tracker(model.mode, profile);
  const stream = new Stream(model);
  try {
    const rows = [];
    for (const { frame, t } of frames) {
      const { sample, frame: tracked, ms } = vision.run(frame, t);
      rows.push({ t, sample, wrist: tracked.hands.map(hand => ({
        side: hand.handedness, xy: [hand.landmarks[0].x, hand.landmarks[0].y],
      })), event: stream.push(sample)?.event ?? null, ms });
    }
    const { label, reason, score } = predict(model, tensor(rows.map(row => row.sample), model.mode));
    return { label, reason, score, frames: rows.length, hands: rows.filter(row => row.sample.h).length,
      events: rows.map(row => row.event).filter(Boolean),
      tracking: rows.map(({ t, sample, wrist, ms }) => ({ t, usable: sample.h, wrist, handMs: ms.hand })) };
  } finally {
    vision.close();
  }
}

async function capture(start, duration) {
  const media = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 640 }, resizeMode: { ideal: "none" } }, audio: false,
  });
  const track = media.getVideoTracks()[0];
  const frames = [];
  try {
    const reader = new MediaStreamTrackProcessor({ track, maxBufferSize: 1 }).readable.getReader();
    const timeout = setTimeout(() => { void reader.cancel(); }, start + duration + 8000);
    try {
      let origin;
      while (frames.length < 100) {
        const { value: frame, done } = await reader.read();
        if (done) break;
        origin ??= frame.timestamp;
        const t = (frame.timestamp - origin) / 1000;
        // A camera frame pins a buffer from the capture device. Snapshot the
        // following frames and release those buffers while capture is active.
        try {
          if (t >= start - 200 && t <= start + duration + 200) {
            frames.push({ frame: await createImageBitmap(frame), t });
          }
        } finally {
          frame.close();
        }
        if (t > start + duration + 200) break;
      }
      return frames;
    } finally {
      clearTimeout(timeout);
      await reader.cancel();
    }
  } catch (error) {
    frames.forEach(({ frame }) => frame.close());
    throw error;
  } finally {
    track.stop();
  }
}

window.compareCameraPixels = async ({ width, height, fps, frameCount, leadIn }) => {
  const source = [];
  let captured = [];
  try {
    const packed = new Uint8Array(await (await fetch("/reference.i420")).arrayBuffer());
    const stride = width * height * 1.5;
    for (let i = 0; i < frameCount; i++) {
      const t = i * 1000 / fps;
      const frame = new VideoFrame(packed.subarray(i * stride, (i + 1) * stride), {
        format: "I420", codedWidth: width, codedHeight: height, timestamp: Math.round(t * 1000),
        colorSpace: { matrix: "smpte170m", fullRange: false, primaries: "smpte170m", transfer: "bt709" },
      });
      source.push({ frame, t, pixels: imageSignature(frame) });
    }
    captured = await capture(leadIn * 1000, frameCount * 1000 / fps);
    const match = [];
    for (const item of captured) {
      const pixels = imageSignature(item.frame);
      if (Math.max(...pixels) - Math.min(...pixels) < 12) continue;
      const distances = source.map(({ pixels: ref }, index) => [index, distance(pixels, ref)])
        .sort((a, b) => a[1] - b[1]);
      const [index, error] = distances[0];
      const ref = source[index].pixels;
      match.push({ t: item.t, frame: item.frame, index, error, flipX: distance(pixels, ref, true),
        flipY: distance(pixels, ref, false, true) });
    }
    const model = parseModel(await (await fetch("/model.json")).json());
    const config = { handDelegate: "GPU", onDemandPose: true };
    const sourceResult = await analyze(source, model, config);
    const cameraResult = await analyze(match, model, config);
    return { captured: captured.length, dimensions: captured[0] ?
    [captured[0].frame.width, captured[0].frame.height] : [],
    matched: match.map(({ t, index, error, flipX, flipY }) => ({ t, index, error, flipX, flipY })),
    source: sourceResult, camera: cameraResult };
  } finally {
    for (const { frame } of [...source, ...captured]) frame.close();
  }
};
