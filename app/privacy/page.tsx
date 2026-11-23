import type { Metadata } from "next";
import { InfoPage } from "@/components/info-page";
import { MEASUREMENT_ID } from "@/lib/analytics-consent";

export const metadata: Metadata = { title: "Privacy Policy", description: "How SignRelay handles camera processing, personal signs, saved transcripts, settings and optional analytics.", alternates: { canonical: "/privacy" } };

const STORAGE = [
  { name: "signrelay-personal-vocabulary", where: "IndexedDB", what: "Personal signs you teach: the word, its language, when it was recorded and 24 frames of normalised hand, selected face and upper-body landmark coordinates per example (at most three examples per word). No images or video.", kept: "Until you remove the word or clear local data" },
  { name: "signrelay.history.v1", where: "Local storage", what: "Up to eight saved transcripts: the words, the recognised labels, match scores, times and language. Saved when you choose Save & clear or change language with words on screen.", kept: "Until you clear local data; older sessions drop off after eight" },
  { name: "signrelay.settings.v1", where: "Local storage", what: "Speech and display settings: Speak each word, volume, rate and whether landmarks are drawn.", kept: "Until you clear local data" },
  { name: "signrelay.onboarding.v1", where: "Local storage", what: "Whether you finished or skipped the workspace tour, and when.", kept: "Until you clear local data" },
  { name: "signrelay.analytics-consent.v1", where: "Local storage", what: "Your analytics choice and when you made it. Written only when optional analytics is offered.", kept: "180 days, then you are asked again" },
  { name: "_ga, _ga_<id>", where: "Cookies (Google)", what: "Google Analytics identifiers. Set only after you choose Allow.", kept: "Up to 180 days; removed when you turn analytics off" },
];

export default function PrivacyPage() {
  return <InfoPage eyebrow="Privacy policy · Effective 23 October 2026" title="Your signing stays on your device."
    intro="SignRelay is an independent research project. This policy explains, in plain language, what this version of the site processes, where it is kept and how to remove it."
    note={<p className="notice compact" role="note"><strong>Draft for owner and legal review.</strong> This text describes the software as built. It is not legal advice and makes no claim of certification or regulatory compliance.</p>}
    sections={[
      { title: "The short version", body: <ul>
        <li>Camera video is analysed in your browser and is never uploaded or recorded by SignRelay.</li>
        <li>There are no accounts. Personal signs, transcripts and settings are kept only in this browser, and you can delete them at any time.</li>
        <li>{MEASUREMENT_ID ? "Optional Google Analytics stays off unless you choose Allow. Signs, video and transcripts are never sent to it." : "This build has no analytics, advertising or tracking cookies."}</li>
        <li>Speech uses your browser or device voices, which may be online services.</li>
      </ul> },
      { title: "Who is responsible", body: <>
        <p>SignRelay is published by its project owner as an open research project on <a href="https://github.com/adamjamiesimson/SignRelay">GitHub</a>. Because SignRelay does not receive your camera video, transcripts or personal signs, it cannot view, export or delete them for you; they are under your control in your browser.</p>
        <p className="field-hint">Owner to confirm: the legal name and a contact address for privacy requests.</p>
      </> },
      { title: "Camera and on-device processing", id: "camera", body: <>
        <p>The camera starts only when you ask for it (Start camera, Retry camera, Start camera &amp; record, or Start signing once you have seen the tour) and only after your browser has asked for your permission. SignRelay never requests your microphone.</p>
        <p>Each frame is analysed in the page and in background workers on your device. Hand-tracking models find hand, selected face and upper-body landmark points; recognition compares their movement with a language model or with your own examples. Frames and live landmarks are held in memory only while they are analysed; the short movement buffer is cleared when you pause the camera, switch language or leave the page. SignRelay does not identify people or build face profiles; face and body points are used only as sign context.</p>
        <p>The Russian and Bangla workspaces capture one short clip at a time in memory, analyse it on your device and discard it.</p>
      </> },
      { title: "What is stored in your browser", id: "storage", body: <>
        <p>These are all the items SignRelay itself stores. Everything except the analytics cookies is needed for a feature you use, and none of it is sent anywhere.</p>
        <div className="data-table-wrap"><table className="data-table">
          <thead><tr><th scope="col">Item</th><th scope="col">Where</th><th scope="col">Purpose and contents</th><th scope="col">Kept</th></tr></thead>
          <tbody>{STORAGE.map(item => <tr key={item.name}>
            <td><code>{item.name}</code></td><td data-label="Where">{item.where}</td><td data-label="Contents">{item.what}</td><td data-label="Kept">{item.kept}</td>
          </tr>)}</tbody>
        </table></div>
        <p>Your browser also caches the site’s files and models in its normal HTTP cache, which it manages itself.</p>
      </> },
      { title: "Deleting your data", id: "deleting", body: <>
        <p>In the translator, open <strong>Privacy &amp; data</strong> and choose <strong>Clear local data</strong>. This removes saved transcripts, settings, personal signs and tour progress from this browser. Your analytics choice is kept so you are not asked again; change it under <strong>Cookie choices</strong> in the footer.</p>
        <p>You can also remove a single personal sign from Personal signs, or delete all of this site’s data in your browser’s settings. Deleted data cannot be recovered, because no copy exists elsewhere.</p>
      </> },
      { title: "Optional analytics", id: "analytics", body: <>
        <p><strong>{MEASUREMENT_ID ? "This build offers Google Analytics, off by default." : "Analytics is not configured in this build: no analytics script loads and no analytics cookies are set."}</strong></p>
        <p>When a measurement ID is configured, Google Analytics loads only after you choose Allow. It records page views using the page path only, without query strings, referring addresses, form contents, signs, video or transcripts, along with the standard browser details Google Analytics collects, such as screen size and language. Advertising features and Google signals are disabled. Google receives connection information such as your IP address and browser details and processes it under its own terms.</p>
        <p>Reject is as easy as Allow, and you can withdraw consent at any time under Cookie choices, which turns analytics off and deletes its cookies. If your browser sends Global Privacy Control or Do Not Track, analytics stays off and cannot be enabled.</p>
      </> },
      { title: "Hosting and model downloads", id: "hosting", body: <>
        <p>The site is served by Firebase Hosting (Google). As with any website, the host receives your IP address, browser details and the files requested, and may keep server logs under Google’s retention settings.</p>
        <p>Recognition models, label files and the tracking runtime are served from this site. If the site’s own copy of the hand-tracking runtime cannot load, the browser falls back to the same pinned files from jsDelivr and Google Cloud Storage, which then receive the same kind of connection information. No video, landmarks or transcripts are sent to any of these services.</p>
        <p>Links to GitHub and to model or dataset pages take you to those sites, which have their own policies.</p>
      </> },
      { title: "Spoken output", id: "speech", body: <p>Speak and Speak each word use your browser’s or operating system’s text-to-speech. Some voices run on your device; others are online services that receive the text being spoken. Speaking is off by default. Leave it off if you do not want to use those services; the transcript can still be read and copied.</p> },
      { title: "Limits you should know", id: "limits", body: <ul>
        <li>Data in browser storage is not encrypted by SignRelay. Anyone using the same browser profile can see it.</li>
        <li>Private or restricted browsing modes may block or discard storage; then nothing is remembered between visits.</li>
        <li>Only sign with, or point the camera at, other people with their permission.</li>
        <li>The optional <code>?perf</code> diagnostics show timings on screen only; nothing is stored or sent.</li>
      </ul> },
      { title: "Changes and questions", id: "changes", body: <p>Material changes will be reflected here with a new effective date. For general questions, use the <a href="https://github.com/adamjamiesimson/SignRelay">SignRelay repository</a>; never post transcripts, camera images or personal details in public issues.</p> },
    ]} />;
}
