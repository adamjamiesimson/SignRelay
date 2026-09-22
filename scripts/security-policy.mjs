export const baseHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
  // Script hashes are generated per exported HTML document, before any script.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'none'; upgrade-insecure-requests" },
];

export function documentPolicy(hashes) {
  return [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval' ${hashes.join(" ")} https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm/ https://www.googletagmanager.com`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'", // React canvas sizes, confidence rings and motion use style attributes.
    "img-src 'self' data: blob: https://www.google-analytics.com https://region1.google-analytics.com",
    "connect-src 'self' https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm/ https://storage.googleapis.com/mediapipe-models/ https://www.google-analytics.com https://region1.google-analytics.com https://analytics.google.com https://www.googletagmanager.com",
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}
