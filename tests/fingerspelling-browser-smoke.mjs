// Remote headless Chromium with fake camera and synthetic WORD fixtures.
// Tests software behavior only. No alphabet model or real signer is involved.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { fixtures, openRehearsal, pause, until } from "./rehearsal-harness.mjs";
const executable = process.argv[2];
if (!executable) throw new Error("Pass Chrome executable");
mkdirSync("outputs", { recursive: true });
const h = await openRehearsal(executable, { extraInit: `
  const NativeWorker = window.Worker;
  window.__qa.wordWorkers = 0; window.__qa.wordTerminations = 0;
  window.Worker = class extends NativeWorker {
    constructor(url, options) { super(url, options); this.isWord = String(url).includes('recognition.worker'); if(this.isWord) window.__qa.wordWorkers++; }
    terminate() { if(this.isWord) window.__qa.wordTerminations++; return super.terminate(); }
  };
` });
const checks = [];
const text = () => h.evaluate("document.querySelector('#spelling-text')?.value");
try {
  await h.open("/?perf"); await h.start();
  assert.equal(await h.evaluate("document.querySelector('.asl-mode-selector button').getAttribute('aria-pressed')"), "true");
  const { sequence } = await fixtures();
  await h.play(sequence(["HELLO"]));
  await until(async () => (await h.words()).length > 0, "Word fixture did not confirm", 600);
  const words = await h.words(), stream = await h.evaluate("window.__qa.tracks.length");
  await h.click("Fingerspelling");
  await until(() => h.evaluate("!!document.querySelector('#spelling-text')"), "No spelling workspace");
  await until(() => h.evaluate("window.__qa.wordTerminations > 0"), "Word worker still running");
  assert.equal(await h.evaluate("document.querySelector('.transcript-panel:not(.fingerspelling-panel)').hidden"), true);
  assert.match(await h.evaluate("document.querySelector('.spelling-candidate').textContent"), /no verified fingerspelling model/);
  assert.equal(await h.evaluate("[...document.querySelectorAll('.spelling-actions button')].find(b=>b.textContent==='Confirm letter').disabled"), true);
  assert.deepEqual(await h.words(), words);
  assert.equal(await h.evaluate("window.__qa.tracks.length"), stream, "Mode switch reacquired camera");
  assert.equal(await h.active(), true);
  checks.push("word default; unavailable model; mode isolates transcript and terminates word worker without stopping camera");

  await h.evaluate("document.querySelector('#spelling-text').focus()");
  await h.browser.send("Input.insertText", { text: "HELLO" });
  await until(async () => (await text()) === "HELLO", "Text input did not update");
  const spokenBefore = await h.evaluate("window.__qa.spoken.length");
  await h.play(sequence(["YES"])); await pause(2000);
  assert.deepEqual(await h.words(), words, "Words leaked into spelling mode");
  assert.equal(await text(), "HELLO");
  assert.equal(await h.evaluate("window.__qa.spoken.length"), spokenBefore, "Spelling spoke automatically");
  await h.click("Backspace"); assert.equal(await text(), "HELL");
  await h.browser.send("Input.insertText", { text: "O" }); await h.click("Space");
  assert.equal(await text(), "HELLO ");
  await h.click("Speak");
  assert.equal(await h.evaluate("window.__qa.spoken.at(-1)"), "HELLO ");
  checks.push("keyboard composition, repeated LL, backspace, space, explicit speech only; word fixture rejected in spelling mode");

  await h.click("Word Recognition");
  await until(() => h.evaluate("!document.querySelector('#spelling-text')"), "Mode did not return");
  assert.deepEqual(await h.words(), words);
  await h.click("Fingerspelling"); assert.equal(await text(), "HELLO ");
  checks.push("both drafts survive repeated mode switches");

  for (let i=0;i<3;i++) {
    await h.click("Pause camera"); assert.equal(await text(), "HELLO ");
    await h.click("Start camera"); await until(h.active, "Camera restart failed");
  }
  assert.equal(await h.evaluate("window.__qa.tracks.filter(t=>t.readyState==='live').length"), 1);
  checks.push("three start/stop cycles, no extra live tracks, composed draft preserved");

  await h.browser.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await h.click("Backspace"); assert.equal(await text(), "HELLO");
  await h.browser.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  checks.push("offline text editing");
  await h.click("Pause camera");
  for (const [name, width, height] of [["desktop",1440,1000],["mobile",390,844]]) {
    await h.browser.send("Emulation.setDeviceMetricsOverride", { width,height,deviceScaleFactor:1,mobile:name==="mobile" });
    await h.evaluate("window.scrollTo(0,0)"); await pause(300);
    assert.equal(await h.evaluate("document.documentElement.scrollWidth <= innerWidth"), true, name+" horizontal overflow");
    assert.equal(await h.evaluate("!!document.querySelector('label[for=spelling-text]')"), true);
    const targets = await h.evaluate("[...document.querySelectorAll('.spelling-actions button,.asl-mode-selector button')].map(e=>{const r=e.getBoundingClientRect();return [r.width,r.height]})");
    assert.ok(targets.every(([w,hh])=>w>=44&&hh>=44), name+" touch target below 44px");
    const png=await h.browser.send("Page.captureScreenshot", { format:"png",captureBeyondViewport:true });
    writeFileSync("outputs/fingerspelling-"+name+".png",Buffer.from(png.data,"base64"));
  }
  checks.push("desktop/mobile overflow, labelled textarea and 44px controls; screenshots captured");
  await h.click("Clear"); assert.equal(await text(), "");
  assert.deepEqual(h.nonLoopback(), [], "Unexpected external page request");
  checks.push("clear; no external page requests during software check");
} finally { await h.close(); }

// Permission denial and recovery use only the runner's fake camera.
const denied=await openRehearsal(executable,{extraInit:`
  const getCamera=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  let first=true; navigator.mediaDevices.getUserMedia=options=>{
    if(first){first=false;return Promise.reject(new DOMException('QA denied','NotAllowedError'));}
    return getCamera(options);
  };
`});
try {
  await denied.open(); await denied.click("Start signing");
  await until(()=>denied.evaluate("!!document.querySelector('.camera-placeholder.denied')"),"Denial not shown");
  await denied.click("Fingerspelling"); await denied.click("Retry camera");
  await until(denied.active,"Camera denial did not recover");
  assert.equal(await denied.evaluate("document.querySelector('#spelling-text').value"),"");
  checks.push("permission denial and retry recovery in spelling mode");
} finally { await denied.close(); }
writeFileSync("outputs/fingerspelling-browser.json",JSON.stringify({kind:"software-only; fake camera; alphabet recognition unavailable",checks},null,2));
console.log(JSON.stringify({checks,passed:checks.length}));
