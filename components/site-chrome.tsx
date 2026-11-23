import Link from "next/link";
import { Brand } from "./brand";
import { PrivacyChoices } from "./privacy-choices";

export { Brand } from "./brand";
export { SiteHeader } from "./site-header";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="footer-brand">
          <Brand />
          <p>Sign recognition research that runs in your browser. Not a substitute for a qualified interpreter.</p>
        </div>
        <nav className="footer-columns" aria-label="Footer navigation">
          <div>
            <h2>Product</h2>
            {/* Plain anchors: a fragment change on the home page must fire hashchange. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/#translator">Translator</a>
            <Link href="/languages">Languages</Link>
            <Link href="/how-it-works">How it works</Link>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/#tour">Take a tour</a>
          </div>
          <div>
            <h2>Project</h2>
            <Link href="/about">About</Link>
            <Link href="/models">Models &amp; credits</Link>
            <Link href="/roadmap">Roadmap</Link>
            <a href="https://github.com/adamjamiesimson/SignRelay" target="_blank" rel="noreferrer">GitHub</a>
          </div>
          <div>
            <h2>Privacy</h2>
            <Link href="/privacy">Privacy policy</Link>
            <Link href="/privacy#storage">Storage &amp; cookies</Link>
            <Link href="/terms">Terms</Link>
            <PrivacyChoices />
          </div>
        </nav>
      </div>
    </footer>
  );
}
