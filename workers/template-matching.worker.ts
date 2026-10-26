/// <reference lib="webworker" />
import { recognizePersonalTemplateAsync } from "@/lib/personalized-recognition";
import { recognizePsl776 } from "@/lib/psl776-runtime";
import { unpackTemplates, type MatchInput, type MatchOutput } from "@/lib/template-matching-client";
import type { CalibrationTemplate } from "@/lib/vision-types";

let kind: "personal" | "psl" = "personal";
let templates: CalibrationTemplate[] = [];
let controller: AbortController | null = null;

self.onmessage = async ({ data }: MessageEvent<MatchInput>) => {
  if (data.type !== "match") {
    controller?.abort();
    if (data.type === "configure") { kind = data.kind; templates = unpackTemplates(data.templates); }
    return;
  }
  controller?.abort();
  const scan = new AbortController();
  controller = scan;
  let matchingStarted = performance.now();
  try {
    const options = { signal: scan.signal, onPhase: (phase: "loading" | "matching") => {
      if (phase === "matching") matchingStarted = performance.now();
      self.postMessage({ id: data.id, generation: data.generation, prediction: null, phase } satisfies MatchOutput);
    } };
    if (kind === "personal") options.onPhase("matching");
    const prediction = kind === "personal"
      ? await recognizePersonalTemplateAsync(data.frames, templates, options)
      : await recognizePsl776(data.frames, options);
    self.postMessage({ id: data.id, generation: data.generation, prediction, matchingMs: performance.now() - matchingStarted } satisfies MatchOutput);
  } catch (error) {
    self.postMessage({ id: data.id, generation: data.generation, prediction: null,
      ...(!scan.signal.aborted ? { error: error instanceof Error ? error.message : "Template matching failed" } : {}),
    } satisfies MatchOutput);
  } finally { if (controller === scan) controller = null; }
};
