import type { Metadata } from "next";
import { InfoPage } from "@/components/info-page";

export const metadata: Metadata = { title: "How it works", description: "The SignRelay camera-to-transcript recognition pipeline, step by step.", alternates: { canonical: "/how-it-works" } };

export default function HowItWorksPage() {
  return <InfoPage eyebrow="How it works" title="Movement first, words second."
    intro="SignRelay follows a short, ordered sequence of hand, face and body landmarks in your browser. A word reaches the transcript only after its movement has been confirmed."
    sections={[
      { title: "1 · The camera stays on your device", body: <p>The camera starts only when you ask for it, after your browser’s permission prompt. The preview is mirrored for comfort; recognition uses the original coordinates. Frames are analysed in this browser and are never sent to a SignRelay server.</p> },
      { title: "2 · Landmarks, not pictures", body: <p>Three lightweight MediaPipe tasks find up to two hands, a few facial reference points and the upper body. Only these points move on to recognition; the images themselves are not kept.</p> },
      { title: "3 · A rolling movement buffer", body: <p>Points are passed to a background worker that keeps the last 32 frames in order. For ASL’s six demo words, simple rules check handshape, location, direction, repetition and timing; a 2,000-sign research model runs alongside them. Other languages use their own models or your personal examples.</p> },
      { title: "4 · One adapter per language", body: <p>Each of SignRelay’s 40 language workspaces declares its own vocabulary, output language and recognition path. Changing language never relabels another language’s model, and personal signs belong to exactly one language.</p> },
      { title: "5 · Confirm before writing", body: <p>A result must clear the language’s threshold, agree across repeated checks and wait out a short cooldown. Until then the workspace shows <em>Checking sign</em> or <em>No confident match</em>, and nothing is added. Match scores describe the match, not translation accuracy.</p> },
      { title: "6 · Transcript and speech", body: <p>Confirmed words can be edited, removed, copied or saved on the device. Duplicate suppression stops a held sign from being added or spoken repeatedly. Speech uses your browser’s voices and is off by default.</p> },
      { title: "One sign at a time: Russian and Bangla", body: <p>The RSL and Bangla models read short video clips rather than landmark streams, so those workspaces capture a single sign, analyse it locally (often 15–60 seconds) and show a suggestion. Suggestions are never spoken or added to a transcript automatically.</p> },
    ]} />;
}
