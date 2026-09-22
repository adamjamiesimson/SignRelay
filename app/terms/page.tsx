import type { Metadata } from "next";
import { InfoPage } from "@/components/info-page";

export const metadata: Metadata = { title: "Terms and Conditions", description: "Conditions for using SignRelay’s experimental on-device sign-language tools.", alternates: { canonical: "/terms" } };

export default function TermsPage() {
  return <InfoPage eyebrow="Updated 11 September 2026" title="Terms and conditions." intro="Please read these conditions before using SignRelay. If you do not agree, do not use the service." sections={[
    { title: "Research tool", body: <p>SignRelay is experimental. Recognition can be incomplete or incorrect and varies by language, model, device and signer. It is not a substitute for a qualified interpreter or a reliable tool for emergencies, medical decisions or legal decisions.</p> },
    { title: "Responsible use", body: <p>Use the service lawfully and only process other people’s signing with their permission. Do not attempt unauthorized access, disrupt the service or use it to harm others.</p> },
    { title: "Models and licences", body: <p>Third-party software, model weights and datasets retain their respective licences. Some research assets restrict commercial use. Check the model documentation and applicable licences before reuse or redistribution.</p> },
    { title: "Your local data", body: <p>There are no user accounts or cloud backups. You control the transcripts and personal sign examples saved in your browser. Export anything you need to keep; clearing browser data may permanently remove it.</p> },
    { title: "Availability and limitations", body: <p>The project may change or become unavailable. It makes no promise of uninterrupted operation or accurate recognition. These conditions do not exclude rights or responsibilities that applicable law does not allow to be excluded.</p> },
    { title: "Privacy and questions", body: <p>Read the <a href="/privacy">Privacy Policy</a> for processing and storage details. General project questions can be raised through the <a href="https://github.com/adamjamiesimson/SignRelay">repository</a>; keep personal data out of public issues.</p> },
  ]} />;
}
