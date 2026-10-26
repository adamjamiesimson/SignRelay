// Classify what the deny-all proxy saw during the strict offline check. Only
// traffic the browser process itself opens is excused; page and worker
// requests are checked separately over CDP and are never excused here.
//
// Tunnels measured with an about:blank tab only: the first three on Chromium
// 141 headless; www.gstatic.com and update.googleapis.com on the CI runner's
// branded Google Chrome, even with QUIET_CHROME.
export const BROWSER_INTERNAL_HOSTS = new Set(["www.google.com:443", "accounts.google.com:443", "android.clients.google.com:443",
  "www.gstatic.com:443", "update.googleapis.com:443"]);
// Branded Chrome's own update check over plain HTTP (CUP-signed POST), first
// seen on the CI runner on 22 October 2026. Exact host and path only.
const BROWSER_INTERNAL_HTTP = [/^POST http:\/\/update\.googleapis\.com\/service\/update2\/json(\?|$)/];

/** True only for a proxy log line that the browser itself produced. */
export function browserInternal(line) {
  if (line.startsWith("CONNECT ")) return BROWSER_INTERNAL_HOSTS.has(line.slice("CONNECT ".length));
  return BROWSER_INTERNAL_HTTP.some(pattern => pattern.test(line));
}
