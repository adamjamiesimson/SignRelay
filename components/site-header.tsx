"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { Brand } from "./brand";

// "Translator" is a plain anchor: on the home page a fragment change must
// fire `hashchange`, which client-side Link navigation does not.
const LINKS = [
  { href: "/#translator", label: "Translator", plain: true },
  { href: "/languages", label: "Languages" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/privacy", label: "Privacy" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !toggleRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", close); document.removeEventListener("pointerdown", outside); };
  }, [open]);

  const links = LINKS.map(({ href, label, plain }) => {
    const current = !plain && pathname === href ? "page" : undefined;
    return plain
      ? <a key={href} href={href} onClick={() => setOpen(false)}>{label}</a>
      : <Link key={href} href={href} aria-current={current} onClick={() => setOpen(false)}>{label}</Link>;
  });

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Brand />
        <nav className="site-nav" aria-label="Primary navigation">{links}</nav>
        <button ref={toggleRef} type="button" className="icon-button menu-toggle" aria-expanded={open} aria-controls="site-menu"
          aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen(value => !value)}>
          {open ? <X aria-hidden="true" size={20} /> : <Menu aria-hidden="true" size={20} />}
        </button>
      </div>
      <div ref={panelRef} id="site-menu" className="site-menu" hidden={!open}>
        <nav aria-label="Menu">{links}</nav>
      </div>
    </header>
  );
}
