import type { Metadata } from "next";
import { InfoPage } from "@/components/info-page";
import { ASL_BUILT_IN_VOCABULARY, MODEL_ADAPTERS } from "@/lib/model-adapters";

export const metadata: Metadata = { title: "Model status", description: "Versions, inputs and limitations of SignRelay recognition models." };

export default function ModelsPage() {
  const asl = MODEL_ADAPTERS.asl;
  return <InfoPage eyebrow="Model registry" title="No hidden claims." intro="A model is marked available only when the browser can load it and the UI names exactly what it supports." sections={[
    { title: "ASL starter · available, experimental", body: <dl className="model-spec"><div><dt>Version</dt><dd>{asl.version}</dd></div><div><dt>Model</dt><dd>{asl.modelFile}</dd></div><div><dt>Sequence</dt><dd>{asl.sequenceLength} frames</dd></div><div><dt>Threshold</dt><dd>{Math.round(asl.confidenceThreshold * 100)}%</dd></div><div><dt>Inputs</dt><dd>{asl.inputFormat}</dd></div><div><dt>Decoder</dt><dd>{asl.decoder}</dd></div></dl> },
    { title: "What is genuinely trained", body: <><p>The 100-word ASL model is trained on the WLASL100 landmark sequences and runs locally in the browser. Its initial untouched signer-independent test result is 29.8% top-1 and 52.7% top-5, so it is clearly marked experimental. The MediaPipe hand, face and pose trackers are separately pretrained.</p><p>Typed personal words use real dynamic-time-warping comparison against one to three examples recorded by the signer. They stay on that device and do not alter the shared 100-word model.</p></> },
    { title: "Installed vocabulary contract", body: <p>{ASL_BUILT_IN_VOCABULARY.length} ASL signs work without calibration as an experimental isolated-sign model. Users can separately add a word or short phrase and record their own sign. There is no unrestricted ASL model and no ISL or CSL recognition checkpoint; the application will not substitute random output or timed sample text.</p> },
    { title: "Research datasets", body: <ul><li><a href="https://dxli94.github.io/WLASL/">WLASL</a>: 2,000 word-level ASL signs, academic/computational use restrictions.</li><li><a href="https://huggingface.co/datasets/ai4bharat/INCLUDE">INCLUDE</a>: CC-BY-4.0 ISL metadata for 4,292 videos and 263 word signs. SignRelay has audited a 100-label candidate vocabulary, not a checkpoint.</li><li><a href="https://ustc-slr.github.io/datasets/2015_csl/">SLR500</a>: 500 isolated CSL signs, but access requires a full-time-staff-signed research agreement.</li></ul> },
  ]} />;
}
