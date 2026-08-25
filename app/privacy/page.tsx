import type { Metadata } from "next";
import { InfoPage } from "@/components/info-page";

export const metadata: Metadata = { title: "Privacy", description: "How SignBridge handles camera video and local transcripts." };

export default function PrivacyPage() {
  return <InfoPage eyebrow="Privacy by default" title="Your video belongs to you." intro="SignBridge is designed so the normal translation path runs on your device, without sending raw camera frames to a server." sections={[
    { title: "Camera", body: <p>The browser asks for camera permission when you enter the translator. Raw video frames are processed locally and are not uploaded, recorded or retained by SignBridge.</p> },
    { title: "Models", body: <p>Open-source vision runtime files and pretrained model assets are downloaded to your browser. After loading, landmark extraction and starter recognition execute locally.</p> },
    { title: "Transcript", body: <p>Settings and saved session history use browser local storage on this device. You can remove a transcript, clear all local data, or clear site data in your browser.</p> },
    { title: "Training data", body: <p>This build has no collection flow. Any future donation of signing video would require a separate, explicit consent experience with purpose, retention and deletion terms.</p> },
    { title: "Biometric information", body: <p>Landmarks are held briefly in memory for recognition and are not stored. SignBridge does not identify people or create face profiles.</p> },
  ]} />;
}
