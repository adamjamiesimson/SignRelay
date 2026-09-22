import type { Metadata } from "next";
import { InfoPage } from "@/components/info-page";

export const metadata: Metadata = { title: "Privacy Policy", description: "How SignRelay handles camera processing, saved sign examples, local transcripts and optional analytics.", alternates: { canonical: "/privacy" } };

export default function PrivacyPage() {
  return <InfoPage eyebrow="Updated 11 September 2026" title="Privacy policy." intro="SignRelay is an independent research project. Here is what this version processes and where information is kept." sections={[
    { title: "Camera and saved examples", body: <p>Camera access requires your browser permission. Raw frames are processed on your device and are not uploaded or recorded by SignRelay. Live landmarks are held in memory. If you teach a sign, its normalized landmark sequence and label are saved in this browser’s IndexedDB until you delete them. SignRelay does not identify people or create face identity profiles.</p> },
    { title: "Transcripts and settings", body: <p>Settings and up to eight saved sessions use local storage. Anyone using the same browser profile may access them; there are no user accounts or cloud backups. You can clear local data in the translator or remove all site data in your browser.</p> },
    { title: "Hosting and model downloads", body: <p>Firebase serves the website. Vision assets also download from jsDelivr and Google Cloud Storage. Those providers receive connection information such as your IP address and browser details and may process it in other countries under their own policies. SignRelay does not send them your video or transcripts.</p> },
    { title: "Optional analytics", body: <p>Google Analytics is disabled unless a measurement ID is configured and you choose Allow analytics. Page-view events exclude signs, transcripts, form contents, query strings and referring URLs. Google may receive connection information and set analytics cookies with a configured lifetime of 180 days. Advertising features are disabled. Use Cookie choices in the footer to reject analytics or withdraw consent. Browser Do Not Track and Global Privacy Control signals disable analytics.</p> },
    { title: "Spoken output", body: <p>Speech uses your browser or operating system. Some voices use network services that may receive the text spoken. Leave automatic speech off and avoid the Speak control if you do not want to use those services.</p> },
    { title: "Retention and your choices", body: <p>Local examples and transcripts remain until deleted or cleared by your browser. Your privacy choice is remembered for 180 days. Hosting logs and any analytics records follow the respective provider and account retention settings. Clearing site data removes local settings, transcripts, examples and your privacy choice.</p> },
    { title: "Questions", body: <p>For general project questions, visit the <a href="https://github.com/adamjamiesimson/SignRelay">SignRelay repository</a>. Do not post private transcripts, camera footage or credentials in public issues.</p> },
  ]} />;
}
