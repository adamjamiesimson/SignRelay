// Synthetic-camera UI smoke test; not evidence of signing accuracy or human review.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { startChrome } from "../scripts/diagnostics/chrome-session.mjs";

const executable = process.argv[2];
if (!executable) throw new Error("Supply Chrome executable after static export build");
const port = 18200 + Math.floor(Math.random() * 500), origin = "http://127.0.0.1:" + port;
const server = spawn(process.execPath, ["scripts/serve-export.mjs", "--port", String(port)], { stdio: "ignore" });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, reason) {
  for (let i = 0; i < 130; i++) { if (await check()) return; await pause(100); }
  throw new Error(reason);
}
let browser, detach;
try {
  await until(async () => { try { return (await fetch(origin)).ok; } catch { return false; } }, "No static server");
  browser = await startChrome(executable);
  const outgoing = [];
  detach = browser.onEvent(message => {
    if (message.method === "Network.requestWillBeSent" && ["POST", "PUT", "PATCH"].includes(message.params.request.method))
      outgoing.push(message.params.request.method + " " + message.params.request.url);
  });
  const injection = [
    "window.__qaDownloads=[];window.__qaBlobs=new Map();window.__qaTracks=[];window.__qaDelayPermission=false;window.__qaReleasePermission=null;",
    "const create=URL.createObjectURL.bind(URL);",
    "URL.createObjectURL=function(blob){const url=create(blob);window.__qaBlobs.set(url,blob);return url;};",
    "const nativeClick=HTMLAnchorElement.prototype.click;",
    "HTMLAnchorElement.prototype.click=function(){if(this.download){window.__qaDownloads.push({name:this.download,url:this.href});return;}return nativeClick.call(this);};",
    "const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);",
    "navigator.mediaDevices.getUserMedia=async options=>{if(window.__qaDelayPermission)await new Promise(resolve=>window.__qaReleasePermission=resolve);const stream=await get(options);window.__qaTracks.push(...stream.getTracks());return stream;};",
  ].join("");
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: "(()=>{" + injection + "})()" });
  await browser.send("Page.navigate", { url: origin + "/field-test/" });
  const evaluate = browser.evaluate;
  const click = label => evaluate("(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===" + JSON.stringify(label) + ");if(!b||b.disabled)throw Error('Button unavailable: '+" + JSON.stringify(label) + ");b.click()})()");
  const status = () => evaluate("document.querySelector('[role=status]')?.textContent");
  await until(() => evaluate("!!document.querySelector('input[type=checkbox]')"), "Capture UI missing");
  assert.equal(await evaluate("document.querySelector('meta[name=robots]')?.content.includes('noindex')"), true);
  assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Start camera')?.disabled"), true);
  // Static prerendered controls can exist before React attaches handlers.
  // Re-attempt a genuine unchecked→checked transition until state changes.
  await until(async () => {
    await evaluate("(()=>{const box=document.querySelector('input[type=checkbox]');if(box.checked)box.click();box.click()})()");
    return evaluate("![...document.querySelectorAll('button')].find(b=>b.textContent==='Start camera')?.disabled");
  }, "Consent did not activate camera button after hydration");
  await click("Start camera");
  await until(async () => (await status())?.includes("Camera ready"), "Camera did not start");
  await click("Record this take");
  await until(async () => (await status())?.includes("actual dominant hand"), "Missing metadata was not rejected");
  await evaluate("(()=>{const hand=[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Actual dominant hand')).querySelector('select');hand.value='Right';hand.dispatchEvent(new Event('change',{bubbles:true}));const input=document.querySelector('input[placeholder=\"e.g. Pixel 8 / Chrome\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'CI fake camera / Chrome');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await until(() => evaluate("document.querySelector('input[placeholder=\"e.g. Pixel 8 / Chrome\"]')?.value.includes('CI fake')"), "Device metadata did not hydrate");
  await click("Record this take");
  await until(() => evaluate("!!document.querySelector('span[class*=rec]')"), "Recording did not start");
  await pause(800);
  await click("Stop recording");
  await until(async () => (await status())?.includes("Download BOTH"), "Recording was not completed");
  await click("Download original recording");
  await click("Download capture metadata");
  const files = await evaluate("(async()=>{const files=[];for(const entry of window.__qaDownloads){const blob=window.__qaBlobs.get(entry.url);files.push({name:entry.name,mime:blob?.type,size:blob?.size,meta:entry.name.endsWith('.json')?JSON.parse(await blob.text()):null});}return files;})()");
  assert.equal(files.length, 2);
  const video = files.find(f => /\.(mp4|webm)$/.test(f.name));
  const metadata = files.find(f => f.name.endsWith(".capture.json"));
  assert(video && video.size > 0 && metadata, JSON.stringify(files));
  assert.match(video.mime, /^video\/(mp4|webm)/);
  assert.equal(metadata.meta.trial_id, "dev-20261017-p01-sign-1-1");
  assert.equal(metadata.meta.original_recording_file, video.name);
  assert.equal(metadata.meta.status, "pending-independent-fluent-review");
  assert.equal(metadata.meta.review.status, "pending");
  assert.equal(metadata.meta.review.fluent_asl, false);
  assert.equal(metadata.meta.evaluation_split, "development");
  assert.equal(metadata.meta.expected_gloss, "HELLO");
  assert.equal(metadata.meta.device, "CI fake camera / Chrome");
  assert.equal(metadata.meta.dominant_hand, "Right");
  await browser.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, mobile: true, deviceScaleFactor: 1 });
  assert.equal(await evaluate("document.documentElement.scrollWidth<=390"), true, "Phone layout overflows");
  await browser.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, mobile: false, deviceScaleFactor: 1 });
  await click("Record this take");
  await until(() => evaluate("!!document.querySelector('span[class*=rec]')"), "Second recording did not start");
  await evaluate("(()=>{const track=window.__qaTracks.findLast(t=>t.kind==='video');if(!track)throw Error('No video track');track.dispatchEvent(new Event('ended'));})()");
  await until(async () => (await status())?.includes("interrupted"), "Track interruption was not recognized");
  assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Download original recording')?.disabled"), true);
  await click("Start camera");
  await until(async () => (await status())?.includes("Camera ready"), "Recovery camera failed");
  await evaluate("document.querySelector('input[type=checkbox]').click()");
  await until(async () => (await status())?.includes("Consent acknowledgement withdrawn"), "Consent withdrawal not reflected");
  await until(() => evaluate("window.__qaTracks.at(-1)?.readyState==='ended'"), "Camera track not stopped when consent withdrawn");
  assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Start camera')?.disabled"), true);
  assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Download original recording')?.disabled"), true);
  // Hold permission in the browser until after the consent acknowledgement is revoked.
  await evaluate("document.querySelector('input[type=checkbox]').click()");
  await until(() => evaluate("![...document.querySelectorAll('button')].find(b=>b.textContent==='Start camera')?.disabled"), "Consent could not be renewed");
  await evaluate("window.__qaDelayPermission=true");
  await click("Start camera");
  await until(async () => (await status())?.includes("Waiting for camera permission"), "Deferred grant never requested");
  await evaluate("document.querySelector('input[type=checkbox]').click()");
  await until(async () => (await status())?.includes("Consent acknowledgement withdrawn"), "Pending request not cancelled");
  await evaluate("window.__qaReleasePermission()");
  await until(() => evaluate("window.__qaTracks.at(-1)?.readyState==='ended'"), "Late camera permission leaked a track");
  assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Start camera')?.disabled"), true);
  assert.deepEqual(outgoing, [], "Camera data must not be POSTed");
  console.log(JSON.stringify({passed:true,synthetic_only:true,physical_device_tested:false,
    local_downloads:files.map(f=>({name:f.name,mime:f.mime,bytes:f.size})),
    metadata_pending_review:true,interrupted_take_rejected:true,consent_withdrawal_closes_camera:true,late_permission_released:true,tracks_released:true,
    zero_upload_network_requests:true,mobile_390px:true}));
} catch (error) {
  if (browser) console.error(JSON.stringify({ errors: browser.errors, status: await browser.evaluate("document.querySelector('[role=status]')?.textContent").catch(() => null) }));
  throw error;
} finally { detach?.(); await browser?.close(); server.kill(); }
