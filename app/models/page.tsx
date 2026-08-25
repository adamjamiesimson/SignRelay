import type { Metadata } from "next";
import { InfoPage } from "@/components/info-page";
import { ASL_BUILT_IN_VOCABULARY, ASL_PERSONAL_VOCABULARY, MODEL_ADAPTERS } from "@/lib/model-adapters";

export const metadata: Metadata = { title: "Model status", description: "Versions, inputs and limitations of SignRelay recognition models." };

export default function ModelsPage() {
  const asl = MODEL_ADAPTERS.asl;
  return <InfoPage eyebrow="Model registry" title="No hidden claims." intro="A model is marked available only when the browser can load it and the UI names exactly what it supports." sections={[
    { title: "ASL starter · available, experimental", body: <dl className="model-spec"><div><dt>Version</dt><dd>{asl.version}</dd></div><div><dt>Model</dt><dd>{asl.modelFile}</dd></div><div><dt>Sequence</dt><dd>{asl.sequenceLength} frames</dd></div><div><dt>Threshold</dt><dd>{Math.round(asl.confidenceThreshold * 100)}%</dd></div><div><dt>Inputs</dt><dd>{asl.inputFormat}</dd></div><div><dt>Decoder</dt><dd>{asl.decoder}</dd></div></dl> },
    { title: "What is genuinely trained", body: <><p>The hand detector and canned gesture classifier are pretrained MediaPipe models. The classifier includes an I Love You handshape category. HELLO, THANK YOU and YES use transparent temporal landmark rules; those rules are real inference but are not a trained sign-language model.</p><p>The 50-word personal pack uses real dynamic-time-warping comparison against examples recorded by the signer. It is active only for words the user has calibrated and stores normalized landmarks in the browser.</p></> },
    { title: "Installed vocabulary contract", body: <p>{ASL_BUILT_IN_VOCABULARY.length} starter signs work without calibration. {ASL_PERSONAL_VOCABULARY.length} additional ASL words are available through personal calibration. There is no unrestricted ASL model and no ISL or CSL recognition checkpoint; the application will not substitute random output or timed sample text.</p> },
    { title: "Research datasets", body: <ul><li><a href="https://dxli94.github.io/WLASL/">WLASL</a>: 2,000 word-level ASL signs, academic/computational use restrictions.</li><li><a href="https://dl.acm.org/doi/10.1145/3394171.3413528">INCLUDE</a>: 4,287 ISL videos across 263 signs.</li><li><a href="https://ustc-slr.github.io/datasets/2021_csl_daily/">CSL-Daily</a>: continuous CSL translation with gloss and text annotations.</li></ul> },
  ]} />;
}
