import type { Metadata } from "next";
import { InfoPage } from "@/components/info-page";
import { ASL_BUILT_IN_VOCABULARY } from "@/lib/model-adapters";

export const metadata: Metadata = { title: "Supported languages", description: "Honest language and vocabulary support for SignRelay." };

export default function LanguagesPage() {
  return <InfoPage eyebrow="Language support" title="Three languages. Three separate model paths." intro="ASL, ISL and CSL are independent languages with different lexicons and grammar. SignRelay never shares a vocabulary by changing a label." sections={[
    { title: "American Sign Language · experimental", body: <><p>The installed research adapter includes the official WLASL1000 Pose-TGCN checkpoint. Its published held-out benchmark is 34.86% top-1, 61.73% top-5 and 71.91% top-10. It is an isolated-sign research model, not full ASL translation, and the live MediaPipe-to-OpenPose adapter is still experimental.</p><p className="vocabulary-list"><strong>{ASL_BUILT_IN_VOCABULARY.length} built-in signs:</strong> {ASL_BUILT_IN_VOCABULARY.map((word) => word.gloss).join(" · ")}</p><p>Users can also type their own word or short phrase and record examples for a personal on-device recognizer. Those personal signs remain separate from the shared 1,000-word model.</p></> },
    { title: "Indian Sign Language · model not installed", body: <><p>A real 100-label candidate vocabulary has been audited from the INCLUDE dataset (CC-BY-4.0), which publishes 4,292 videos across 263 ISL word signs. It is not shown as supported yet: there is no trained checkpoint, and the public metadata lacks signer IDs needed for SignRelay’s signer-aware evaluation.</p><a href="https://huggingface.co/datasets/ai4bharat/INCLUDE">Read the INCLUDE dataset card</a></> },
    { title: "Chinese Sign Language · model not installed", body: <><p>No CSL word list or checkpoint has been added. The official SLR500 source has 500 isolated CSL signs, but it is research-only and its agreement must be signed by a full-time staff member—not a student. SignRelay will keep CSL unavailable until that permission or a suitable open dataset is secured.</p><a href="https://ustc-slr.github.io/datasets/2015_csl/">Read the SLR500 access requirements</a></> },
  ]} />;
}
