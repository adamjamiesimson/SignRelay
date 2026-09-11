export const CONSENT_KEY = "signrelay.analytics-consent.v1";
export const CONSENT_MAX_AGE = 180 * 24 * 60 * 60 * 1000;
const configuredId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? "";
export const MEASUREMENT_ID = /^G-[A-Z0-9]{6,20}$/.test(configuredId) ? configuredId : "";

export function readConsent(): "accepted" | "rejected" | null {
  try {
    const value = JSON.parse(localStorage.getItem(CONSENT_KEY) ?? "null");
    if (!value || !["accepted", "rejected"].includes(value.choice) || !Number.isFinite(value.savedAt)
      || Date.now() - value.savedAt > CONSENT_MAX_AGE || value.savedAt > Date.now()) return null;
    return value.choice;
  } catch { return null; }
}
export function privacySignalEnabled() {
  return navigator.doNotTrack === "1" || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
}
declare global {
  interface Window { dataLayer?: unknown[]; [key: `ga-disable-${string}`]: boolean | undefined }
}
export function startAnalytics() {
  if (!MEASUREMENT_ID || privacySignalEnabled() || readConsent() !== "accepted" || document.getElementById("signrelay-analytics")) return;
  const target = window;
  target[`ga-disable-${MEASUREMENT_ID}`] = false;
  target.dataLayer = target.dataLayer ?? [];
  const gtag: (...args: unknown[]) => void = function () {
    // gtag's queue expects the standard arguments object.
    // eslint-disable-next-line prefer-rest-params
    target.dataLayer!.push(arguments);
  };
  gtag("consent", "default", { analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
  gtag("js", new Date());
  gtag("config", MEASUREMENT_ID, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false, cookie_flags: "SameSite=Lax;Secure", cookie_expires: 60 * 60 * 24 * 180 });
  const publicRoutes = new Set(["/", "/about", "/languages", "/models", "/how-it-works", "/privacy", "/terms", "/roadmap"]);
  const path = publicRoutes.has(location.pathname) ? location.pathname : "/404";
  gtag("event", "page_view", { page_location: `https://signrelay.web.app${path}`, page_title: path, page_referrer: "" });
  const script = document.createElement("script");
  script.id = "signrelay-analytics";
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.appendChild(script);
}
export function saveConsent(choice: "accepted" | "rejected") {
  const target = window;
  const wasRunning = !!document.getElementById("signrelay-analytics");
  if (choice === "rejected") {
    target[`ga-disable-${MEASUREMENT_ID}`] = true;
    for (const cookie of document.cookie.split(";")) {
      const name = cookie.trim().split("=")[0];
      if (!/^_ga(?:_|$)/.test(name)) continue;
      for (const domain of ["", `;Domain=${location.hostname}`, `;Domain=.${location.hostname}`]) document.cookie = `${name}=;Max-Age=0;Path=/;SameSite=Lax;Secure${domain}`;
    }
  }
  try { localStorage.setItem(CONSENT_KEY, JSON.stringify({ choice, savedAt: Date.now() })); } catch { /* Storage blocked: analytics stays disabled. */ }
  if (choice === "accepted") startAnalytics();
  else if (wasRunning) location.reload();
}
