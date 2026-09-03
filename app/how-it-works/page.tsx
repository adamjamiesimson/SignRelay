import type { Metadata } from "next";
import { InfoPage } from "@/components/info-page";

export const metadata: Metadata = { title: "How it works", description: "The SignRelay camera-to-transcript recognition pipeline." };

export default function HowItWorksPage() {
  return <InfoPage eyebrow="Recognition architecture" title="Movement first, words second." intro="SignRelay analyses a short ordered sequence of hand, face and body landmarks. It never treats one frozen hand pose as a complete language." sections={[
    { title: "Local camera input", body: <p>The camera is opened only after you choose a language and continue. The mirrored image is for your comfort; recognition receives the original coordinates.</p> },
    { title: "Holistic landmark extraction", body: <p>Three lightweight MediaPipe tasks detect up to two hands, selected facial cues and upper-body pose. Raw frames stay in the browser and are not sent to a SignRelay server.</p> },
    { title: "Temporal sequence buffer", body: <p>Ordered observations are passed to a Web Worker and stored in a rolling 32-frame buffer. The ASL starter checks handshape, location, direction, repetition and movement over time.</p> },
    { title: "Language-specific adapter", body: <p>Every language declares its own vocabulary, input format, sequence length, threshold and decoder. Changing ASL, BSL, CSL or ISL never relabels the same model; personal recordings are scoped to exactly one selected language.</p> },
    { title: "Confidence and segmentation", body: <p>A result must cross the adapter threshold, remain consistent across repeated evaluations and clear a cooldown. Otherwise it remains an unconfirmed candidate or the system stays silent.</p> },
    { title: "Transcript and speech", body: <p>Only confirmed results enter the transcript. Duplicate suppression prevents a held sign from being added or spoken on every frame. Browser text-to-speech is optional and off by default.</p> },
  ]} />;
}
