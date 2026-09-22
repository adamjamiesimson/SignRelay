# SignRelay security and site-readiness audit

Date: 11 September 2026. Reviewed Firebase branch base: `bff01edd26992c8c901b506828a627c6d95afc09` plus the changes accompanying this report. No production deployment was performed.

## Result and scope

The build, lint, 161 unit tests and two exported-site checks pass. The updated npm dependency tree reports **zero known vulnerabilities**, down from 16 (one critical, 11 high and four moderate). A known-pattern secret scan of all fetched branches/tags found no matching credentials across 71 commits and 343 historical text blobs. These checks do not guarantee the absence of vulnerabilities or undiscovered secrets.

The deployed application is a Next.js **static export**, with browser-side inference. It has no deployed server API, account system, admin area, password database or cloud data writes. Removed dormant Cloudflare/Vinext authentication, API and database examples and their unused dependencies. They were not part of the Firebase deployment.

## Controls and requested features

| Item | Result |
| --- | --- |
| Secrets and environment variables | No application API secrets required or found by the scan. Environment files are ignored; `.env.example` documents only a public GA4 measurement ID. The build rejects unknown `NEXT_PUBLIC_` variables and invalid measurement IDs. Never use browser variables for private credentials. |
| Git history | Fetched every advertised remote branch and tag. Scanned known credential patterns in text blobs up to 5 MiB, the working tree and local environment files. Skipped 430 non-text, oversized or non-blob objects. No matches. Not an entropy scanner, issuer validation or scan of deleted/unreachable remote history. |
| Authentication, authorization, admin routes, password hashing | Not applicable to this static version: these facilities do not exist. Local storage is shared by users of the same browser profile. No dummy login or client-only access gate was introduced. |
| Database security | No cloud database is used by this application. Local transcripts and personal templates are validated before use. Any separately provisioned Firebase databases, Storage buckets, rules and IAM remain outside the available audit scope. |
| HTTPS | Existing Firebase HTTP endpoint returned 301 to HTTPS; HTTPS returned 200 with HSTS. Added explicit HSTS and upgrade-insecure-requests to deployment configuration. New configured headers require deployment. |
| Security headers and XSS | Firebase configuration adds frame denial, nosniff, no-referrer and restricted camera/device permissions. Every exported HTML document receives a CSP before scripts, using SHA-256 hashes for its inline Next.js scripts. Inline handlers and unapproved script origins are blocked. User text renders through React text nodes; it is not inserted as HTML. |
| CSP compatibility | Browser check successfully initialized MediaPipe hand, face and pose models under the document policy without camera access. Document policy allows WebAssembly compilation and pinned MediaPipe asset locations; it does not allow general JavaScript unsafe-eval. Dynamic style attributes remain allowed for the existing UI. Worker scripts receive hosting headers; document script restrictions are not claimed to sandbox the internals of separately served worker code. |
| APIs, CORS, spam and rate limits | No form submission backend or private API exists to spam, authenticate or rate-limit. No permissive Access-Control-Allow-Origin response header is configured. Public models are intentionally downloadable. Hosting traffic controls and billing protection need account-level review; a client-side counter would not protect them. |
| Forms and local storage | Custom labels are limited to 48 characters and filtered to supported text. Transcript editing is limited to 500 characters per entry. Stored history, settings and landmark sequence shapes/numbers are validated. Invalid stored records are ignored. Failed transcript saves keep the current text instead of clearing it. |
| Debug and exposed files | Production source maps and Next powered-by header are disabled; frame diagnostic logging runs only in development. Hosting serves only `out/` and excludes environment, key, database, backup, log and source-map files. Builds clean old output first; tests reject local QA fixtures in the export. |
| Dependencies | Updated Next.js and its ESLint configuration to 16.3.4, esbuild to 0.28.1 and vulnerable transitives. Removed unused Cloudflare/Vinext/Drizzle tooling. `npm ci` is used in CI and deployment scripts. Recognition model contracts remain covered by tests. |
| Privacy Policy | Corrected the old inaccurate claim that landmarks are never stored. The page explains deliberately saved IndexedDB examples, local transcripts, model/hosting providers, optional analytics, voice services and deletion choices. |
| Terms and Conditions | Added a linked terms page describing experimental recognition, responsible use, model licences and local-data limitations. Operator details and legal suitability need owner review before public launch. |
| Cookie consent and analytics | Footer cookie choices and a banner are implemented. No analytics script loads without a valid configured ID and opt-in; rejection, expired consent, Do Not Track and Global Privacy Control keep it off. Withdrawal disables GA and reloads to remove its running code. Tests cover opt-in, rejection, revocation and exclusion of transcript/query/referrer content from manually sent page views. **No real GA property ID was provided: analytics remains off.** |
| SEO, links and 404 | Public pages have titles, descriptions and canonical metadata. Terms is included in the sitemap. Existing robots.txt and custom 404 are retained. Export checks verify public routes, local links/assets, metadata and image alt attributes. External links were reviewed as source references, not exhaustively availability-tested. |
| Social image and favicon | Replaced a corrupt social card with a verified 1200×630 branded image and matching metadata. Compressed the on-page mark to WebP, favicon to 64×64 PNG and added a 180×180 Apple icon. Removed obsolete/corrupt PNG assets from the deployed files. |
| Accessibility, motion and mobile | Preserved the clear Start translating CTA, cursor aura and scroll reveals. Fine-pointer and reduced-motion controls remain in place. Improved focus indicators, muted note text and the validation error contrast. Reviewed the desktop translator and a static 375-pixel-wide mobile layout fixture (360 pixels of content plus scrollbar) with no horizontal overflow. Mobile camera behavior and assistive-technology certification are not claimed. |

## Verification evidence

- `npm test`: 161 passing tests, including actual BSL/ISL WASM execution, recognition contracts, storage validation and consent behavior.
- `npm run lint`: passed.
- `npm run build:firebase`: passed; static routes generated and hash policies added to ten HTML documents.
- `npm run audit:security`: zero npm advisories, zero secret-pattern findings, two exported-page/security checks passed.
- Browser: production home hydrated; cookie notice could be dismissed; primary CTA reached language selection; translator opened; personal vocabulary expanded; invalid label produced a readable validation message. MediaPipe initialization passed under the production document CSP. The browser did not expose a camera, so live capture and end-to-end sign accuracy were not tested.
- Page speed: one unthrottled local-browser run with temporary timing instrumentation measured DOMContentLoaded 223 ms, first contentful paint 284 ms and load 1,268 ms (16 resource entries). This is not Lighthouse, a mobile-network benchmark or production Core Web Vitals. Temporary instrumentation is excluded from the final export.
- Initial HTML plus directly referenced JS/CSS/mark: approximately 823 KB raw / 301 KB gzip estimate. Vision assets and model weights load later; they remain substantially larger than the landing page. Production caching, real devices and first model download time need post-deployment measurement.
- Mark: 692,387-byte PNG → 71,370-byte WebP (about 90% smaller). Favicon: 692,387 → 3,229 bytes. Social image: 786,444-byte damaged PNG → 211,874-byte valid PNG. Apple icon: 10,023 bytes.

## Owner checks before public launch

1. Deploy the complete fresh export and `firebase.json`; verify the response headers and custom 404 on the actual domain. The repository changes do not alter a previously deployed site automatically.
2. Review Firebase project members, service accounts, MFA, billing alerts, traffic quotas and any separately created databases/buckets. Remove unnecessary access through the console. This audit did not have account access and does not certify those resources.
3. If enabling analytics, supply your own `NEXT_PUBLIC_GA_MEASUREMENT_ID`, disable GA Enhanced Measurement in the data stream to prevent automatic form/search/navigation collection, choose retention settings, and rebuild. Verify consent in the deployed browser before relying on analytics. Advertising features are disabled in the code.
4. Review the privacy/terms text against the actual operator identity, contact channel, location, audience and provider settings. No legal-compliance certification is implied.
5. Test live signing on the target phone and desktop, including permission rejection, camera restart, saving/deleting examples and optional speech. This audit addresses the application’s security and readiness; it does not establish translation accuracy.
6. Enable repository secret scanning/push protection and private vulnerability reporting if available. If any credential is later found, revoke/rotate it first; removing source text alone is insufficient.

## Implementation references

- [Firebase Hosting configuration](https://firebase.google.com/docs/hosting/full-config) — output selection, headers and cache configuration.
- [Firebase Hosting](https://firebase.google.com/docs/hosting) — HTTPS hosting behavior.
- [Next.js Content Security Policy](https://nextjs.org/docs/app/guides/content-security-policy) — CSP considerations; this static export uses build-time hashes instead of per-request nonces.
- [Google consent implementation](https://developers.google.com/tag-platform/security/guides/consent) and [tag CSP guidance](https://developers.google.com/tag-platform/security/guides/csp) — optional tag setup.

## Social-card provenance

Generated with the built-in image-generation tool, using the existing mark as a brand reference, then resized/compressed for the site. Final asset: `public/signrelay-social-v2.png`. Brief: near-black landscape 1200:630 card, restrained teal glow, crisp sans serif, circular hands-and-signal emblem; exact text “SignRelay”, “Sign freely. Be understood.” and “On-device sign-language research”; no UI or extra copy.
