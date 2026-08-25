import Link from "next/link";

export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="SignBridge home">
      <span className="brand-mark" aria-hidden="true">S</span>
      <span>SignBridge</span>
    </Link>
  );
}

export function SiteHeader() {
  return (
    <header className="site-header">
      <Brand />
      <nav className="site-nav" aria-label="Primary navigation">
        <Link href="/how-it-works">How it works</Link>
        <Link href="/languages">Languages</Link>
        <Link href="/models">Model status</Link>
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
      <span>SignBridge · Private by default · Research preview</span>
      <nav aria-label="Footer navigation">
        <Link href="/privacy">Privacy</Link>
        <Link href="/about">About</Link>
        <Link href="/roadmap">Roadmap</Link>
      </nav>
    </footer>
  );
}
