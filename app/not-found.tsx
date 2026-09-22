import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
export default function NotFound() { return <div className="app-shell"><SiteHeader /><main className="not-found"><p className="eyebrow">404 · Not found</p><h1>This sign isn’t here.</h1><p>The page you requested has moved, changed, or never existed.</p><Link className="button primary" href="/">Return to SignRelay</Link></main><SiteFooter /></div>; }
