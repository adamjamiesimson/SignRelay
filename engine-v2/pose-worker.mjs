import { createPose } from "./vision.mjs";

let pose;
void createPose().then(value => {
  pose = value;
  self.postMessage({ type: "ready" });
}).catch(error => self.postMessage({ type: "error", message: "Pose initialization failed. " + error.message }));

self.onmessage = ({ data: { image, timestamp } }) => {
  try {
    const start = performance.now();
    const points = pose.detectForVideo(image, timestamp).landmarks[0] ?? [];
    self.postMessage({ type: "pose", timestamp, points, duration: performance.now() - start });
  } catch (error) {
    self.postMessage({ type: "error", message: "Pose inference failed. " + error.message });
  } finally {
    image.close();
  }
};
