import type { Metadata } from "next";
import { InfoPage } from "@/components/info-page";

export const metadata: Metadata = { title: "Roadmap", description: "The staged development roadmap for SignRelay.", alternates: { canonical: "/roadmap" } };

export default function RoadmapPage() {
  return <InfoPage eyebrow="Development roadmap" title="From honest prototype to useful translator." intro="Continuous translation requires data, linguistic expertise and careful evaluation. The roadmap keeps those dependencies visible." sections={[
    { title: "Now · engineering foundation", body: <p>On-device camera processing, hand, face and pose landmarks, an ordered movement buffer, seven experimental automatic languages, two-step confirmation, an editable transcript, local history, speech, personal signs and a first-run tour.</p> },
    { title: "Next · benchmarked isolated signs", body: <p>Train signer-independent landmark sequence baselines for carefully licensed vocabulary subsets. Publish top-k accuracy, precision, recall, F1, confusion matrices and per-signer results.</p> },
    { title: "Then · continuous segmentation", body: <p>Add a learned boundary detector, blank/no-sign class, co-articulation handling and word error rate evaluation on continuous sequences.</p> },
    { title: "Language expansion", body: <p>Move languages from signer-taught workspaces to independent shared models only when legally usable data, native signers and language experts can support training and evaluation. Never transfer ASL labels or grammar across adapters.</p> },
    { title: "Translation quality", body: <p>Move from gloss recognition to language-specific natural-language decoding while preserving uncertainty and source-aligned evaluation.</p> },
  ]} />;
}
