import type { Metadata } from "next";
import { InfoPage } from "@/components/info-page";
import { ASL_BUILT_IN_VOCABULARY, LANGUAGE_LIST, PERSONAL_STARTER_VOCABULARY } from "@/lib/model-adapters";

export const metadata: Metadata = {
  title: "Supported languages",
  description: "Honest model and private-vocabulary support across SignRelay's sign-language workspaces.",
  alternates: { canonical: "/languages" },
};

export default function LanguagesPage() {
  const automatic = LANGUAGE_LIST.filter((language) => language.status === "experimental");
  const preparing = LANGUAGE_LIST.filter((language) => language.status === "preparing");
  const personal = LANGUAGE_LIST.filter((language) => language.status === "personal");

  return <InfoPage
    eyebrow="Language support"
    title={`${LANGUAGE_LIST.length} languages. Separate recognizers.`}
    intro="Sign languages are independent languages, not signed versions of spoken languages. SignRelay keeps every personal vocabulary and recognition session inside its selected language."
    sections={[
      {
        title: `Pretrained research models · ${automatic.length} languages`,
        body: <>
          <p>{automatic.map((language) => `${language.shortName} (${language.automaticVocabularyCount.toLocaleString()})`).join(" · ")} have separate, browser-loadable isolated-sign models. They run on-device and remain experimental until independent live-camera evaluation is complete.</p>
          <p>ASL uses the official {ASL_BUILT_IN_VOCABULARY.length.toLocaleString()}-class WLASL Pose-TGCN checkpoint, BSL uses the 1,064-class BSL-1K Pose2Sign checkpoint, and ISL uses the 263-class AI4Bharat INCLUDE transformer. None is presented as continuous sentence interpretation.</p>
          <p>Spanish uses a 300-class model trained on the released SWL-LSE health-domain landmarks. Released test-split top-1 was 60.5%; live-camera accuracy remains unmeasured.</p>
          <p>Bangla uses a separate VideoMAE clip model with 401 sign classes and 398 distinct English glosses. Its first load is 97 MB; results remain experimental and inference is slow.</p>
          <p>RSL uses the official Slovo video model: 967 word/phrase classes and 33 fingerspelling letters, without teaching. It has a separate manual single-sign camera mode, a 141 MB first download and slow inference; it is not real-time.</p>
          <p>PSL is different from the other six: it is not a trained classifier. It matches against 775 official Pakistan Sign Language dictionary signs from Hamza Foundation Academy for the Deaf, each with exactly one official reference performance, using the same one-shot distance matching already used for a signer’s own personal templates. No accuracy evaluation exists for it.</p>
        </>,
      },
      {
        title: `Models in preparation · ${preparing.length} languages`,
        body: <>
          <p>{preparing.map((language) => language.language).join(" and ")} {preparing.length === 1 ? "has an independent model pipeline" : "have independent model pipelines"} in preparation. SignRelay does not request a missing checkpoint or show automatic output for those languages.</p>
          <p>Their private signer-taught workspaces are available now, with the same language separation as every other workspace.</p>
        </>,
      },
      {
        title: `Signer-taught workspaces · ${personal.length} languages`,
        body: <>
          <p>{personal.map((language) => `${language.language} (${language.shortName})`).join(" · ")}</p>
          <p>These workspaces use only examples recorded by the signer on their device. They are functional personal recognizers, not claims of a signer-independent pretrained model.</p>
        </>,
      },
      {
        title: `${PERSONAL_STARTER_VOCABULARY.length.toLocaleString()} prompts, unlimited custom signs`,
        body: <>
          <p>Each landmark-based workspace includes {PERSONAL_STARTER_VOCABULARY.length.toLocaleString()} searchable concept prompts. A prompt becomes recognisable only after the signer records examples of the correct sign in that selected language.</p>
          <p>Users can also type any word or short phrase, including text in their own writing system, and teach it privately. Prompt labels are organisational aids—not a claim that the same sign is shared between languages.</p>
        </>,
      },
      {
        title: "Privacy and language integrity",
        body: <p>Personal examples store normalised hand, face and upper-body landmarks in the browser, never raw camera video. Switching languages resets the recognition session and cannot relabel, import or leak a template from another language.</p>,
      },
    ]}
  />;
}
