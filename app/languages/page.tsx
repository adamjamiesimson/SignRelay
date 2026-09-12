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
        title: "Automatic research models · 3 languages",
        body: <>
          <p>{automatic.map((language) => `${language.shortName} (${language.automaticVocabularyCount.toLocaleString()})`).join(" · ")} have separate, browser-loadable isolated-sign models. They run on-device and remain experimental until independent live-camera evaluation is complete.</p>
          <p>ASL uses the official {ASL_BUILT_IN_VOCABULARY.length.toLocaleString()}-class WLASL Pose-TGCN checkpoint, BSL uses the 1,064-class BSL-1K Pose2Sign checkpoint, and ISL uses the 263-class AI4Bharat INCLUDE transformer. None is presented as continuous sentence interpretation.</p>
        </>,
      },
      {
        title: "Models in preparation · 2 languages",
        body: <>
          <p>{preparing.map((language) => language.language).join(" and ")} have independent model pipelines in preparation. SignRelay does not request a missing checkpoint or show automatic output for either language.</p>
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
          <p>Every non-ASL workspace includes {PERSONAL_STARTER_VOCABULARY.length.toLocaleString()} searchable concept prompts. A prompt becomes recognisable only after the signer records examples of the correct sign in that selected language.</p>
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
