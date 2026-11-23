"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  MAX_RECORDING_MS, captureMetadata, capturePlan, captureTrial, captureTypes, rejectRecording, sha256Hex,
  slotLabels, takeCount, videoExtension, type CaptureType, type CapturedTake,
} from "@/lib/field-test-capture";
import styles from "./page.module.css";

type Clip = CapturedTake & { blob: Blob };
const MIME_OPTIONS = ["video/webm;codecs=vp8", "video/webm", "video/mp4"];

function saveDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export default function FieldTestPage() {
  const [participant, setParticipant] = useState(0);
  const [kind, setKind] = useState<CaptureType>("sign");
  const [slot, setSlot] = useState(1);
  const [take, setTake] = useState(1);
  const [dominantHand, setDominantHand] = useState("");
  const [physicalHands, setPhysicalHands] = useState("");
  const [device, setDevice] = useState("");
  const [oovGloss, setOovGloss] = useState("");
  const [consent, setConsent] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraPending, setCameraPending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [clip, setClip] = useState<Clip | null>(null);
  const [notice, setNotice] = useState("Select a development slot and start the camera.");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraGenerationRef = useRef(0);
  const cameraPendingRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  // Why the current take cannot be used; null while it is still intact.
  const interruptionRef = useRef<string | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cutoffRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const labels = slotLabels(kind);
  const trial = captureTrial(participant, kind, slot, take);
  const resetTimers = () => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (cutoffRef.current) clearTimeout(cutoffRef.current);
    countdownRef.current = null;
    cutoffRef.current = null;
  };

  const releaseCamera = () => {
    cameraGenerationRef.current++;
    cameraPendingRef.current = false;
    setCameraPending(false);
    interruptionRef.current ??= "camera closed";
    resetTimers();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  };

  useEffect(() => () => {
    cameraGenerationRef.current++;
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (cutoffRef.current) clearTimeout(cutoffRef.current);
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach(track => track.stop());
  }, []);

  async function startCamera() {
    if (cameraPendingRef.current || streamRef.current) return;
    if (!consent) { setNotice("Confirm appropriate participant consent before opening the camera."); return; }
    if (!navigator.mediaDevices?.getUserMedia) { setNotice("Camera capture requires HTTPS or localhost and a compatible browser."); return; }
    const generation = ++cameraGenerationRef.current;
    cameraPendingRef.current = true;
    setCameraPending(true);
    setNotice("Waiting for camera permission…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      if (generation !== cameraGenerationRef.current || !videoRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      // An existing active stream is rejected before the permission request.
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      if (generation !== cameraGenerationRef.current) { stream.getTracks().forEach(track => track.stop()); return; }
      for (const track of stream.getVideoTracks()) track.addEventListener("ended", () => {
        if (generation !== cameraGenerationRef.current) return;
        releaseCamera();
        setNotice("Camera disconnected. Interrupted recordings will be discarded.");
      }, { once: true });
      setCameraOn(true);
      setNotice("Camera ready. Record one original take without mirroring, cutting or re-encoding it.");
    } catch (error) {
      if (generation !== cameraGenerationRef.current) return;
      setCameraOn(false);
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      setNotice(error instanceof Error ? "Camera unavailable: " + error.message : "Camera could not start.");
    } finally {
      if (generation === cameraGenerationRef.current) {
        cameraPendingRef.current = false;
        setCameraPending(false);
      }
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    resetTimers();
  }

  function startRecording() {
    const stream = streamRef.current;
    if (!stream || !cameraOn || typeof MediaRecorder === "undefined") {
      setNotice("Start the camera in a browser with MediaRecorder support first.");
      return;
    }
    if (!consent || !dominantHand || !physicalHands || !device.trim() || (kind === "unknown_sign" && !oovGloss.trim())) {
      setNotice("Consent, actual dominant hand, physical hands used and device are required. Unsupported signs also need a preselected label.");
      return;
    }
    if (recorderRef.current?.state === "recording") return;
    const currentTrial = captureTrial(participant, kind, slot, take);
    const chosenMime = MIME_OPTIONS.find(mime => MediaRecorder.isTypeSupported(mime));
    if (!chosenMime) { setNotice("This browser does not support tested WebM/MP4 recording. Use Chrome or a compatible recorder."); return; }
    interruptionRef.current = null;
    const chunks: BlobPart[] = [];
    const recordedAt = new Date().toISOString();
    const capturedHand = physicalHands === "Both" ? ["Left", "Right"] : [physicalHands];
    const videoTrack = stream.getVideoTracks()[0];
    const settings = videoTrack?.getSettings?.() ?? {};
    const camera = { width: settings.width ?? null, height: settings.height ?? null,
      frameRate: settings.frameRate ?? null, facingMode: settings.facingMode ?? null };
    let stopReason: Clip["stopReason"] = "manual";
    let started = performance.now();
    try {
      const recorder = new MediaRecorder(stream, { mimeType: chosenMime, videoBitsPerSecond: 1_500_000 });
      recorderRef.current = recorder;
      // A paused camera or hidden page can drop frames without ending the track.
      const interrupt = (reason: string) => {
        interruptionRef.current ??= reason;
        if (recorder.state === "recording") recorder.stop();
      };
      const onMute = () => interrupt("camera paused by the device");
      const onHidden = () => { if (document.hidden) interrupt("page hidden during recording"); };
      videoTrack?.addEventListener("mute", onMute);
      document.addEventListener("visibilitychange", onHidden);
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => { interruptionRef.current ??= "recorder error"; resetTimers(); setRecording(false); setNotice("Recording failed; this take cannot be used."); };
      recorder.onstop = () => {
        const durationMs = performance.now() - started;
        videoTrack?.removeEventListener("mute", onMute);
        document.removeEventListener("visibilitychange", onHidden);
        resetTimers();
        setRecording(false);
        const blob = new Blob(chunks, { type: recorder.mimeType || chosenMime || "video/webm" });
        const rejection = rejectRecording({ durationMs, bytes: blob.size, mimeType: blob.type, interruption: interruptionRef.current });
        if (rejection) {
          setClip(null);
          setNotice(rejection);
          return;
        }
        const generation = cameraGenerationRef.current;
        setNotice("Computing the recording checksum…");
        void sha256Hex(blob).catch(() => null).then(sha256 => {
          if (generation !== cameraGenerationRef.current) return;
          setClip({ blob, mime: blob.type, bytes: blob.size, sha256, trial: currentTrial, recordedAt, durationMs, stopReason,
            camera, dominantHand, physicalHands: capturedHand, device: device.trim(), oovGloss: kind === "unknown_sign" ? oovGloss.trim() : null });
          setNotice(sha256
            ? "Recorded locally. Download BOTH the original video and its metadata; they have not been reviewed."
            : "Recorded locally without a checksum (this browser lacks Web Crypto). Download BOTH files; intake will compute the checksum.");
        });
      };
      setClip(null);
      recorder.start(500);
      started = performance.now();
      setRecording(true);
      setElapsed(0);
      countdownRef.current = setInterval(() => setElapsed(Math.min(30, Math.floor((performance.now() - started) / 1000))), 250);
      cutoffRef.current = setTimeout(() => {
        stopReason = "time-limit";
        if (recorder.state === "recording") recorder.stop();
      }, MAX_RECORDING_MS);
      setNotice("Recording in progress. Include a natural lead-in and ending; stop within 30 seconds.");
    } catch (error) {
      resetTimers();
      setRecording(false);
      setNotice(error instanceof Error ? "Could not record: " + error.message : "Could not start recording.");
    }
  }

  function downloadVideo() {
    if (!clip) return;
    saveDownload(clip.blob, clip.trial.trial_id + "." + videoExtension(clip.mime));
  }

  function downloadMetadata() {
    if (!clip) return;
    const metadata = captureMetadata(clip);
    saveDownload(new Blob([JSON.stringify(metadata, null, 2) + "\n"], { type: "application/json" }), clip.trial.trial_id + ".capture.json");
  }

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <nav className={styles.nav}><Link href="/">← SignRelay</Link><span>Private research capture · development only</span></nav>
        <h1>Capture real signing evidence.</h1>
        <p className={styles.lead}>Record consenting participants locally for the ASL development set. Nothing here automatically uploads, validates a gloss, establishes fluency or enters the final holdout.</p>
        <div className={styles.banner} role="note"><strong>Privacy first.</strong> Record in a secure place. Download and move clips to your private, Git-ignored evaluation directory. Never submit participant video, faces, consent records or landmarks to a public repository. Obtain guardian permission when required.</div>

        <section className={styles.card} aria-labelledby="slot-title">
          <h2 id="slot-title">1. Select a frozen collection slot</h2>
          <div className={styles.grid}>
            <label>Participant pseudonym
              <select value={participant} disabled={recording} onChange={e => setParticipant(Number(e.target.value))}>
                {capturePlan.participant_ids.map((id, index) => <option key={id} value={index}>{id}</option>)}
              </select>
            </label>
            <label>Trial category
              <select value={kind} disabled={recording} onChange={e => { setKind(e.target.value as CaptureType); setSlot(1); setTake(1); }}>
                {captureTypes.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
            <label>Sign or activity
              <select value={slot} disabled={recording} onChange={e => setSlot(Number(e.target.value))}>
                {labels.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
              </select>
            </label>
            <label>Take
              <select value={take} disabled={recording} onChange={e => setTake(Number(e.target.value))}>
                {Array.from({ length: takeCount(kind) }, (_, index) => <option key={index} value={index + 1}>Take {index + 1}</option>)}
              </select>
            </label>
            <label>Actual dominant hand
              <select value={dominantHand} disabled={recording} onChange={e => setDominantHand(e.target.value)}>
                <option value="">Select actual hand</option><option value="Left">Left</option><option value="Right">Right</option>
              </select>
            </label>
            <label>Physical hands used
              <select value={physicalHands} disabled={recording} onChange={e => setPhysicalHands(e.target.value)}>
                <option value="">Select hands used</option><option value="Left">Left</option><option value="Right">Right</option><option value="Both">Both</option>
              </select>
            </label>
            <label>Device (model / browser)
              <input value={device} disabled={recording} maxLength={120} placeholder="e.g. Pixel 8 / Chrome" onChange={e => setDevice(e.target.value)} />
            </label>
            {kind === "unknown_sign" && <label>Reviewer-selected gloss (not yet vocabulary-verified)
              <input value={oovGloss} disabled={recording} maxLength={80} placeholder="Enter gloss chosen BEFORE prediction" onChange={e => setOovGloss(e.target.value)} />
            </label>}
          </div>
          <p className={styles.slot}><strong>Slot:</strong> {trial.trial_id} · {trial.instruction}</p>
          <label className={styles.consent}>
            <input type="checkbox" checked={consent} onChange={e => {
              setConsent(e.target.checked);
              if (!e.target.checked) {
                releaseCamera();
                setClip(null);
                setNotice("Consent acknowledgement withdrawn. Camera closed; any partial recording discarded.");
              }
            }} />
            <span>I have obtained appropriate informed consent for this research recording, including guardian consent if required. The actual consent reference must be documented privately.</span>
          </label>
        </section>

        <section className={styles.card} aria-labelledby="camera-title">
          <h2 id="camera-title">2. Record an original take</h2>
          <div className={styles.camera}>
            <video ref={videoRef} playsInline muted autoPlay aria-label="Unmirrored source camera preview for research capture" />
            {!cameraOn && <div className={styles.placeholder}>Camera off</div>}
            {recording && <span className={styles.rec}>● REC {elapsed}s / 30s</span>}
          </div>
          <div className={styles.actions}>
            <button type="button" disabled={recording || cameraOn || cameraPending || !consent} onClick={() => void startCamera()}>Start camera</button>
            <button type="button" disabled={recording || !cameraOn || !consent} onClick={startRecording}>Record this take</button>
            <button type="button" disabled={!recording} onClick={stopRecording}>Stop recording</button>
            <button type="button" disabled={recording || (!cameraOn && !cameraPending)} onClick={releaseCamera}>Close camera</button>
          </div>
          <p role="status" className={styles.notice}>{notice}</p>
        </section>

        <section className={styles.card} aria-labelledby="download-title">
          <h2 id="download-title">3. Save your local evidence</h2>
          <p>Original file and metadata require two separate downloads. Store both privately. An independent fluent ASL reviewer must approve actual glosses and activities before these trials enter evaluation.</p>
          <div className={styles.actions}>
            <button type="button" disabled={!clip} onClick={downloadVideo}>Download original recording</button>
            <button type="button" disabled={!clip} onClick={downloadMetadata}>Download capture metadata</button>
            <button type="button" disabled={!clip} onClick={() => { setClip(null); setNotice("Recording discarded from this page's memory."); }}>Discard local result</button>
          </div>
          {clip && <p className={styles.slot}>Ready: {clip.trial.trial_id} · {(clip.durationMs / 1000).toFixed(1)} s · {(clip.blob.size / (1024 * 1024)).toFixed(1)} MB · {clip.mime}{clip.sha256 ? ` · SHA-256 ${clip.sha256.slice(0, 12)}…` : ""}</p>}
          <p className={styles.small}>No video, identity mapping, consent record or results are saved by this page across reloads. The downloaded file is not automatically imported into the collection plan. Never mark it reviewed without a human independent fluent signer.</p>
        </section>
      </div>
    </main>
  );
}
