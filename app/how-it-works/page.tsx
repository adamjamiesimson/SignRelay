import type { Metadata } from "next";
import { InfoPage } from "@/components/info-page";
import { ASL_V3_ENABLED } from "@/lib/build-profile";

export const metadata: Metadata = { title: "How it works", description: "The SignRelay camera-to-transcript recognition pipeline.", alternates: { canonical: "/how-it-works" } };

export default function HowItWorksPage() {
  return <InfoPage eyebrow="Recognition architecture" title="Movement first, words second." intro="SignRelay analyses a short ordered sequence of hand, face and body landmarks. It never treats one frozen hand pose as a complete language." sections={[
    { title: "Local camera input", body: <p>The camera is opened only after you choose a language and continue. The mirrored image is for your comfort; recognition receives the original coordinates.</p> },
    { title: "Holistic landmark extraction", body: <p>Three lightweight MediaPipe tasks detect up to two hands, selected facial cues and upper-body pose. Raw frames stay in the browser and are not sent to a SignRelay server.</p> },
    { title: "Temporal sequence buffer", body: <p>{ASL_V3_ENABLED ? "Workers receive ordered observations. Engine V3.1 captures individual ASL movements and resamples them to the grid used during training." : "Ordered observations pass through a worker. The ASL starter checks handshape, location, direction, repetition and movement over time."}</p> },
    { title: "Language-specific adapter", body: <p>Every one of SignRelay’s 40 language workspaces declares its own identity, output locale and recognition path. Changing languages never relabels a shared model; personal recordings are scoped to exactly one selected language.</p> },
    { title: "Confidence and segmentation", body: <p>{ASL_V3_ENABLED ? "Engine V3.1 checks completed ASL movements using its Strict preset. A match becomes a suggestion for the user to review. Other language adapters apply their own confidence and timing requirements." : "Each adapter uses confidence and timing checks. Uncertain results remain candidates or stay silent."}</p> },
    { title: "Transcript and speech", body: <p>Only confirmed results enter the transcript. {ASL_V3_ENABLED && "For Engine V3.1 suggestions, choose Add to transcript after checking the word. "}Duplicate suppression prevents a held sign from being added or spoken on every frame. Browser text-to-speech is optional and off by default.</p> },
  ]} />;
}
