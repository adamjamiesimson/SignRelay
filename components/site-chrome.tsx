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
        <Link href="/how-it-works">How it works</Link>
        <Link className="nav-cta" href="/#choose-language">Start translating</Link>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <span>SignRelay · Free and open source · Research preview</span>
      <nav aria-label="Footer navigation">
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/about">About</Link>
        <Link href="/roadmap">Roadmap</Link>
        <a href="https://github.com/adamjamiesimson/SignRelay" target="_blank" rel="noreferrer">GitHub</a>
        <PrivacyChoices />
      </nav>
    </footer>
  );
}
