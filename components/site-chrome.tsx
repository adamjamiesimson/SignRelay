import Link from "next/link";
import Image from "next/image";
import { PrivacyChoices } from "./privacy-choices";

export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="SignRelay home">
      <Image className="brand-mark" src="/signrelay-mark.webp" width={28} height={28} alt="" aria-hidden="true" unoptimized />
      <span className="brand-wordmark">SignRelay</span>
    </Link>
  );
}

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Brand />
        <nav className="site-nav" aria-label="Primary navigation">
          <Link href="/languages">Languages</Link>
          <Link href="/#how-it-works">How it works</Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="footer-brand"><strong>SignRelay</strong><span>Open source</span></div>
        <nav aria-label="Footer navigation">
          <Link href="/languages">Languages</Link>
          <Link href="/#choose-language">Translate</Link>
          <Link href="/#how-it-works">How it works</Link>
          <Link href="/privacy">Privacy</Link>
          <a href="https://github.com/adamjamiesimson/SignRelay" target="_blank" rel="noreferrer">GitHub</a>
          <PrivacyChoices />
        </nav>
      </div>
    </footer>
  );
}
