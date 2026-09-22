// Test-only entry point. Bundled into the temporary export by the browser test
// and removed afterwards. Uses the production runtime and installed checkpoint.
import { recognizeLse300 } from "../lib/lse300-runtime";
import type { VisionFrame } from "../lib/vision-types";

self.onmessage = async (event: MessageEvent<VisionFrame[]>) => {
  try {
    const result = await recognizeLse300(event.data);
    self.postMessage({ type: "complete", result });
  } catch (error) {
    self.postMessage({ type: "error", message: String(error) });
  }
};
