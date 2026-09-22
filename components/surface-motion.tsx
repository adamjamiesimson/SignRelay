"use client";

import { useEffect, useRef } from "react";

/** Decorative motion never owns React state or changes the camera render loop. */
export function SurfaceMotion({ scene, cursor = true }: { scene: string; cursor?: boolean }) {
  const glowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const glow = glowRef.current;
    if (!glow) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    let dispose = () => {};

    const setup = () => {
      dispose();
      if (preference.matches) return;
      let frame = 0;
      let x = 0;
      let y = 0;
      const animations = new Set<Animation>();
      const move = (event: PointerEvent) => {
        if (event.pointerType !== "mouse") return;
        x = event.clientX;
        y = event.clientY;
        if (!frame) frame = requestAnimationFrame(() => {
          glow.style.transform = `translate3d(${x}px, ${y}px, 0)`;
          glow.dataset.visible = "true";
          frame = 0;
        });
      };
      const hide = () => {
        cancelAnimationFrame(frame);
        frame = 0;
        delete glow.dataset.visible;
      };
      const observer = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer?.unobserve(entry.target);
          if (typeof entry.target.animate !== "function" || entry.target.contains(document.activeElement)) continue;
          const animation = entry.target.animate([
            { opacity: 0, transform: "translateY(22px)" },
            { opacity: 1, transform: "translateY(0)" },
          ], { duration: 650, easing: "cubic-bezier(.2,.7,.2,1)" });
          animations.add(animation);
          animation.onfinish = () => animations.delete(animation);
        }
      }, { threshold: .12 }) : null;
      document.querySelectorAll("[data-reveal]").forEach((element) => observer?.observe(element));
      if (cursor && pointer.matches) {
        window.addEventListener("pointermove", move, { passive: true });
        document.documentElement.addEventListener("pointerleave", hide);
        window.addEventListener("blur", hide);
        document.addEventListener("visibilitychange", hide);
      }
      dispose = () => {
        hide();
        observer?.disconnect();
        animations.forEach((animation) => animation.cancel());
        window.removeEventListener("pointermove", move);
        document.documentElement.removeEventListener("pointerleave", hide);
        window.removeEventListener("blur", hide);
        document.removeEventListener("visibilitychange", hide);
      };
    };
    setup();
    preference.addEventListener("change", setup);
    pointer.addEventListener("change", setup);
    return () => {
      dispose();
      preference.removeEventListener("change", setup);
      pointer.removeEventListener("change", setup);
    };
  }, [scene, cursor]);

  return <div ref={glowRef} className="cursor-aura" aria-hidden="true" />;
}
