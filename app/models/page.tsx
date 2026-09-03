import type { Metadata } from "next";
import { InfoPage } from "@/components/info-page";
import { ASL_BUILT_IN_VOCABULARY, MODEL_ADAPTERS } from "@/lib/model-adapters";

export const metadata: Metadata = { title: "Model status", description: "Versions, inputs and limitations of SignRelay recognition models." };

export default function ModelsPage() {
  const asl = MODEL_ADAPTERS.asl;
  return <InfoPage eyebrow="Model registry" title="No hidden claims." intro="A model is marked available only when the browser can load it and the UI names exactly what it supports." sections={[
    { title: "ASL starter · available, experimental", body: <dl className="model-spec"><div><dt>Version</dt><dd>{asl.version}</dd></div><div><dt>Model</dt><dd>{asl.modelFile}</dd></div><div><dt>Sequence</dt><dd>{asl.sequenceLength} frames</dd></div><div><dt>Threshold</dt><dd>{Math.round(asl.confidenceThreshold * 100)}%</dd></div><div><dt>Inputs</dt><dd>{asl.inputFormat}</dd></div><div><dt>Decoder</dt><dd>{asl.decoder}</dd></div></dl> },
    { title: "What is genuinely trained", body: <><p>The 2,000-word ASL model is the official WLASL2000 Pose-TGCN checkpoint trained on WLASL OpenPose sequences. The checkpoint is quantised for local browser inference, while MediaPipe supplies the live pose and hand points. Its live browser accuracy has not yet received a signer-independent evaluation, so SignRelay keeps it marked experimental.</p><p>The model is safety-gated: it checks for a completed movement, then requires a strong confidence score and a clear lead from the next-best word. This blocks idle hands and continuous waving without demanding a perfectly motionless final pose.</p><p>Every language also has a real signer-specific recognizer: dynamic-time-warping comparison against two or three examples recorded by that signer. Those templates stay on that device and are separated by language.</p></> },
    { title: "Installed vocabulary contract", body: <p>{ASL_BUILT_IN_VOCABULARY.length} ASL signs are installed without personal calibration as an experimental isolated-sign model. ASL, BSL, CSL and ISL can each hold an unlimited personal dictionary, but a shared BSL, CSL or ISL checkpoint is not represented as installed until it passes evaluation. The application never substitutes random output or timed sample text.</p> },
    { title: "Research datasets", body: <ul><li><a href="https://dxli94.github.io/WLASL/">WLASL</a>: 2,000 word-level ASL signs, academic/computational use restrictions.</li><li><a href="https://huggingface.co/datasets/ai4bharat/INCLUDE">INCLUDE</a>: CC-BY-4.0 ISL metadata for 4,292 videos and 263 word signs. SignRelay has audited a 100-label candidate vocabulary, not a checkpoint.</li><li><a href="https://ustc-slr.github.io/datasets/2015_csl/">SLR500</a>: 500 isolated CSL signs, but access requires a full-time-staff-signed research agreement.</li></ul> },
  ]} />;
}
