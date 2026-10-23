# Sprint 7 interface audit and design system

## 1. Audit of the Sprint 6 interface (`c5b4070`)

Screenshots: [`screenshots/before/`](screenshots/before/) (captured from `next dev`, which has no self-hosted tracking models, so the old workspace shows its model-load error state).

| # | Finding | Where | Resolution |
| --- | --- | --- | --- |
| A1 | Three overlapping stylesheets (`globals.css` 620 lines, `refinement.css` 280, `figma-ui.css` 1,313) redefining the same selectors, e.g. `.brand-mark` sized four different ways and `.camera-stage` background set three times | `app/*.css` | Replaced by one token-based system (§2) |
| A2 | Hero illustration drew a face oval with 18 facial dots, eyebrows and mouth, a shoulder skeleton, a scanning line and HUD corner brackets, with Face / Shoulders / Hands (n) "tracking" chips | `figma-make-landing.tsx` | Hands only; no face, body or scan line (§3) |
| A3 | A large cookie banner covered the workspace controls although no analytics was configured | `privacy-choices.tsx` | Banner only when optional analytics exists |
| A4 | Workspace opened with a five-line model-status paragraph; on a phone the camera was below the fold | workspace | One-line headline, details behind "What this means" |
| A5 | A permanent "0" match-score ring beside the status, even with the camera off | transcript panel | Score shown only while a candidate is being checked |
| A6 | Lower-case technical status chips ("waiting for hands", "following movement") | `recognition-status.ts` | Seven short states, same logic |
| A7 | Duplicate primary actions ("Start camera" in the placeholder and the bar) | camera panel | One Start/Pause/Cancel button |
| A8 | Header lost "How it works" on phones; no menu; no skip link | `site-chrome.tsx` | Responsive header with a phone menu; skip link |
| A9 | Language row was buttons styled as radios with no arrow-key behaviour; 33 teach-only languages labelled "BETA · models in development" although no such models exist | landing, `/languages` | Searchable picker with proper radio groups; honest "Teach your own signs" |
| A10 | A vocabulary "size meter" bar could be read as a quality score | landing | Removed |
| A11 | Cursor-following glow and reveal-on-scroll effects on every page | `surface-motion.tsx` | Removed |
| A12 | RSL and Bangla screens used inline styles and a different visual language | `rsl-recognizer.tsx`, `bdsl-recognizer.tsx` | Same components as the workspace |
| A13 | "Open source" claimed with no licence file in the repository | landing, footer | "Public source code"; owner decision |

## 2. Design system

Files: [`app/globals.css`](../../../app/globals.css) (tokens, base, components), [`app/site.css`](../../../app/site.css) (header, footer, home, information pages), [`app/workspace.css`](../../../app/workspace.css) (translator, personal signs, clip modes, tour). 814 lines in total, replacing 2,213.

**Colour.** Charcoal surfaces in small steps (`--bg #0a0c0e` → `--surface-3 #20262c`), hairline borders (`rgb(255 255 255 / .08–.14)`), three text levels (`--text-3 #808b94` keeps ≥ 4.5:1 on `--surface-2` and darker) and one teal-mint accent (`--accent #5eead4`, dark ink `#032420` on accent buttons). Amber and coral appear only for status (abstention, errors, the "Illustration" dot).

**Type.** The platform system stack (SF Pro on Apple devices, Segoe UI on Windows, Roboto on Android); no web fonts, so nothing is fetched and the offline demo stays offline. Display headings 650–680 weight with negative tracking; body 16 px / 1.6.

**Shape and space.** Radii 8 / 12 / 18 / 24 px and pill buttons; a 4 px spacing rhythm; page width 1,200 px (workspace 1,280) with a `clamp(16px, 4vw, 40px)` gutter.

**Components.** `.button` (`primary` / `secondary` / `ghost` / `danger`, `small` / `large`, 36–52 px tall), `.icon-button` (32–36 px), `.tag`, `.pill`, `.notice` (`warn`, `error`, `compact`), `.empty-state`, `.card`, inputs and `select` with one focus style, `.search-field`, a CSS switch built on a real checkbox, `details` disclosures with a rotating chevron, a native-`<dialog>` `Modal`, the tour and the consent notice. Icons: `lucide-react` (already a dependency, previously unused), always `aria-hidden` beside a text label or on a button with an `aria-label`.

**States.** One `:focus-visible` ring (2 px accent, 2 px offset) on every control; hover lifts the surface one step; disabled is 42 % opacity with a not-allowed cursor; loading uses a slow pulse on the camera icon only; errors use the coral notice with the original messages.

**Motion.** 140 ms and 240 ms with one ease (`cubic-bezier(.2,.7,.2,1)`). The hero is the only continuous motion. Under `prefers-reduced-motion: reduce` every CSS animation and transition is removed and the hero shows a still frame.

**Test hooks kept.** Class names and labels that browser smokes rely on (`.status-badge`, `.recognition-state`, `.candidate-bar`, `.transcript-entry`, `.entry-actions span`, `.vocabulary-grid`, `#personal-vocabulary`, Start camera, Pause camera, Change language, Back to languages, Record example, Clear local data, …) were kept; renamed ones were updated mechanically in the smokes (`.figma-language-row` → `.language-row`, "Start translating" → "Start signing").

## 3. The hand illustration

`components/hero-preview.tsx` + `lib/hand-illustration.ts`.

- **Geometry.** Two hands in the 21-point layout trackers use (wrist, thumb and four fingers), built from hand-authored parameters: position, rotation, palm turn, scale, per-finger flexion and spread. Proportions follow a real hand (knuckle width ≈ 0.7 of palm length, middle finger ≈ 0.9). A folded finger foreshortens and folds back over the palm, so fists read as fists; tips of folded fingers are not marked.
- **Drawing.** 1.25 px non-scaling teal lines with a soft 6 px halo, a 7 % palm fill, small joints and brighter fingertips only — eleven dots per open hand instead of the previous 21 plus 18 facial points. A dotted "signing space" background and a soft radial glow; no face, shoulders, outline, scan line or corner brackets.
- **Motion.** Each of the six demo words (HELLO, THANK YOU, PLEASE, SORRY, YES, NO) and one ambiguous two-handed movement is a function of progress, eased with a cosine curve; transitions blend the end of one sign into the start of the next, so no frame jumps (unit test: < 9 viewBox units between 60 fps frames across the whole loop). A faint trail follows the moving hand while it is "watched"; a confirmed word sends one soft ring outwards and fades into the example transcript. "No confident match" adds nothing.
- **Honesty.** Always labelled *Illustration · Not live*; no scores or percentages (unit-tested); the caption uses the product's own states (Watching movement, Checking sign, Added to transcript, No confident match).
- **Performance.** Frames are drawn by writing SVG `d` attributes from one `requestAnimationFrame` loop; React re-renders only when the caption changes (< 1 per second). The loop stops when the card is off screen or the tab is hidden, and the component is unmounted in the workspace. See [hero-animation-perf.json](hero-animation-perf.json).
- **Control.** A pause/play button (WCAG 2.2.2); reduced motion starts paused on a still frame.
