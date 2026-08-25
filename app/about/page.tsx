import type { Metadata } from "next";
import { InfoPage } from "@/components/info-page";

export const metadata: Metadata = { title: "About", description: "Why SignRelay exists and the principles behind it." };

export default function AboutPage() {
  return <InfoPage eyebrow="About SignRelay" title="A serious foundation for visible communication." intro="SignRelay is an open engineering project exploring real-time, privacy-first sign-language recognition for Deaf and hearing communication." sections={[
    { title: "The goal", body: <p>Build toward continuous, multilingual translation that respects sign language as language: hands, movement, facial expression, body posture, timing and grammar.</p> },
    { title: "The principle", body: <p>Accuracy claims must follow evidence. Missing models stay missing, uncertain predictions stay unconfirmed and a small vocabulary is labelled as small.</p> },
    { title: "The approach", body: <p>Run perception in the browser, separate language adapters, publish the limits of every checkpoint and make the training pipeline reproducible.</p> },
    { title: "The people who matter", body: <p>Future dataset design, evaluation and product decisions should include Deaf signers, interpreters and native sign-language researchers from the languages being supported.</p> },
  ]} />;
}
