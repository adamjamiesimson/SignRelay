import { readFile, writeFile } from "node:fs/promises";

// Local QA only. The next production build deletes out/ and these fixtures.
const html = await readFile("out/index.html", "utf8");
const policy = html.match(/<meta name="signrelay-csp"[^>]*>/)[0];
// Static layout only: Next's router requires a real URL, not about:srcdoc.
const escaped = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
await writeFile("out/mobile-check.html", `<!doctype html><html><head>${policy}<title>SignRelay responsive QA</title></head><body style="margin:0;background:#333"><iframe title="375 pixel mobile layout" style="width:375px;height:812px;border:0" srcdoc="${escaped}"></iframe></body></html>`);
await writeFile("out/page-timing.js", `addEventListener('load',()=>setTimeout(()=>{const n=performance.getEntriesByType('navigation')[0];const p=performance.getEntriesByType('paint');const el=document.createElement('pre');el.id='qa-page-timing';el.style='position:fixed;top:0;left:0;z-index:9999;background:#fff;color:#000;padding:12px';el.textContent=JSON.stringify({domContentLoadedMs:Math.round(n.domContentLoadedEventEnd),loadMs:Math.round(n.loadEventEnd),paint:p.map(x=>({name:x.name,ms:Math.round(x.startTime)})),resourceCount:performance.getEntriesByType('resource').length});document.body.appendChild(el)},1000));`);
await writeFile("out/index.html", html.replace("</head>", '<script defer src="/page-timing.js"></script></head>'));
console.log("Created local responsive and timing fixtures. Rebuild before deployment to remove them.");
