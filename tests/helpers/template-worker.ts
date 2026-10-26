import { vi } from "vitest";
import { recognizePersonalTemplateAsync } from "../../lib/personalized-recognition";
import { recognizePsl776 } from "../../lib/psl776-runtime";
import { unpackTemplates, type MatchInput, type MatchOutput } from "../../lib/template-matching-client";
import type { CalibrationTemplate } from "../../lib/vision-types";

/** Exercise the real client protocol in Node. Browser/thread integration is
 * benchmarked separately; this adapter deliberately does not emulate CPU isolation.
 */
export function installTemplateWorker() {
  vi.stubGlobal("Worker", class {
    onmessage: ((event: { data: MatchOutput }) => void) | null = null;
    onerror = null;
    onmessageerror = null;
    private kind = "personal";
    private templates: CalibrationTemplate[] = [];
    private controller: AbortController | null = null;
    private closed = false;
    terminate() { this.closed = true; this.controller?.abort(); }
    postMessage(data: MatchInput) {
      if (data.type !== "match") {
        this.controller?.abort();
        if (data.type === "configure") { this.kind = data.kind; this.templates = unpackTemplates(data.templates); }
        return;
      }
      const controller = new AbortController(); this.controller = controller;
      const task = this.kind === "psl" ? recognizePsl776(data.frames, { signal: controller.signal })
        : recognizePersonalTemplateAsync(data.frames, this.templates, { signal: controller.signal });
      Promise.resolve(task).then(prediction => {
        if (!this.closed) this.onmessage?.({ data: { id: data.id, generation: data.generation,
          prediction: controller.signal.aborted ? null : prediction } });
      }, error => {
        if (!this.closed) this.onmessage?.({ data: { id: data.id, generation: data.generation,
          prediction: null, ...(controller.signal.aborted ? {} : { error: String(error) }) } });
      });
    }
  });
}
