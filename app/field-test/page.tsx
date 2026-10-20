"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  capturePlan, captureTrial, captureTypes, slotLabels, takeCount, videoExtension,
  type CaptureType,
} from "@/lib/field-test-capture";
import styles from "./page.module.css";

type Clip = { blob: Blob; mime: string; trial: ReturnType<typeof captureTrial>; recordedAt: string; dominantHand: string; physicalHands: string[]; device: string; oovGloss: string | null };
const MAX_MS = 30_000;
const MAX_BYTES = 100 * 1024 * 1024;
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
  const [physicalHands, setPhysicalHands] = useState("Right");
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
  const invalidCaptureRef = useRef(false);
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
    invalidCaptureRef.current = true;
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
    if (!consent || !dominantHand || !device.trim() || (kind === "unknown_sign" && !oovGloss.trim())) {
      setNotice("Consent, actual dominant hand and device are required. Unsupported signs also need a preselected label.");
      return;
    }
    if (recorderRef.current?.state === "recording") return;
    const currentTrial = captureTrial(participant, kind, slot, take);
    const chosenMime = MIME_OPTIONS.find(mime => MediaRecorder.isTypeSupported(mime));
    if (!chosenMime) { setNotice("This browser does not support tested WebM/MP4 recording. Use Chrome or a compatible recorder."); return; }
    invalidCaptureRef.current = false;
    const chunks: BlobPart[] = [];
    const recordedAt = new Date().toISOString();
    const capturedHand = physicalHands === "Both" ? ["Left", "Right"] : [physicalHands];
    try {
      const recorder = new MediaRecorder(stream, { mimeType: chosenMime, videoBitsPerSecond: 1_500_000 });
      recorderRef.current = recorder;
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => { invalidCaptureRef.current = true; resetTimers(); setRecording(false); setNotice("Recording failed; this take cannot be used."); };
      recorder.onstop = () => {
        resetTimers();
        setRecording(false);
        const blob = new Blob(chunks, { type: recorder.mimeType || chosenMime || "video/webm" });
        if (invalidCaptureRef.current || !blob.size || blob.size > MAX_BYTES) {
          setClip(null);
          setNotice("The capture was interrupted, empty or exceeded 100 MB. Discard and try again.");
          return;
        }
        setClip({ blob, mime: blob.type, trial: currentTrial, recordedAt,
          dominantHand, physicalHands: capturedHand, device: device.trim(), oovGloss: kind === "unknown_sign" ? oovGloss.trim() : null });
        setNotice("Recorded locally. Download BOTH the original video and its metadata; they have not been reviewed.");
      };
      setClip(null);
      recorder.start(500);
      setRecording(true);
      setElapsed(0);
      const started = performance.now();
      countdownRef.current = setInterval(() => setElapsed(Math.min(30, Math.floor((performance.now() - started) / 1000))), 250);
      cutoffRef.current = setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, MAX_MS);
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
    const metadata = {
      ...clip.trial,
      status: "pending-independent-fluent-review",
      original_recording_file: clip.trial.trial_id + "." + videoExtension(clip.mime),
      mime_type: clip.mime,
      bytes: clip.blob.size,
      recorded_at: clip.recordedAt,
      dominant_hand: clip.dominantHand,
      physical_hands: clip.physicalHands,
      device: clip.device,
      claimed_unsupported_gloss: clip.oovGloss,
      oov_vocabulary_verified: false,
      consent_documentation: "Store consent reference separately in private intake. Checkbox is not proof of consent.",
      review: { status: "pending", reviewer_id: null, fluent_asl: false, blinded_to_predictions: false },
      note: "Downloaded original browser recording. Not scored or reviewed. This is a development take, never a holdout."
    };
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
                <option value="Left">Left</option><option value="Right">Right</option><option value="Both">Both</option>
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
          {clip && <p className={styles.slot}>Ready: {clip.trial.trial_id} · {(clip.blob.size / (1024 * 1024)).toFixed(1)} MB · {clip.mime}</p>}
          <p className={styles.small}>No video, identity mapping, consent record or results are saved by this page across reloads. The downloaded file is not automatically imported into the collection plan. Never mark it reviewed without a human independent fluent signer.</p>
        </section>
      </div>
    </main>
  );
}
