// UI lifecycle regressions with a controlled worker and delayed camera
// permission. Real Tasks/video accuracy is tested by the separate evaluator.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { startChrome } from "../scripts/diagnostics/chrome-session.mjs";
const executable = process.argv[2]; if (!executable) throw new Error("Supply Chrome executable");
const port = 18000 + Math.floor(Math.random() * 1000), origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["scripts/serve-export.mjs", "--port", String(port)], { stdio: "ignore" });
let browser;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, description) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await pause(100); }
  throw new Error(description);
}
try {
  browser = await startChrome(executable);
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    window.__qaWorkers = []; window.__qaCameraRequests = 0; window.__qaStoppedTracks = 0; window.__qaCameraResolvers = [];
    const NativeWorker = window.Worker;
    window.Worker = class {
      constructor(url, options) {
        if (!String(url).includes('recognition.worker.js')) return new NativeWorker(url, options);
        this.onmessage = this.onerror = this.onmessageerror = null; this.closed = false; this.session = 0;
        window.__qaWorkers.push(this);
      }
      postMessage(message) { this.session = message.session;
        if (message.type === 'frame') this.onmessage?.({data:{type:'analysis',session:this.session,frameId:message.frameId,state:'listening',candidate:null,confidence:0,bufferSize:0}});
      }
      terminate() { this.closed = true; }
      emit(gloss) { if (!this.closed) this.onmessage?.({data:{type:'confirmed',session:this.session,text:gloss,gloss,confidence:0.86,timestamp:Date.now(),source:'starter'}}); }
    };
    navigator.mediaDevices.getUserMedia = () => { window.__qaCameraRequests++; return new Promise(resolve => window.__qaCameraResolvers.push(() => resolve({getTracks:()=>[{stop:()=>window.__qaStoppedTracks++}]}))); };
    window.__qaEmit = gloss => window.__qaWorkers.filter(w=>!w.closed).at(-1).emit(gloss);
    window.__qaDenyStorage = () => { const original=Storage.prototype.setItem;
      Storage.prototype.setItem=function(key,value){if(key==='signrelay.history.v1')throw new DOMException('full','QuotaExceededError');return original.call(this,key,value);};
      window.__qaRestoreStorage=()=>Storage.prototype.setItem=original;
    };
  })();` });
  await until(async () => { try { return (await fetch(origin)).ok; } catch { return false; } }, "Server unavailable");
  await browser.send("Page.navigate", { url: origin });
  const evaluate = browser.evaluate;
  const click = text => evaluate(`(() => { const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}); if(!button)throw new Error('Missing button');button.click(); })()`);
  const chooseWelcome = text => evaluate(`(() => {const button=[...document.querySelectorAll('[role=radio]')].find(b=>b.textContent.includes(${JSON.stringify(text)}));if(!button)throw new Error('Missing language');button.click();})()`);
  const select = language => evaluate(`(() => { const select=document.querySelector('select[aria-label="Change sign language"]');select.value=${JSON.stringify(language)};select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  const history = () => evaluate("JSON.parse(localStorage.getItem('signrelay.history.v1')||'[]')");
  const emit = gloss => evaluate(`window.__qaEmit(${JSON.stringify(gloss)})`);
  const language = () => evaluate("document.querySelector('select[aria-label=\"Change sign language\"]')?.value");
  const transcript = () => evaluate("document.querySelector('.transcript-body')?.textContent");
  await until(() => evaluate("!!document.querySelector('.figma-language-row [role=radio]')"), "Welcome screen missing");
  // The static export already contains the radios before React attaches its
  // handlers. Prove a real state change before issuing the one-shot Start click.
  await until(async () => {
    await chooseWelcome("British");
    return evaluate("document.querySelector('[role=radio][aria-checked=true]')?.textContent.includes('British')");
  }, "Welcome screen did not hydrate");
  await chooseWelcome("American");
  await until(() => evaluate("document.querySelector('[role=radio][aria-checked=true]')?.textContent.includes('American')"), "Initial ASL selection failed");
  assert.equal(await evaluate("[...document.querySelectorAll('footer a')].find(a=>a.textContent==='Translate')?.getAttribute('href')"), "/#languages");
  await click("Start translating"); await until(async () => await language() === "asl", "ASL workspace missing");
  await until(() => evaluate("window.__qaCameraRequests===1"), "Automatic camera request missing");
  await emit("BOOK"); await until(async () => (await transcript())?.includes("BOOK"), "Controlled word missing");
  assert.match(await evaluate("document.querySelector('.candidate-bar')?.nextElementSibling?.textContent"), /not measured translation accuracy/);
  await browser.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert(await evaluate("document.documentElement.scrollWidth <= 390"), "Match score UI overflows a phone viewport");
  await browser.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 960, deviceScaleFactor: 1, mobile: false });
  await select("bsl"); await until(async () => await language() === "bsl", "Workspace switch failed");
  assert.equal((await history())[0].language, "asl"); assert.equal((await history())[0].entries[0].text, "BOOK");
  assert.doesNotMatch(await transcript(), /BOOK/);
  await emit("CAR"); await until(async () => (await transcript())?.includes("CAR"), "BSL word missing");
  await click("Change language");
  await until(() => evaluate("!!document.querySelector('.figma-language-row [role=radio]')"), "Back navigation failed");
  await chooseWelcome("Indian"); await until(async () => (await history())[0]?.language === "bsl", "Welcome language switch did not archive outgoing BSL");
  await click("Start translating"); await until(async () => await language() === "isl", "Indian workspace missing");
  assert.doesNotMatch(await transcript(), /CAR/);
  await emit("HELP"); await until(async () => (await transcript())?.includes("HELP"), "Indian word missing");
  await evaluate("window.__qaDenyStorage()"); await select("asl"); await pause(200);
  assert.equal(await language(), "isl"); assert.match(await transcript(), /HELP/);
  assert.match(await evaluate("document.body.textContent"), /Couldn't save this transcript/);
  await evaluate("window.__qaRestoreStorage()"); await select("asl"); await until(async () => await language() === "asl", "Switch did not recover after storage availability");
  assert.equal((await history())[0].language, "isl"); assert.equal((await history())[0].entries[0].text, "HELP");
  await emit("WATER"); await until(async () => (await transcript())?.includes("WATER"), "ASL word missing");
  await click("Change language"); await evaluate("window.__qaDenyStorage()"); await chooseWelcome("British"); await pause(200);
  assert.match(await evaluate("document.querySelector('[role=alert]')?.textContent"), /Couldn't save/);
  assert.equal(await evaluate("document.querySelector('[role=radio][aria-checked=true]')?.textContent.includes('American')"), true);
  await evaluate("window.__qaRestoreStorage()"); await chooseWelcome("British"); await click("Start translating");
  await until(async () => await language() === "bsl", "Recovery after welcome save failure failed");
  await select("rsl"); await until(() => evaluate("!!document.querySelector('#rsl-title')"), "RSL view missing");
  const requests = await evaluate("window.__qaCameraRequests");
  await evaluate("window.__qaCameraResolvers.forEach(resolve=>resolve());window.__qaCameraResolvers=[]");
  await until(() => evaluate(`window.__qaStoppedTracks===${requests}`), "Stale permission grants leaked camera tracks");
  await select("bdsl"); await until(() => evaluate("!!document.querySelector('#bdsl-title')"), "Bangla view missing");
  assert.equal(await evaluate("window.__qaCameraRequests"), requests);
  await click("Back to languages"); await click("Start translating");
  await until(() => evaluate("!!document.querySelector('#bdsl-title')"), "Bangla re-entry failed");
  assert.equal(await evaluate("window.__qaCameraRequests"), requests, "Bangla entry started the unused shared camera");
  await select("rsl"); await click("Back to languages"); await click("Start translating");
  await until(() => evaluate("!!document.querySelector('#rsl-title')"), "RSL re-entry failed");
  assert.equal(await evaluate("window.__qaCameraRequests"), requests, "RSL entry started the unused shared camera");
  console.log(JSON.stringify({ passed: true, checks: ["footer navigation", "workspace transcript isolation", "welcome transcript isolation",
    "storage failure keeps transcript on both paths", "late permission releases tracks", "RSL/Bangla entry leaves shared camera off", "visible match-score qualification"],
    camera_requests: requests, stale_tracks_stopped: await evaluate("window.__qaStoppedTracks") }));
} catch (error) {
  if (browser) console.error(JSON.stringify({ errors: browser.errors, diagnostics: await browser.evaluate(`({mediaDevices:typeof navigator.mediaDevices,
    requests:window.__qaCameraRequests, workers:window.__qaWorkers?.length, camera:document.querySelector('.camera-guidance')?.textContent,
    status:document.querySelector('.camera-message')?.textContent})`).catch(() => null) }));
  throw error;
} finally { await browser?.close(); server.kill(); }
