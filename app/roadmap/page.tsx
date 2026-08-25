import type { Metadata } from "next";
import { InfoPage } from "@/components/info-page";

export const metadata: Metadata = { title: "Roadmap", description: "The staged development roadmap for SignBridge." };

export default function RoadmapPage() {
  return <InfoPage eyebrow="Development roadmap" title="From honest prototype to useful translator." intro="Continuous translation requires data, linguistic expertise and careful evaluation. The roadmap keeps those dependencies visible." sections={[
    { title: "Now · engineering foundation", body: <p>Camera permissions, hand/face/pose landmarks, ordered sequence buffer, ASL experimental subset, confidence gating, editable transcript, local history and speech.</p> },
    { title: "Next · benchmarked isolated signs", body: <p>Train signer-independent landmark sequence baselines for carefully licensed vocabulary subsets. Publish top-k accuracy, precision, recall, F1, confusion matrices and per-signer results.</p> },
    { title: "Then · continuous segmentation", body: <p>Add a learned boundary detector, blank/no-sign class, co-articulation handling and word error rate evaluation on continuous sequences.</p> },
    { title: "Language expansion", body: <p>Build ISL and CSL models independently with native signers and language experts. Do not transfer ASL labels or grammar across adapters.</p> },
    { title: "Translation quality", body: <p>Move from gloss recognition to language-specific natural-language decoding while preserving uncertainty and source-aligned evaluation.</p> },
  ]} />;
}
