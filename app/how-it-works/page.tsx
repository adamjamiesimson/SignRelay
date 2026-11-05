import type { Metadata } from "next";
import { InfoPage } from "@/components/info-page";

export const metadata: Metadata = { title: "How it works", description: "The SignRelay camera-to-transcript recognition pipeline, step by step.", alternates: { canonical: "/how-it-works" } };

export default function HowItWorksPage() {
  return <InfoPage eyebrow="How it works" title="Movement first, words second."
    intro="SignRelay follows a short, ordered sequence of hand, face and body landmarks in your browser. Personal signs can go straight into the transcript. You decide whether to add suggestions from built-in rules and research models."
    sections={[
      { title: "1 · The camera stays on your device", body: <p>The camera starts only when you ask for it, after your browser’s permission prompt. The preview is mirrored for comfort; recognition uses the original coordinates. Frames are analysed in this browser and are never sent to a SignRelay server.</p> },
      { title: "2 · Landmarks, not pictures", body: <p>Three lightweight MediaPipe tasks find up to two hands, a few facial reference points and the upper body. Only these points move on to recognition; the images themselves are not kept.</p> },
      { title: "3 · A rolling movement buffer", body: <p>Points are passed to a background worker that keeps the last 32 frames in order. For ASL’s six demo words, simple rules check handshape, location, direction, repetition and timing; a 2,000-sign research model runs alongside them. Other languages use their own models or your personal examples.</p> },
      { title: "4 · One adapter per language", body: <p>Each of SignRelay’s 40 language workspaces declares its own vocabulary, output language and recognition path. Changing language never relabels another language’s model, and personal signs belong to exactly one language.</p> },
      { title: "5 · Review suggestions", body: <p>When a built-in rule or research model finds a possible match, the workspace offers a suggestion. Press <strong>Add</strong> if the word matches what you signed. Personal signs that pass recognition checks can enter the transcript automatically. Match scores describe individual matches rather than overall recognition accuracy.</p> },
      { title: "6 · Transcript and speech", body: <p>Transcript words can be edited, removed, copied or saved on the device. Duplicate suppression stops a held sign from being added or spoken repeatedly. When you turn on <strong>Speak each word</strong>, the browser speaks confirmed personal signs and words you add.</p> },
      { title: "One sign at a time: Russian and Bangla", body: <p>The RSL and Bangla models read short video clips rather than landmark streams, so those workspaces capture a single sign, analyse it locally (often 15–60 seconds) and show a suggestion. Suggestions are never spoken or added to a transcript automatically.</p> },
    ]} />;
}
