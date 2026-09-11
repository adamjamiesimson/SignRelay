import Link from "next/link";
import Image from "next/image";
import { PrivacyChoices } from "./privacy-choices";

export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="SignRelay home">
      <Image className="brand-mark" src="/signrelay-mark.webp" width={42} height={42} alt="" aria-hidden="true" unoptimized />
      <span className="brand-wordmark">SignRelay</span>
    </Link>
  );
}

export function SiteHeader() {
  return (
    <header className="site-header">
      <Brand />
      <nav className="site-nav" aria-label="Primary navigation">
        <Link href="/languages">Languages</Link>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <span>SignRelay · Private by default · Research preview</span>
      <nav aria-label="Footer navigation">
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/about">About</Link>
        <Link href="/roadmap">Roadmap</Link>
        <PrivacyChoices />
      </nav>
    </footer>
  );
}
