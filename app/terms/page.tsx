import type { Metadata } from "next";
import { InfoPage } from "@/components/info-page";

export const metadata: Metadata = { title: "Terms and Conditions", description: "Conditions for using SignRelay’s experimental on-device sign recognition.", alternates: { canonical: "/terms" } };

export default function TermsPage() {
  return <InfoPage eyebrow="Terms · Effective 23 October 2026" title="Terms of use."
    intro="These terms apply when you use the SignRelay website and translator. By using SignRelay you agree to them; if you do not, please do not use the service."
    note={<p className="notice compact" role="note"><strong>Draft for owner and legal review.</strong> These terms have not been reviewed by a lawyer. Nothing here limits rights you have under the law where you live.</p>}
    sections={[
      { title: "A research preview, not an interpreter", id: "research-preview", body: <>
        <p>SignRelay recognises isolated signs from a limited vocabulary and shows word labels. It does not translate sentences or grammar, and its recognition can be missing, partial or wrong. Results vary by language, model, signer, lighting, camera and device. Live-camera accuracy has not been independently measured for any language.</p>
        <p>Check every word before relying on it. Do not use SignRelay in place of a qualified interpreter, and never for emergencies, medical, legal, financial or safety decisions.</p>
      </> },
      { title: "Using SignRelay responsibly", id: "responsible-use", body: <ul>
        <li>Use the service lawfully. Do not try to disrupt it, gain unauthorised access or use it to harm, harass or deceive anyone.</li>
        <li>Only point the camera at, or record personal signs of, other people with their permission.</li>
        <li>Do not present SignRelay’s output as an accurate or certified translation.</li>
      </ul> },
      { title: "Your data", id: "your-data", body: <p>There are no accounts and no cloud copies. Transcripts, settings and personal signs stay in your browser, under your control, and clearing browser data removes them permanently. Copy anything you want to keep. The <a href="/privacy">Privacy Policy</a> explains exactly what is stored and how to delete it.</p> },
      { title: "Code, models and datasets", id: "licences", body: <>
        <p>SignRelay’s source code is published on <a href="https://github.com/adamjamiesimson/SignRelay">GitHub</a>. Recognition models, label files and reference signs come from third parties and keep their own licences and attribution requirements, some of which restrict commercial use. See <a href="/models">Models &amp; credits</a> for each source before reusing or redistributing anything.</p>
        <p className="field-hint">Owner to confirm: the licence that applies to SignRelay’s own code. The repository does not currently include a licence file.</p>
      </> },
      { title: "Availability", id: "availability", body: <p>SignRelay is provided free of charge, as it is, while it is being developed. Features, languages and models may change, and the service may be unavailable at times or discontinued.</p> },
      { title: "Responsibility", id: "responsibility", body: <p>To the extent the law allows, the project is not responsible for loss or harm caused by relying on recognition results, by the unavailability of the service or by data lost when browser storage is cleared. These terms do not exclude any responsibility that cannot be excluded by law.</p> },
      { title: "Changes and questions", id: "changes", body: <p>Updated terms will be posted here with a new effective date. Questions about the project can be raised on the <a href="https://github.com/adamjamiesimson/SignRelay">repository</a>; keep personal data out of public issues.</p> },
    ]} />;
}
