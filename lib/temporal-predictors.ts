// Predictors compared by the experiment framework (lib/temporal-experiment.ts).
import { recognizeAslStarter } from "./asl-starter-recognition";
import { OTHER, predictBaseline, trainBaseline, type BaselineConfig, type BaselineModel, BASELINE_CONFIG } from "./temporal-baseline";
import type { Example, Predictor } from "./temporal-experiment";
import type { VisionFrame } from "./vision-types";

/** The production starter rules, run as the worker runs them: on every frame
 * over the recent history, a word counted once two consecutive analyses agree.
 * (An approximation of the worker's confirmation; no cooldown is needed for a
 * single isolated clip.) No training. */
export function starterRulesPredictor(): Predictor {
  return {
    name: "starter-rules",
    predict(frames: VisionFrame[]) {
      let last: string | null = null;
      for (let i = 0; i < frames.length; i++) {
        const label = recognizeAslStarter(frames.slice(0, i + 1))?.label ?? null;
        if (label && label === last) return { label };
        last = label;
      }
      return { label: null };
    },
  };
}

/** The temporal DTW baseline, retrained on each fold's training signers. */
export function temporalBaselinePredictor(config: BaselineConfig = BASELINE_CONFIG): Predictor & { model: () => BaselineModel | null } {
  let model: BaselineModel | null = null;
  return {
    name: "temporal-baseline",
    model: () => model,
    fit(train: Example[]) { model = trainBaseline(train.map(e => ({ frames: e.frames, label: e.gloss ?? OTHER, signer: e.signer })), config); },
    predict(frames: VisionFrame[]) {
      if (!model) throw new Error("fit first");
      const p = predictBaseline(model, frames);
      return { label: p.label, score: p.score };
    },
  };
}
