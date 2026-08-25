import type { Metadata } from "next";
import { InfoPage } from "@/components/info-page";
import { ASL_BUILT_IN_VOCABULARY } from "@/lib/model-adapters";

export const metadata: Metadata = { title: "Supported languages", description: "Honest language and vocabulary support for SignRelay." };

export default function LanguagesPage() {
  return <InfoPage eyebrow="Language support" title="Three languages. Three separate model paths." intro="ASL, ISL and CSL are independent languages with different lexicons and grammar. SignRelay never shares a vocabulary by changing a label." sections={[
    { title: "American Sign Language · experimental", body: <><p>The installed research adapter includes a genuine local WLASL100 landmark model, with an initial untouched signer-independent test result of 29.8% top-1 and 52.7% top-5. It is an isolated-sign research model, not full ASL translation.</p><p className="vocabulary-list"><strong>{ASL_BUILT_IN_VOCABULARY.length} built-in signs:</strong> {ASL_BUILT_IN_VOCABULARY.map((word) => word.gloss).join(" · ")}</p><p>Users can also type their own word or short phrase and record examples for a personal on-device recognizer. Those personal signs remain separate from the shared 100-word model.</p></> },
    { title: "Indian Sign Language · model not installed", body: <><p>The adapter and training path are defined, but no trained checkpoint is bundled. INCLUDE is a candidate research dataset with 4,287 videos across 263 signs; its current access and use terms must be checked before training.</p><a href="https://dl.acm.org/doi/10.1145/3394171.3413528">Read the INCLUDE paper</a></> },
    { title: "Chinese Sign Language · model not installed", body: <><p>The adapter is separate and inactive. CSL-Daily is a candidate continuous translation dataset with gloss and spoken-language annotations; access terms must be checked before any training or redistribution.</p><a href="https://ustc-slr.github.io/datasets/2021_csl_daily/">Open the CSL-Daily project</a></> },
  ]} />;
}
