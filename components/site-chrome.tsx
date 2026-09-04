import Link from "next/link";

export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="SignRelay home">
      <img className="brand-mark" src="/signrelay-mark.png" width="42" height="42" alt="" aria-hidden="true" />
      <span className="brand-wordmark">SignRelay</span>
    </Link>
  );
}

export function SiteHeader() {
  return (
    <header className="site-header">
      <Brand />
      <nav className="site-nav" aria-label="Primary navigation">
        <Link href="/">Translate</Link>
        <Link href="/how-it-works">How it works</Link>
        <Link href="/languages">Languages</Link>
        <Link href="/models">Research</Link>
        <Link className="nav-status" href="/models">
          <span className="status-dot" aria-hidden="true" />
          Research preview
        </Link>
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
        <Link href="/about">About</Link>
        <Link href="/roadmap">Roadmap</Link>
      </nav>
    </footer>
  );
}
