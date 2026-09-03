import type { Metadata } from "next";
import { InfoPage } from "@/components/info-page";
import { ASL_BUILT_IN_VOCABULARY } from "@/lib/model-adapters";

export const metadata: Metadata = { title: "Supported languages", description: "Honest language and vocabulary support for SignRelay." };

export default function LanguagesPage() {
  return <InfoPage eyebrow="Language support" title="Four languages. Four separate recognizers." intro="ASL, BSL, CSL and ISL are independent languages with different lexicons and grammar. SignRelay never shares a vocabulary by changing a label." sections={[
    { title: "American Sign Language · experimental", body: <><p>The installed research adapter includes the official WLASL1000 Pose-TGCN checkpoint. Its published held-out benchmark is 34.86% top-1, 61.73% top-5 and 71.91% top-10. It is an isolated-sign research model, not full ASL translation, and the live MediaPipe-to-OpenPose adapter is still experimental.</p><p className="vocabulary-list"><strong>{ASL_BUILT_IN_VOCABULARY.length} built-in signs:</strong> {ASL_BUILT_IN_VOCABULARY.map((word) => word.gloss).join(" · ")}</p><p>Users can also type their own word or short phrase and record examples for a personal on-device recognizer. Those personal signs remain separate from the shared 1,000-word model.</p></> },
    { title: "British Sign Language · 400+ word starter library", body: <p>Choose from more than 400 built-in BSL starter labels, or type any word or short phrase, then record two or three examples. SignRelay compares future movements with those on-device landmark templates; your BSL vocabulary is separate from ASL, CSL and ISL and never uploads camera video.</p> },
    { title: "Indian Sign Language · 400+ word starter library", body: <><p>Choose from more than 400 built-in ISL starter labels and record two or three examples per label. INCLUDE remains a promising future shared-model source, but its available metadata does not support SignRelay’s signer-independent benchmark standard yet.</p><a href="https://huggingface.co/datasets/ai4bharat/INCLUDE">Read the INCLUDE dataset card</a></> },
    { title: "Chinese Sign Language · 400+ word starter library", body: <><p>Choose from more than 400 built-in CSL starter labels and record examples on this device; SignRelay matches them only inside the CSL workspace. The official SLR500 data remain research-access controlled, so the app does not claim a shared CSL model that it cannot substantiate.</p><a href="https://ustc-slr.github.io/datasets/2015_csl/">Read the SLR500 access requirements</a></> },
  ]} />;
}
