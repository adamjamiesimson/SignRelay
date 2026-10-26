"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Camera, ChevronDown, Search } from "lucide-react";
import { RSL_FRAMES, RSL_LABELS, RSL_SIZE, rslLetterbox, type RslInput, type RslOutput, type RslPrediction } from "@/lib/rsl-video";

type State = "idle" | "loading" | "ready" | "countdown" | "recording" | "processing" | "error";

export function RslRecognizer({ onBack }: { onBack: () => void }) {
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("Start the camera and load the pretrained model when you are ready.");
  const [result, setResult] = useState<RslPrediction | null>(null);
  const [search, setSearch] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const worker = useRef<Worker | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const animation = useRef(0);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frames = useRef<Uint8ClampedArray[]>([]);
  const starting = useRef(false);

  const release = useCallback(() => {
    generation.current++;
    starting.current = false;
    cancelAnimationFrame(animation.current);
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = null;
    worker.current?.terminate(); worker.current = null;
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    if (video.current) video.current.srcObject = null;
    frames.current = [];
  }, []);
  const stop = useCallback(() => {
    release(); setState("idle"); setResult(null); setMessage("Stopped. Camera frames were discarded.");
  }, [release]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", hidden);
    return () => { document.removeEventListener("visibilitychange", hidden); release(); };
  }, [release, stop]);

  const fail = useCallback((message: string) => {
    release(); setState("error"); setMessage(message);
  }, [release]);

  async function start() {
    if (starting.current || worker.current) return;
    starting.current = true;
    const token = ++generation.current;
    setState("loading"); setResult(null); setMessage("Opening camera and loading 141 MB of pretrained weights. This may take a minute.");
    try {
      const camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      if (token !== generation.current) { camera.getTracks().forEach(track => track.stop()); return; }
      stream.current = camera;
      camera.getVideoTracks().forEach(track => track.addEventListener("ended", () => {
        if (token === generation.current) fail("The camera disconnected. Start again to reconnect.");
      }, { once: true }));
      if (!video.current) throw new Error("Camera view unavailable");
      video.current.srcObject = camera;
      await video.current.play();
      if (token !== generation.current) return;
      const instance = new Worker("/workers/rsl.worker.js?v=slovo-1", { type: "module" });
      worker.current = instance;
      instance.onerror = instance.onmessageerror = () => { if (token === generation.current) fail("The model was interrupted. Start again to retry."); };
      instance.onmessage = ({ data }: MessageEvent<RslOutput>) => {
        if (token !== generation.current) return;
        if (timeout.current) clearTimeout(timeout.current);
        if (data.type === "error") { fail(data.message); return; }
        setState("ready");
        if (data.type === "ready") setMessage("Ready. Keep your face, upper body and both hands inside the frame.");
        else {
          setResult(data.prediction);
          setMessage(data.prediction ? "Experimental suggestion—not a verified translation. Check the result before using it." : "No confident match. Try one complete sign with clear framing and lighting.");
        }
      };
      timeout.current = setTimeout(() => fail("Model loading timed out. Check your connection and try again."), 180000);
      instance.postMessage({ type: "load" } satisfies RslInput);
    } catch {
      if (token === generation.current) fail("Camera access failed. Check browser permission, close other camera apps, and try again.");
    } finally { if (token === generation.current) starting.current = false; }
  }

  function recognize() {
    if (state !== "ready" || !video.current || !worker.current) return;
    setResult(null); setState("countdown"); frames.current = [];
    const token = generation.current, began = performance.now();
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = RSL_SIZE;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) { fail("This browser cannot read camera frames."); return; }
    let lastSample = -Infinity, lastVideoTime = -1, lastProgress = began + 3000;
    const tick = (now: number) => {
      if (token !== generation.current) return;
      const remaining = 3000 - (now - began);
      if (remaining > 0) setMessage(`Get ready: ${Math.ceil(remaining / 1000)}…`);
      else {
        const source = video.current;
        if (now - lastProgress > 800) { fail("Camera frames arrived too slowly. Try again in good lighting, with fewer apps open."); return; }
        if (source && source.readyState >= 2 && source.currentTime !== lastVideoTime && now - lastSample >= 1000 / 15 - 3) {
          if (frames.current.length === 0) setState("recording");
          lastProgress = lastSample = now; lastVideoTime = source.currentTime;
          try {
            const box = rslLetterbox(source.videoWidth, source.videoHeight);
            context.fillStyle = "rgb(114,114,114)"; context.fillRect(0, 0, RSL_SIZE, RSL_SIZE);
            context.drawImage(source, box.x, box.y, box.width, box.height);
            frames.current.push(context.getImageData(0, 0, RSL_SIZE, RSL_SIZE).data);
          } catch { fail("The camera frame could not be read. Start again to retry."); return; }
          setMessage(`Sign now · ${frames.current.length} / ${RSL_FRAMES} frames`);
        }
        if (frames.current.length === RSL_FRAMES) {
          setState("processing"); setMessage("Recognizing locally… Allow 20–60 seconds on slower devices. You can cancel at any time.");
          const clip = frames.current; frames.current = [];
          timeout.current = setTimeout(() => fail("Recognition timed out on this device. No result was added."), 120000);
          worker.current?.postMessage({ type: "recognize", frames: clip } satisfies RslInput, clip.map(frame => frame.buffer));
          return;
        }
        if (now - began > 6500) { fail("Could not capture the sign at the required frame rate. Try again with fewer apps open."); return; }
      }
      animation.current = requestAnimationFrame(tick);
    };
    animation.current = requestAnimationFrame(tick);
  }

  const matches = RSL_LABELS.filter(label => label.toLocaleLowerCase("ru").includes(search.toLocaleLowerCase("ru")));
  const busy = state === "loading" || state === "processing";
  return <section className="clip-recognizer rsl-workspace" aria-labelledby="rsl-title">
    <div className="clip-header">
      <button type="button" className="back-link" onClick={() => { release(); onBack(); }}><ArrowLeft aria-hidden="true" size={16} />Back to languages</button>
      <p className="eyebrow">Russian Sign Language · One sign at a time · Experimental</p>
      <h1 id="rsl-title">Recognize one RSL sign.</h1>
      <p className="lead">967 word and phrase classes plus 33 fingerspelling letters, with no teaching required. A slow research model for isolated signs, not real-time or sentence translation.</p>
    </div>
    <div className="clip-layout">
      <div className="clip-stage" data-state={state}>
        <video ref={video} autoPlay playsInline muted aria-label="Unmirrored camera preview; frame your face, torso and hands" />
        {(state === "idle" || state === "error") && <div className="clip-placeholder" aria-hidden="true"><Camera size={22} /><span>Camera off</span></div>}
      </div>
      <div className="clip-panel">
        <p className={`clip-status ${state}${busy ? " busy" : ""}`} role="status" aria-live="polite">{message}</p>
        <div className="rsl-actions">
          {(state === "idle" || state === "error") && <button type="button" className="button primary" onClick={start}>Start camera &amp; load model</button>}
          {state === "ready" && <button type="button" className="button primary" onClick={recognize}>Recognize one sign</button>}
          {state !== "idle" && state !== "error" && <button type="button" className="button secondary" onClick={stop}>Stop / cancel</button>}
        </div>
        {result && <div className="rsl-result"><span className="candidate-label">Suggestion · check before using</span><h2 lang="ru">{result.label}</h2><p>Model score {Math.round(result.confidence * 100)} out of 100. This is not a measured accuracy or reliability guarantee.</p></div>}
        <ol className="clip-steps">
          <li>Start the camera. The first load downloads 141 MB of model weights.</li>
          <li>After a 3-second countdown, sign one complete word over about 2 seconds.</li>
          <li>Keep your face, upper body and both hands in the frame.</li>
        </ol>
        <p className="field-hint">Camera frames stay in memory on this device and are never uploaded or saved. Suggestions are not spoken or added to a transcript. Don’t rely on them for medical, legal or emergency communication.</p>
        <details className="workspace-disclosure">
          <summary>Browse the 1,000 trained sign classes <ChevronDown aria-hidden="true" size={16} /></summary>
          <div className="disclosure-body">
            <label className="search-field" htmlFor="rsl-vocabulary"><Search aria-hidden="true" size={16} /><span className="sr-only">Search Russian labels</span>
              <input id="rsl-vocabulary" value={search} onChange={event => setSearch(event.target.value)} type="search" placeholder="Search Russian labels" /></label>
            <p className="field-hint">{matches.length} matches. Showing the first 50.</p>
            <ul className="clip-vocabulary" lang="ru">{matches.slice(0, 50).map((label, index) => <li key={`${label}-${index}`}>{label}</li>)}</ul>
          </div>
        </details>
        <p className="clip-links"><a href="/models">Model limitations</a><a href="/models/rsl1000-slovo/ATTRIBUTION.md">Slovo attribution and licence</a></p>
      </div>
    </div>
  </section>;
}
