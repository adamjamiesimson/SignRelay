# Sprint 7 accessibility results (objective 22)

Target: WCAG 2.2 AA where feasible. Everything below is automated or scripted in headless Chromium. **It is not a test with screen-reader users or other assistive-technology users, and no certification is claimed.**

## Automated checks

| Check | Scope | Result |
| --- | --- | --- |
| axe-core 4.13.0, tags wcag2a/aa, 21a/aa, 22aa (`a11y-axe-smoke`) | `/`, `/languages`, `/models`, `/privacy`, `/about` and the live ASL workspace (camera on, no hands), full profile | **0 violations** |
| axe-core, same tags (`onboarding-smoke`) | Workspace with the tour open (step 1); Cookie choices dialog open | **0 violations** |
| Keyboard reach and visible focus (`transcript-a11y-smoke`) | 80 Tab presses through the workspace | 41 controls reached, including Start camera, Speak, Stop, Copy, Edit/Remove each word and Change language; every one shows a focus indicator |
| Target size, 2.5.8 (`transcript-a11y-smoke`) | Every visible button, input, link, summary and select in `main` at 390 px | 34 targets, all ≥ 24 × 24 CSS px (28 below the 44 px AAA size) |
| Reflow, 1.4.10 and 1.4.4 (`transcript-a11y-smoke`) | 8 pages at 320 and 390 px, and at 390 px with 200 % text; a 48-character word | No horizontal scrolling |
| Reduced motion (`transcript-a11y-smoke`, `onboarding-smoke`) | Home page with `prefers-reduced-motion: reduce` | 0 running CSS animations; the hero shows a still frame and only moves after Play animation |
| Pause, stop, hide, 2.2.2 (`onboarding-smoke`) | Hero illustration | Pause and Play controls work; animation also stops off screen |
| Live regions (`transcript-a11y-smoke`, `workspace-browser-smoke`) | Confirmed words, removals, camera state | Each confirmed word announced once politely; candidates never announced; removals announced |
| Focus management (`transcript-a11y-smoke`, `onboarding-smoke`) | Editing and removing words; tour; phone menu; dialog | Focus returns to the entry or the transcript heading; tour heading takes focus on every step and focus moves to Start camera afterwards; Escape closes the menu and returns focus to its button; the native dialog returns focus to its opener |

## Contrast of the design tokens

Computed with the WCAG relative-luminance formula.

| Pair | Ratio |
| --- | --- |
| Primary text `#eef1f3` on page `#0a0c0e` | 17.3:1 |
| Secondary text `#a9b2ba` on panel `#13171b` | 8.4:1 |
| Tertiary text `#808b94` on page / panel / raised panel | 5.6 / 5.2 / 4.9:1 |
| Accent `#5eead4` on panel | 12.2:1 |
| Button ink `#032420` on accent | 11.1:1 |
| Error `#ff9389` / warning `#f2c27c` on panel | 8.4 / 11.0:1 |

## Semantics added or kept

- Skip link to `#main` on every page; one `h1` per page; sections labelled by their headings.
- Language picker: two `radiogroup`s sharing one selection, roving tabindex (one tab stop each), arrow keys, Home and End; disabled languages in the ASL demo build are skipped.
- Tour: native modal `<dialog>` labelled by its heading and described by its text; background inert; Back, Next, Skip tour, Finish, arrow keys and Escape.
- Phone menu: `aria-expanded` and `aria-controls`; Escape and outside click close it.
- Cookie choices: native modal dialog; equal Reject and Allow; the current analytics state in words.
- Icon-only buttons (Edit, Remove, Close, Pause/Play animation, menu) have `aria-label`s; decorative icons are `aria-hidden`.
- The hero illustration's SVG is hidden from assistive technology and replaced by a text description; its moving caption is not a live region, so it does not interrupt.

## Known gaps

- No screen-reader, switch, voice-control or magnifier user testing (needs people; see the Sprint 6 field-test protocols).
- Contrast of text over the live camera image depends on the scene; the guidance pill uses a 72 % dark backing.
- The two radio groups that share one selection are announced as two groups; a single grouped listbox may suit some screen readers better. Worth checking with users.
