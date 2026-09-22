"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BdslFrame, BdslInput, BdslOutput, BdslPrediction } from "@/lib/bdsl-video";

type State = "idle" | "loading" | "ready" | "countdown" | "recording" | "processing" | "error";

export function BdslRecognizer({ onBack }: { onBack: () => void }) {
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("Start when you are ready. Model loading begins only after you choose Start.");
  const [result, setResult] = useState<BdslPrediction | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const worker = useRef<Worker | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const generation = useRef(0), animation = useRef(0);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frames = useRef<BdslFrame[]>([]);
  const starting = useRef(false), finishRequested = useRef(false);

  const release = useCallback(() => {
    generation.current++; starting.current = false; finishRequested.current = false;
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
  const fail = useCallback((reason: string) => {
    release(); setState("error"); setResult(null); setMessage(reason);
  }, [release]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", hidden);
    return () => { document.removeEventListener("visibilitychange", hidden); release(); };
  }, [release, stop]);

  async function start() {
    if (starting.current || worker.current) return;
    starting.current = true;
    const token = ++generation.current;
    setState("loading"); setResult(null); setMessage("Opening camera and loading 97 MB of model weights…");
    try {
      const camera = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } } });
      if (token !== generation.current) { camera.getTracks().forEach(track => track.stop()); return; }
      stream.current = camera;
      camera.getVideoTracks().forEach(track => track.addEventListener("ended", () => {
        if (token === generation.current) fail("The camera disconnected. Start again to reconnect.");
      }, { once: true }));
      if (!video.current) throw new Error("Camera view unavailable");
      video.current.srcObject = camera;
      await video.current.play();
      if (token !== generation.current) return;
      const instance = new Worker("/workers/bdsl.worker.js?v=videomae-weight-only-1", { type: "module" });
      worker.current = instance;
      instance.onerror = instance.onmessageerror = () => {
        if (token === generation.current) fail("Recognition was interrupted. Start again to retry.");
      };
      instance.onmessage = ({ data }: MessageEvent<BdslOutput>) => {
        if (token !== generation.current) return;
        if (timeout.current) clearTimeout(timeout.current);
        timeout.current = null;
        if (data.type === "error") { fail(data.message); return; }
        setState("ready");
        if (data.type === "ready") setMessage("Ready. Keep your face, upper body and both hands visible.");
        else {
          setResult(data.prediction);
          setMessage(data.prediction ? "Experimental suggestion. Check the meaning with your conversation partner." : "No confident match. Try one complete sign with clear framing and lighting.");
        }
      };
      timeout.current = setTimeout(() => fail("Model loading timed out. Check your connection and try again."), 180000);
      instance.postMessage({ type: "load" } satisfies BdslInput);
    } catch {
      if (token === generation.current) fail("Camera access failed. Check permission and close other camera apps before retrying.");
    } finally { if (token === generation.current) starting.current = false; }
  }

  function recognize() {
    if (state !== "ready" || !video.current || !worker.current) return;
    setResult(null); setState("countdown"); frames.current = []; finishRequested.current = false;
    const token = generation.current, began = performance.now();
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) { fail("This browser cannot read camera frames."); return; }
    let lastSample = -Infinity, lastVideoTime = -1, lastProgress = began + 3000;
    const tick = (now: number) => {
      if (token !== generation.current) return;
      const elapsed = now - began - 3000;
      if (elapsed < 0) setMessage(`Get ready: ${Math.ceil(-elapsed / 1000)}…`);
      else {
        const source = video.current;
        if (now - lastProgress > 1500) { fail("Camera frames arrived too slowly. Retry with fewer apps open."); return; }
        // Three samples/second approximates the author's every-tenth-frame input at 30 fps.
        if (source && source.readyState >= 2 && source.currentTime !== lastVideoTime && now - lastSample >= 1000 / 3 - 3) {
          lastProgress = lastSample = now; lastVideoTime = source.currentTime;
          try {
            if (source.videoWidth > 1920 || source.videoHeight > 1080) throw new Error("Unsupported capture size");
            canvas.width = source.videoWidth; canvas.height = source.videoHeight;
            context.drawImage(source, 0, 0);
            frames.current.push({ width: canvas.width, height: canvas.height, rgba: context.getImageData(0, 0, canvas.width, canvas.height).data });
          } catch { fail("The camera frame could not be read. Start again to retry."); return; }
          setState("recording"); setMessage("Sign one word, then choose Finish sign. Capture ends automatically after 6 seconds.");
        }
        if ((finishRequested.current && frames.current.length >= 4) || elapsed >= 6000) {
          if (frames.current.length < 4) { fail("Too few camera frames. Try again."); return; }
          setState("processing"); setMessage("Recognizing on your device… This can take 15–60 seconds. You can cancel at any time.");
          const clip = frames.current; frames.current = [];
          timeout.current = setTimeout(() => fail("Recognition timed out. No result was added."), 120000);
          worker.current?.postMessage({ type: "recognize", frames: clip } satisfies BdslInput, clip.map(frame => frame.rgba.buffer));
          return;
        }
      }
      animation.current = requestAnimationFrame(tick);
    };
    animation.current = requestAnimationFrame(tick);
  }

  return <section className="rsl-workspace" aria-labelledby="bdsl-title">
    <button className="button secondary small" onClick={() => { release(); onBack(); }}>Back to languages</button>
    <p className="eyebrow">Bangla Sign Language · experimental</p>
    <h1 id="bdsl-title">Recognize one Bangla sign.</h1>
    <p>401 trained sign classes, mapped to 398 distinct English glosses. No personal teaching required.</p>
    <p>First load: 97 MB. This research model processes one sign at a time. Camera frames stay on your device and are discarded after use.</p>
    <video ref={video} autoPlay playsInline muted aria-label="Unmirrored camera preview; keep your face, torso and hands visible" style={{ width: "100%", maxWidth: 640, aspectRatio: "4 / 3", background: "#111", borderRadius: 16 }} />
    <p role="status" aria-live="polite">{message}</p>
    <div className="rsl-actions">
      {(state === "idle" || state === "error") && <button className="button primary" onClick={start}>Start camera &amp; load model</button>}
      {state === "ready" && <button className="button primary" onClick={recognize}>Recognize one sign</button>}
      {state === "recording" && <button className="button primary" onClick={() => { finishRequested.current = true; }}>Finish sign</button>}
      {state !== "idle" && state !== "error" && <button className="button secondary" onClick={stop}>Stop / cancel</button>}
    </div>
    {result && <div className="rsl-result"><h2>{result.label}</h2><p>Class {result.code} · Model score: {Math.round(result.confidence * 100)}%. A score is not measured accuracy.</p></div>}
    <p>After the countdown, make one complete sign and choose Finish sign. Results are suggestions; they are never automatically spoken or added to a transcript.</p>
    <p><a href="/models">Evaluation and limitations</a> · <a href="/models/bdsl401-videomae/ATTRIBUTION.md">Model attribution</a></p>
  </section>;
}
