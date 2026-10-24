"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import {
  DEMO_SEQUENCE, STILL_FRAME, bonesPath, dotsPath, frameAt, handPoints, palmCentre, palmPath, visibleTips,
  type Frame, type HandPose, type Phase, type Point,
} from "@/lib/hand-illustration";

type HandRefs = { group: SVGGElement | null; palm: SVGPathElement | null; halo: SVGPathElement | null;
  bones: SVGPathElement | null; joints: SVGPathElement | null; tips: SVGPathElement | null };

function handGeometry(pose: HandPose, side: 1 | -1) {
  const points = handPoints(pose, side);
  const bones = bonesPath(points);
  return { points, palm: palmPath(points), bones, joints: dotsPath(points.filter((_, i) => i && i % 4), 1.1),
    tips: dotsPath([points[0], ...visibleTips(points, pose)], 1.9), opacity: pose.opacity };
}

const TRAIL = 22;

/** The homepage illustration. Hand-authored motion only: it shows the six
 * demo words and one "No confident match", with no figures attached, and is labelled as
 * an illustration. Frames are drawn by writing SVG attributes directly, so
 * React re-renders only when the caption changes (about three times a sign). */
export function HeroPreview() {
  const [view, setView] = useState<{ index: number; phase: Phase }>({ index: STILL_FRAME.index, phase: STILL_FRAME.phase });
  const [reduced, setReduced] = useState(false);
  // null follows the motion preference; a press of the button overrides it.
  const [choice, setChoice] = useState<"play" | "pause" | null>(null);
  const playing = choice ? choice === "play" : !reduced;
  const rootRef = useRef<HTMLElement>(null);
  const hands = useRef<Record<"dominant" | "support", HandRefs>>({
    dominant: { group: null, palm: null, halo: null, bones: null, joints: null, tips: null },
    support: { group: null, palm: null, halo: null, bones: null, joints: null, tips: null },
  });
  const pulseRef = useRef<SVGCircleElement>(null);
  const trailRefs = useRef<(SVGPathElement | null)[]>([]);
  const elapsed = useRef(0);
  const viewRef = useRef(view);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const trail: Point[] = [];
    const draw = (frame: Frame) => {
      for (const [key, side] of [["dominant", 1], ["support", -1]] as const) {
        const refs = hands.current[key], geometry = handGeometry(frame.scene[key], side);
        refs.group?.setAttribute("opacity", geometry.opacity.toFixed(3));
        refs.palm?.setAttribute("d", geometry.palm);
        refs.halo?.setAttribute("d", geometry.bones);
        refs.bones?.setAttribute("d", geometry.bones);
        refs.joints?.setAttribute("d", geometry.joints);
        refs.tips?.setAttribute("d", geometry.tips);
        if (key === "dominant") {
          const centre = palmCentre(geometry.points);
          // The trail follows movement while it is being watched and fades once a result shows.
          if (frame.phase !== "result") trail.push(centre); else trail.shift();
          if (trail.length > TRAIL) trail.shift();
          trailRefs.current.forEach((path, i) => {
            const points = trail.slice(-Math.round(TRAIL * (i + 1) / 3));
            path?.setAttribute("d", points.length > 1 ? points.map((p, j) => `${j ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join("") : "");
          });
          const pulse = pulseRef.current;
          if (pulse) {
            pulse.setAttribute("cx", centre.x.toFixed(1));
            pulse.setAttribute("cy", centre.y.toFixed(1));
            pulse.setAttribute("r", (22 + frame.pulse * 26).toFixed(1));
            pulse.setAttribute("opacity", frame.pulse ? (0.55 * (1 - frame.pulse)).toFixed(3) : "0");
          }
        }
      }
      if (frame.index !== viewRef.current.index || frame.phase !== viewRef.current.phase) {
        viewRef.current = { index: frame.index, phase: frame.phase };
        setView(viewRef.current);
      }
    };

    if (!playing) {
      trail.length = 0;
      draw(elapsed.current ? frameAt(elapsed.current) : STILL_FRAME);
      return;
    }
    // Run only while the illustration is on screen and the tab is visible.
    let visible = true, raf = 0, last = 0;
    const loop = (now: number) => {
      if (last) elapsed.current += Math.min(now - last, 100);
      last = now;
      draw(frameAt(elapsed.current));
      raf = requestAnimationFrame(loop);
    };
    const resume = () => {
      cancelAnimationFrame(raf);
      last = 0;
      if (visible && !document.hidden) raf = requestAnimationFrame(loop);
    };
    const observer = "IntersectionObserver" in window && rootRef.current
      ? new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; resume(); })
      : null;
    if (observer && rootRef.current) observer.observe(rootRef.current);
    document.addEventListener("visibilitychange", resume);
    resume();
    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      document.removeEventListener("visibilitychange", resume);
    };
  }, [playing]);

  const item = DEMO_SEQUENCE[view.index];
  const shown = view.phase === "result" ? view.index + 1 : view.index;
  const words = DEMO_SEQUENCE.slice(0, shown).filter(entry => entry.confirmed).map(entry => entry.translation).slice(-4);
  const initial = { dominant: handGeometry(STILL_FRAME.scene.dominant, 1), support: handGeometry(STILL_FRAME.scene.support, -1) };

  return (
    <figure className="hero-preview" ref={rootRef} data-phase={view.phase} data-playing={playing || undefined}>
      <figcaption className="sr-only">
        Illustration, not live: two hands sign Hello, Thank you, Please, Yes, Sorry and No, and one movement gets no confident match, so nothing is added.
      </figcaption>
      <div className="hero-stage">
        <span className="hero-label">Illustration · Not live</span>
        <button type="button" className="hero-motion-toggle" onClick={() => setChoice(playing ? "pause" : "play")}
          aria-label={playing ? "Pause animation" : "Play animation"} aria-pressed={!playing}>
          {playing ? <Pause aria-hidden="true" size={14} /> : <Play aria-hidden="true" size={14} />}
        </button>
        <svg className="hero-hands" viewBox="0 0 400 300" aria-hidden="true" focusable="false">
          <defs>
            <radialGradient id="hero-space" cx="50%" cy="50%" r="50%">
              <stop offset="0" stopColor="rgb(94 234 212 / .10)" />
              <stop offset="1" stopColor="rgb(94 234 212 / 0)" />
            </radialGradient>
          </defs>
          <ellipse cx="220" cy="170" rx="210" ry="160" fill="url(#hero-space)" />
          {[0, 1, 2].map(i => <path key={i} className={`hero-trail t${i}`} ref={node => { trailRefs.current[i] = node; }} />)}
          <circle className="hero-pulse" ref={pulseRef} r="22" opacity="0" />
          {(["support", "dominant"] as const).map(key => (
            <g key={key} className={`hero-hand ${key}`} opacity={initial[key].opacity}
              ref={node => { hands.current[key].group = node; }}>
              <path className="palm" d={initial[key].palm} ref={node => { hands.current[key].palm = node; }} />
              <path className="halo" d={initial[key].bones} ref={node => { hands.current[key].halo = node; }} />
              <path className="bones" d={initial[key].bones} ref={node => { hands.current[key].bones = node; }} />
              <path className="joints" d={initial[key].joints} ref={node => { hands.current[key].joints = node; }} />
              <path className="tips" d={initial[key].tips} ref={node => { hands.current[key].tips = node; }} />
            </g>
          ))}
        </svg>
      </div>
      <div className="hero-transcript">
        <span className="hero-transcript-label">Transcript preview</span>
        <p>
          {words.map((word, index) => (
            <span key={word} className={index === words.length - 1 && view.phase === "result" && item.confirmed ? "new" : ""}>{word}</span>
          ))}
          <i className="hero-caret" aria-hidden="true" />
        </p>
      </div>
    </figure>
  );
}
